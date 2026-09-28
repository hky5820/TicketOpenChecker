const express = require('express');
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const { chromium } = require('playwright');
const { collectSports } = require('./lib/sports');
const { collectMelon } = require('./lib/melon');

const START_PORT = Number(process.env.PORT || 3000);
const HEADLESS = process.env.HEADLESS === '1' || process.env.CI === 'true';
const CHROME_PROFILE_DIR = process.env.CHROME_PROFILE_DIR || path.join(__dirname, 'chrome-profile');
const MOBILE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DESKTOP_PROFILE_DIR = process.env.DESKTOP_PROFILE_DIR || path.join(__dirname, 'chrome-profile-desktop');

const SITES = [
  {
    id: 'interpark',
    name: 'NOL 티켓',
    url: 'https://tickets.interpark.com/contents/notice',
    scrape: scrapeInterpark,
    desktop: true,
  },
  {
    id: 'melon',
    name: '멜론 티켓',
    url: 'https://ticket.melon.com/csoon/index.htm#orderType=0&pageIndex=1&schGcode=GENRE_ALL&schText=&schDt=',
    scrape: scrapeMelon,
    desktop: true,
  },
  {
    id: 'ticketlink',
    name: '티켓링크',
    url: 'https://www.ticketlink.co.kr/help/notice#TICKET_OPEN',
    scrape: scrapeTicketlink,
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ── 자체 푸시 채널 ──
 * 이 서버가 VAPID 키를 소유하고 직접 발송한다. 앱(GitHub Pages여도 무관)은 구독+알람 목록만
 * /api/push/sync로 보내오고, 여기 스케줄러가 오픈 10·5·3·1분 전과 정각에 web-push를 쏜다.
 * 앱이 완전히 꺼져 있어도 브라우저 푸시 서비스가 단말 알림창에 띄운다. */
const VAPID_FILE = path.join(__dirname, '.vapid.json');
const SUBS_FILE = path.join(__dirname, '.push-subs.json');
const PUSH_OFFSETS = [10, 5, 3, 1, 0]; // 분 전 (0 = 정각)

let vapid = null;
let pushReady = false;
if (fs.existsSync(VAPID_FILE)) {
  // ★ 파일이 있으면 절대 새로 만들지 않는다. 키를 갈면 기존 구독이 전부 무효가 된다.
  try { vapid = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8')); }
  catch (e) { console.error(`[push] .vapid.json 파싱 실패 — 푸시 비활성(덮어쓰지 않음): ${e.message}`); }
} else {
  vapid = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_FILE, JSON.stringify(vapid), { mode: 0o600 });
  console.log(`[push] VAPID 키 새로 생성 → ${VAPID_FILE}`);
}
if (vapid && vapid.publicKey && vapid.privateKey) {
  try { webpush.setVapidDetails('mailto:hky130580@gmail.com', vapid.publicKey, vapid.privateKey); pushReady = true; }
  catch (e) { console.error(`[push] VAPID 설정 실패: ${e.message}`); }
}

// endpoint → { sub, alarms:[{key,title,open,url}], fired:{'key|분':1} } — 재시작에도 유지
const subs = new Map();
try {
  for (const r of JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'))) {
    if (r && r.sub && r.sub.endpoint) subs.set(r.sub.endpoint, { sub: r.sub, alarms: r.alarms || [], fired: r.fired || {} });
  }
  if (subs.size) console.log(`[push] 구독 ${subs.size}건 로드`);
} catch { /* 첫 실행 */ }
function saveSubs() {
  try { fs.writeFileSync(SUBS_FILE, JSON.stringify([...subs.values()]), { mode: 0o600 }); }
  catch (e) { console.error(`[push] 구독 저장 실패: ${e.message}`); }
}

// 앱이 Pages 오리진에서 호출해도 되도록 개방 (인증정보 없는 공개 API)
app.use('/api/push', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/push/key', (req, res) => res.json({ key: pushReady ? vapid.publicKey : null }));

// 구독 + 알람 목록 통째 교체. 클라이언트가 알람을 켜고 끌 때마다 전체를 다시 보낸다.
app.post('/api/push/sync', (req, res) => {
  if (!pushReady) return res.status(503).json({ ok: false });
  const b = req.body || {};
  if (!b.sub || !b.sub.endpoint) return res.status(400).json({ ok: false });
  const alarms = (Array.isArray(b.alarms) ? b.alarms : [])
    .filter((a) => a && a.key && a.open && Number.isFinite(new Date(a.open).getTime()))
    .map((a) => ({
      key: String(a.key).slice(0, 200),
      title: String(a.title || '').slice(0, 80),
      open: String(a.open),
      url: String(a.url || '').slice(0, 300),
    }));
  // 이미 발화한 오프셋은 유지, 목록에서 빠진 알람의 흔적은 정리
  const prev = subs.get(b.sub.endpoint);
  const fired = {};
  if (prev && prev.fired) {
    for (const a of alarms) for (const m of PUSH_OFFSETS) {
      const fk = `${a.key}|${m}`;
      if (prev.fired[fk]) fired[fk] = 1;
    }
  }
  subs.set(b.sub.endpoint, { sub: b.sub, alarms, fired });
  saveSubs();
  res.json({ ok: true, alarms: alarms.length });
});

function sendPush(ep, rec, p) {
  const body = JSON.stringify({
    title: p.title,
    body: String(p.body || '').slice(0, 160),
    data: { tag: `toc:${p.tag}`, url: p.url || './' },
  });
  webpush.sendNotification(rec.sub, body, { TTL: 300 }).catch((err) => {
    const sc = err && err.statusCode;
    if (sc === 404 || sc === 410) { subs.delete(ep); saveSubs(); console.log(`[push] 만료 구독 정리(${sc}) 남은 ${subs.size}건`); }
    else console.error(`[push] 전송 실패(${sc || '?'}): ${String((err && err.message) || '').slice(0, 120)}`);
  });
}

setInterval(() => {
  if (!pushReady || !subs.size) return;
  const now = Date.now();
  let dirty = false;
  for (const [ep, rec] of subs) {
    const kept = rec.alarms.filter((a) => new Date(a.open).getTime() > now - 3600 * 1000);
    if (kept.length !== rec.alarms.length) { rec.alarms = kept; dirty = true; }
    for (const a of rec.alarms) {
      const openAt = new Date(a.open).getTime();
      for (const m of PUSH_OFFSETS) {
        const at = openAt - m * 60000;
        const fk = `${a.key}|${m}`;
        if (rec.fired[fk] || now < at) continue;
        rec.fired[fk] = 1; dirty = true;
        if (now >= at + 60000) continue; // 60초 넘게 지난 시점은 조용히 스킵(뒤늦은 구독·재시작 직후 몰아치기 방지)
        const hhmm = String(a.open).slice(11, 16);
        sendPush(ep, rec, m === 0
          ? { title: '티켓 오픈!', body: `${a.title} — 지금 오픈했어요`, tag: a.key, url: a.url }
          : { title: '곧 티켓 오픈!', body: `${a.title} — ${hhmm} 오픈 (${m}분 전)`, tag: a.key, url: a.url });
      }
    }
  }
  if (dirty) saveSubs();
}, 15000);

app.get('/api/sports', async (req, res) => {
  res.json(await collectSports());
});

let loadingSchedules = false;
app.get('/api/load', async (req, res) => {
  if (loadingSchedules) return res.status(409).json({ message: '이미 수집 중입니다. 잠시 후 다시 시도해 주세요.' });
  loadingSchedules = true;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (type, payload) => {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  let context;
  let desktopContext;
  try {
    send('status', { site: 'system', message: '브라우저를 여는 중' });
    context = await launchMobileContext();
    // NOL 공지 수집에 사용하는 데스크톱 컨텍스트.
    desktopContext = await launchDesktopContext();

    const allItems = [];
    const siteStatus = {};
    const seenIndex = new Map();
    const streamItems = (site, rawItems) => {
      const toSend = [];
      for (const item of dedupeItems(normalizeItems(rawItems, site))) {
        const key = itemKey(item);
        const existing = seenIndex.get(key);
        if (existing) {
          // 이미지 등 뒤늦게 채워진 필드를 기존 항목에 반영 후 다시 보낸다.
          if (item.image && !existing.image) {
            existing.image = item.image;
            toSend.push(existing);
          }
          continue;
        }
        seenIndex.set(key, item);
        allItems.push(item);
        toSend.push(item);
      }
      if (!toSend.length) return [];
      send('items', {
        site: site.id,
        items: toSend,
        total: allItems.length,
      });
      return toSend;
    };

    let sports;
    await Promise.all([collectSports(message => send('status', { site: 'sports', message })).then(result => {
      sports = result;
      send('sports', result);
    }), ...SITES.map(async (site) => {
      const page = await (site.desktop ? desktopContext : context).newPage();
      try {
        send('status', { site: site.id, message: `${site.name} 접속 중` });
        await site.scrape(
          page,
          (message) => send('status', { site: site.id, message }),
          (items) => streamItems(site, items)
        );
        const count = allItems.filter((item) => item.siteId === site.id).length;
        siteStatus[site.id] = { ok: true, count, checkedAt: new Date().toISOString() };
        send('siteDone', { site: site.id, count });
      } catch (error) {
        siteStatus[site.id] = { ok: false, error: error.message, checkedAt: new Date().toISOString() };
        send('siteError', { site: site.id, message: error.message });
      } finally {
        await page.close().catch(() => {});
      }
    })]);

    allItems.sort((a, b) => {
      const at = a.openDateTime ? new Date(a.openDateTime).getTime() : Number.MAX_SAFE_INTEGER;
      const bt = b.openDateTime ? new Date(b.openDateTime).getTime() : Number.MAX_SAFE_INTEGER;
      return at - bt || a.title.localeCompare(b.title, 'ko');
    });

    send('done', { items: dedupeItems(allItems), sports, siteStatus, loadedAt: new Date().toISOString() });
  } catch (error) {
    send('fatal', { message: error.message });
  } finally {
    await context?.close().catch(() => {});
    await desktopContext?.close().catch(() => {});
    loadingSchedules = false;
    res.end();
  }
});

listenWithFallback(START_PORT);

function listenWithFallback(port) {
  const server = app.listen(port, () => {
    console.log(`TicketOpenChecker: http://localhost:${port}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && port < START_PORT + 20) {
      console.log(`Port ${port} is already in use. Trying ${port + 1}...`);
      listenWithFallback(port + 1);
      return;
    }
    throw error;
  });
}

async function launchMobileContext() {
  // 로컬에서 창을 띄울 때는 실제 Chrome(channel:'chrome')을 자동화 플래그 제거하고 실행 — mycode 방식.
  // 시스템에 설치된 진짜 Chrome을 써서 봇 감지를 회피한다. (헤드리스/CI 환경은 번들 Chromium 사용)
  const context = await chromium.launchPersistentContext(CHROME_PROFILE_DIR, {
    ...(HEADLESS ? {} : { channel: 'chrome' }),
    headless: HEADLESS,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-popup-blocking',
      '--disable-dev-shm-usage',
      ...(HEADLESS ? ['--no-sandbox'] : []),
    ],
    userAgent: MOBILE_USER_AGENT,
    viewport: { width: 960, height: 900 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'platform', { get: () => 'iPhone' });
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
    Object.defineProperty(navigator, 'vendor', { get: () => 'Apple Computer, Inc.' });
  });

  context.on('page', async (page) => {
    await applyTouchEmulation(context, page).catch(() => {});
  });

  for (const page of context.pages()) {
    await applyTouchEmulation(context, page).catch(() => {});
  }

  return context;
}

async function launchDesktopContext() {
  // NOL 공지 수집용 데스크톱 컨텍스트.
  const context = await chromium.launchPersistentContext(DESKTOP_PROFILE_DIR, {
    ...(HEADLESS ? {} : { channel: 'chrome' }),
    headless: HEADLESS,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-popup-blocking',
      '--disable-dev-shm-usage',
      ...(HEADLESS ? ['--no-sandbox'] : []),
    ],
    userAgent: DESKTOP_USER_AGENT,
    viewport: { width: 1360, height: 900 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  return context;
}

async function applyTouchEmulation(context, page) {
  const cdp = await context.newCDPSession(page);
  await Promise.all([
    cdp.send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' }),
    cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }),
    cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 960,
      height: 900,
      deviceScaleFactor: 2,
      mobile: true,
      screenWidth: 960,
      screenHeight: 900,
    }),
  ]);
}

async function scrapeInterpark(page, progress, emit) {
  // 인터파크 오픈예정 목록 API(open-notice/notice-list)를 페이지 컨텍스트에서 호출한다.
  // (goodsGenre=ALL&goodsRegion=ALL 이 필수 — 빈 값이면 400. 세션 쿠키는 페이지 로드로 확보.)
  // 응답에 제목/오픈일시/조회수/포스터/goodsCode 가 모두 들어있다.
  await page.goto('https://tickets.interpark.com/contents/notice', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  const items = await page.evaluate(async () => {
    const parse = (txt) => { let j = JSON.parse(txt); if (typeof j === 'string') j = JSON.parse(j); return j; };
    const out = [];
    const seen = new Set();
    for (let offset = 0; offset < 600; offset += 25) {
      let arr = [];
      try {
        const url = `https://tickets.interpark.com/contents/api/open-notice/notice-list?goodsGenre=ALL&goodsRegion=ALL&offset=${offset}&pageSize=25&sorting=OPEN_ASC`;
        const res = await fetch(url, { headers: { Accept: 'application/json, text/plain, */*' } });
        const j = parse(await res.text());
        const d = j.data || j;
        arr = d.list || d.notices || d.items || d.content || (Array.isArray(d) ? d : []);
      } catch (e) {
        break;
      }
      if (!arr.length) break;
      for (const n of arr) {
        const key = String(n.noticeId || `${n.title}|${n.openDateStr}`);
        if (seen.has(key)) continue;
        seen.add(key);
        const dm = String(n.openDateStr || '').match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
        out.push({
          title: n.title || '',
          openDate: dm ? `${dm[1]}-${dm[2]}-${dm[3]}` : null,
          openTime: dm ? `${dm[4]}:${dm[5]}` : null,
          viewCount: Number.isFinite(n.viewCount) ? n.viewCount : null,
          image: n.posterImageUrl || '',
          // 오픈리스트 아이템 클릭 시 이동하는 예매정보(공지 상세) 페이지
          url: n.noticeId
            ? `https://tickets.interpark.com/contents/notice/detail/${n.noticeId}`
            : 'https://tickets.interpark.com/contents/notice',
        });
      }
      if (arr.length < 25) break;
    }
    return out;
  });
  emit(items);
  progress(`${items.length}건`);
}

async function scrapeMelon(_page, progress, emit) {
  // Public mobile API: validated response and complete pagination before emission.
  emit(await collectMelon(progress));
}

async function scrapeTicketlink(page, progress, emit) {
  // 티켓링크 오픈예정 목록 API가 제목/오픈일시/조회수/포스터를 한 번에 준다. (브라우저 불필요)
  const collected = new Map();
  for (let pageIndex = 1; pageIndex <= 6; pageIndex += 1) {
    progress(`오픈예정 목록 API ${pageIndex}페이지`);
    const items = await fetchTicketlinkPage(pageIndex);
    if (!items.length) break;
    items.forEach((item) => { if (!collected.has(item.url)) collected.set(item.url, item); });
    emit(items);
    if (items.length < 15) break; // 마지막 페이지
    await sleep(400);
  }
  progress(`${collected.size}건`);
}

async function fetchTicketlinkPage(pageIndex) {
  try {
    const url = `https://mapi.ticketlink.co.kr/mapi/notice/list?page=${pageIndex}`
      + '&noticeCategoryCode=TICKET_OPEN&orderType=OPEN_DATE';
    const res = await fetch(url, { headers: { 'User-Agent': DESKTOP_USER_AGENT, Accept: 'application/json' } });
    if (!res.ok) return [];
    const json = await res.json();
    const notices = (json && json.data && json.data.notices) || [];
    return notices
      .map((n) => {
        const dm = String(n.ticketOpenDatetime || '').match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
        let image = n.imagePath || n.noticeImagePath || '';
        if (image && typeof image === 'object') image = image.imgUrl || '';
        if (typeof image !== 'string') image = '';
        if (image.startsWith('//')) image = `https:${image}`;
        else if (image.startsWith('http://')) image = image.replace(/^http:/, 'https:');
        const title = String(n.title || '')
          // 실제 HTML 태그(<b>,</b>,<p ...>)만 제거하고 <씨네미술관> 같은 한글 꺾쇠는 보존한다.
          .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
          .replace(/&nbsp;|&amp;|&lt;|&gt;/g, (m) => ({ '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>' }[m]))
          .replace(/\s+/g, ' ')
          .trim();
        return {
          title,
          openDate: dm ? `${dm[1]}-${dm[2]}-${dm[3]}` : null,
          openTime: dm ? `${dm[4]}:${dm[5]}` : null,
          viewCount: Number.isFinite(n.viewCount) ? n.viewCount : null,
          image,
          url: `https://m.ticketlink.co.kr/help/notice/${n.noticeId}`,
        };
      })
      .filter((item) => item.title && item.openDate);
  } catch {
    return [];
  }
}

async function extractItemsFromPage(page, siteId) {
  return page.evaluate((siteId) => {
    const fullDatePattern = /(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/;
    const shortDatePattern = /(^|\s)(\d{1,2})[.\/월]\s*(\d{1,2})(?:\([^)]+\))?/;
    const timePattern = /([01]?\d|2[0-3])[:시]\s*([0-5]\d)?/;
    const badTitlePattern = /^(전체|콘서트|뮤지컬\/연극|팬클럽\/팬미팅|클래식|전시\/행사|단독판매|최신순|조회순|오픈일순|오픈예정순|등록순|티켓오픈|오픈|조회수|공지사항|검색|홈|마이|카테고리|이전 페이지|오픈 예정|사항)$/;

    const normalizeDate = (text) => {
      const value = String(text || '');
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const relative = value.match(/오늘|내일|모레/);
      if (relative) {
        const offset = relative[0] === '오늘' ? 0 : relative[0] === '내일' ? 1 : 2;
        const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      }

      const full = value.match(fullDatePattern);
      if (full) {
        const [, year, month, day] = full;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }

      const short = value.match(shortDatePattern);
      if (!short) return null;
      const [, , month, day] = short;
      let year = now.getFullYear();
      const date = new Date(year, Number(month) - 1, Number(day), 23, 59, 59);
      if (date < today) year += 1;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    };

    const normalizeTime = (text) => {
      const match = String(text || '').match(timePattern);
      if (!match) return null;
      return `${match[1].padStart(2, '0')}:${(match[2] || '00').padStart(2, '0')}`;
    };

    const cleanLine = (line) => String(line || '').replace(/\s+/g, ' ').trim();
    const isDateLine = (line) => fullDatePattern.test(line) || shortDatePattern.test(line) || /^(오늘|내일|모레)/.test(line);
    const isBadTitle = (line) => badTitlePattern.test(cleanLine(line));

    const titleFromText = (text, mode) => {
      const lines = String(text || '')
        .split(/\n+/)
        .map(cleanLine)
        .filter(Boolean);
      if (mode === 'melon') {
        const dateIndex = lines.findIndex((line) => /^티켓오픈일/.test(line));
        for (let i = dateIndex - 1; i >= 0; i -= 1) {
          if (!isBadTitle(lines[i]) && !isDateLine(lines[i])) return lines[i];
        }
      }

      const candidates = lines.filter((line) =>
        !isDateLine(line) &&
        !/^(\d+|이전|다음|목록|예매|상세|티켓오픈|오픈공지)$/i.test(line) &&
        !/^(오픈|조회수|일반예매|선예매|등록순|오픈순|장르|지역)$/i.test(line) &&
        !isBadTitle(line) &&
        line.length >= 2
      );
      return (candidates[0] || lines[0] || '').replace(/\[[^\]]*오픈[^\]]*\]/g, '').trim();
    };

    const cleanImg = (s) => {
      if (!s) return '';
      if (s.startsWith('//')) s = `https:${s}`;
      else if (s.startsWith('/')) s = location.origin + s;
      if (/^data:/.test(s)) return '';
      if (/blank|spacer|1x1|noimage|no_image|dummy|placeholder/i.test(s)) return '';
      return s;
    };
    const getImg = (node) => {
      const img = node.querySelector && node.querySelector('img');
      if (img) {
        // 지연로딩 항목은 data-* 에 실제 URL, src 엔 placeholder 가 들어있어 data-* 를 먼저 본다.
        const cand = cleanImg(img.getAttribute('data-src')) || cleanImg(img.getAttribute('data-original'))
          || cleanImg(img.getAttribute('data-lazy')) || cleanImg(img.getAttribute('data-echo'))
          || cleanImg(img.currentSrc) || cleanImg(img.getAttribute('src'));
        if (cand) return cand;
        const ss = img.getAttribute('srcset') || '';
        if (ss) { const c = cleanImg(ss.split(',')[0].trim().split(/\s+/)[0]); if (c) return c; }
      }
      // background-image 로 포스터를 넣는 경우 대비
      if (node.querySelectorAll) {
        for (const el of node.querySelectorAll('*')) {
          const bg = getComputedStyle(el).backgroundImage;
          const m = bg && bg.match(/url\(["']?(.*?)["']?\)/);
          if (m) { const c = cleanImg(m[1]); if (c) return c; }
        }
      }
      return '';
    };

    let sourceNodes = [];
    if (siteId === 'ticketlink') {
      // 신규 모바일 목록은 각 항목이 <a>이고 "…티켓오픈 안내 / 2026.07.14(화) 11:00 / 에 티켓오픈" 형태다.
      // (구 데스크톱 a.info_wrap 도 티켓오픈+날짜 텍스트를 가지므로 같은 필터로 호환된다.)
      sourceNodes = Array.from(document.querySelectorAll('a.info_wrap, a'))
        .filter((node) => {
          const text = node.innerText || node.textContent || '';
          return /티켓오픈/.test(text) && fullDatePattern.test(text);
        })
        .map((node) => ({
          text: node.innerText || node.textContent || '',
          url: node.href || location.href,
          image: getImg(node),
          mode: 'ticketlink',
        }));
    } else if (siteId === 'melon') {
      sourceNodes = Array.from(document.querySelectorAll('a'))
        .filter((node) => /티켓오픈일\s*20\d{2}/.test(node.innerText || node.textContent || ''))
        .map((node) => ({
          text: node.innerText || node.textContent || '',
          url: node.href || location.href,
          mode: 'melon',
        }));
    } else if (siteId === 'interpark') {
      sourceNodes = Array.from(document.querySelectorAll('a'))
        .filter((node) => {
          const lines = (node.innerText || node.textContent || '').split(/\n+/).map(cleanLine).filter(Boolean);
          return lines.length >= 2 && (isDateLine(lines[0]) || /(오늘|내일|모레)\s+([01]?\d|2[0-3])/.test(lines[0]));
        })
        .map((node) => ({
          text: node.innerText || node.textContent || '',
          url: node.href || location.href,
          image: getImg(node),
          mode: 'interpark',
        }));
    } else {
      sourceNodes = Array.from(document.querySelectorAll('a, li, article, tr'))
        .map((node) => ({
          text: node.innerText || node.textContent || '',
          url: node.closest('a')?.href || node.querySelector?.('a[href]')?.href || location.href,
          mode: 'generic',
        }));
    }

    sourceNodes = sourceNodes
      .filter((item) => item.text && item.text.length < 2000)
      .filter((item) => fullDatePattern.test(item.text) || shortDatePattern.test(item.text) || /(오늘|내일|모레)\s+([01]?\d|2[0-3])/.test(item.text));

    const byKey = new Map();
    for (const item of sourceNodes) {
      const openDate = normalizeDate(item.text);
      if (!openDate) continue;
      const openTime = normalizeTime(item.text);
      const title = titleFromText(item.text, item.mode);
      if (!title || isBadTitle(title)) continue;
      const key = `${title}|${openDate}|${openTime || ''}`;
      if (!byKey.has(key)) byKey.set(key, { title, openDate, openTime, url: item.url, image: item.image || '' });
    }

    return Array.from(byKey.values());
  }, siteId);
}

function normalizeItems(items, site) {
  const now = new Date();
  return items
    .map((item) => {
      const title = cleanupTitle(item.title);
      return {
        site: site.name,
        siteId: site.id,
        title,
        openDate: item.openDate,
        openTime: item.openTime,
        openDateTime: item.openDate && item.openTime ? `${item.openDate}T${item.openTime}:00+09:00` : null,
        viewCount: Number.isFinite(item.viewCount) ? item.viewCount : null,
        image: item.image || null,
        url: item.url || site.url,
      };
    })
    .filter((item) => item.title && item.openDate)
    .filter((item) => {
      return new Date(`${item.openDate}T23:59:59+09:00`) >= now;
    });
}

function cleanupTitle(title) {
  const cleaned = String(title || '')
    .replace(/\s+/g, ' ')
    .replace(/티켓오픈|티켓 오픈|오픈공지|공지|안내/gi, '')
    .trim()
    .slice(0, 120);
  if (/^(오늘|내일|모레|\d{1,2}[.\/]\d{1,2}|\d{4}[.\/-]\d{1,2}[.\/-]\d{1,2})/.test(cleaned)) return '';
  return cleaned;
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = itemKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function itemKey(item) {
  return `${item.siteId}|${item.title}|${item.openDate}|${item.openTime || ''}`;
}
