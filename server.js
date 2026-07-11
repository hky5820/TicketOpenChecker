const express = require('express');
const path = require('path');
const { chromium } = require('playwright');

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
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/load', async (req, res) => {
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
    // 멜론은 PC(데스크톱) 모드로 접속해야 목록·조회수를 쉽게 읽을 수 있어 별도 컨텍스트를 쓴다.
    desktopContext = await launchDesktopContext();

    const allItems = [];
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

    await Promise.all(SITES.map(async (site) => {
      const page = await (site.desktop ? desktopContext : context).newPage();
      try {
        send('status', { site: site.id, message: `${site.name} 접속 중` });
        await site.scrape(
          page,
          (message) => send('status', { site: site.id, message }),
          (items) => streamItems(site, items)
        );
        const count = allItems.filter((item) => item.siteId === site.id).length;
        send('siteDone', { site: site.id, count });
      } catch (error) {
        send('siteError', { site: site.id, message: error.message });
      } finally {
        await page.close().catch(() => {});
      }
    }));

    allItems.sort((a, b) => {
      const at = a.openDateTime ? new Date(a.openDateTime).getTime() : Number.MAX_SAFE_INTEGER;
      const bt = b.openDateTime ? new Date(b.openDateTime).getTime() : Number.MAX_SAFE_INTEGER;
      return at - bt || a.title.localeCompare(b.title, 'ko');
    });

    send('done', { items: dedupeItems(allItems), loadedAt: new Date().toISOString() });
  } catch (error) {
    send('fatal', { message: error.message });
  } finally {
    await context?.close().catch(() => {});
    await desktopContext?.close().catch(() => {});
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
  // 멜론 전용 PC(데스크톱) 컨텍스트 — 데스크톱 목록은 조회수/상세링크가 그대로 노출돼 파싱이 쉽다.
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

async function scrapeMelon(page, progress, emit) {
  // 멜론 오픈예정 목록 API(csoon/ajax/listTicketOpen.htm, POST)를 페이지 컨텍스트에서 호출한다.
  // (조회수는 세션 쿠키가 있어야 내려와서, 페이지를 한 번 연 뒤 그 안에서 fetch 한다.)
  // 응답 HTML 한 항목에 제목/오픈일시/조회수/포스터/상세링크(csoonId)가 모두 들어있다.
  await page.goto('https://ticket.melon.com/csoon/index.htm#orderType=0&pageIndex=1&schGcode=GENRE_ALL&schText=&schDt=', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);

  const collected = new Map();
  for (let pageIndex = 1; pageIndex <= 10; pageIndex += 1) {
    const items = await fetchMelonPage(page, pageIndex);
    if (!items.length) break;
    items.forEach((item) => { if (!collected.has(item.url)) collected.set(item.url, item); });
    emit(items);
    progress(`오픈예정 목록 ${pageIndex}페이지 (${collected.size}건)`);
    if (items.length < 10) break; // 마지막 페이지
  }
  progress(`${collected.size}건`);
}

async function fetchMelonPage(page, pageIndex) {
  return page.evaluate(async (idx) => {
    const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    let html = '';
    try {
      const body = new URLSearchParams({ orderType: '0', pageIndex: String(idx), schGcode: 'GENRE_ALL', schText: '', schDt: '' }).toString();
      const res = await fetch('https://ticket.melon.com/csoon/ajax/listTicketOpen.htm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
        body,
      });
      html = await res.text();
    } catch (e) {
      return [];
    }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const items = [];
    const seen = new Set();
    for (const li of Array.from(doc.querySelectorAll('li'))) {
      const text = clean(li.innerText || li.textContent || '');
      if (!/티켓오픈일/.test(text)) continue;
      const dm = text.match(/(20\d{2})\.(\d{1,2})\.(\d{1,2})\s*\([^)]*\)\s*(\d{1,2}):(\d{2})/);
      if (!dm) continue;
      const openDate = `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}`;
      const openTime = `${dm[4].padStart(2, '0')}:${dm[5]}`;
      const vm = text.match(/조회\s*([\d,]+)/);
      const viewCount = vm ? Number(vm[1].replace(/,/g, '')) : null;
      const titEl = li.querySelector('.tit, strong, .title');
      const title = clean(titEl ? titEl.textContent : '');
      if (!title) continue;
      const cLink = li.querySelector('a[href*="csoonId"]');
      const cid = (cLink ? cLink.getAttribute('href') || '' : '').match(/csoonId=(\d+)/);
      // 모바일 딥링크를 기본 URL로 사용한다: 모바일에선 그대로 상세 SPA로,
      // 데스크톱에선 ticket.melon.com/csoon/detail.htm 로 리다이렉트되어 양쪽 다 정상.
      // (데스크톱 URL을 쓰면 모바일에서 홈으로 튕기는 문제가 있었다.)
      const url = cid
        ? `https://m.ticket.melon.com/public/index.html#ticketopen.detail?csoonId=${cid[1]}`
        : 'https://m.ticket.melon.com/public/index.html#ticketopen.list';
      const imgEl = li.querySelector('img');
      let image = imgEl ? (imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '') : '';
      if (image.startsWith('//')) image = `https:${image}`;
      const key = `${title}|${openDate}|${openTime}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ title, openDate, openTime, viewCount, image, url });
    }
    return items;
  }, pageIndex);
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
      if (!item.openDateTime) return new Date(`${item.openDate}T23:59:59+09:00`) >= now;
      return new Date(item.openDateTime) >= now;
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
