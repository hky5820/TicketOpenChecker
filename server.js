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
    const globalSeen = new Set();
    const streamItems = (site, rawItems) => {
      const normalized = dedupeItems(normalizeItems(rawItems, site))
        .filter((item) => {
          const key = itemKey(item);
          if (globalSeen.has(key)) return false;
          globalSeen.add(key);
          return true;
        });
      if (!normalized.length) return [];
      allItems.push(...normalized);
      send('items', {
        site: site.id,
        items: normalized,
        total: allItems.length,
      });
      return normalized;
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
  await page.goto('https://tickets.interpark.com/contents/notice', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  progress('공지 목록 로딩 중');
  emit(await extractItemsFromPage(page, 'interpark'));

  let previous = 0;
  for (let i = 0; i < 8; i += 1) {
    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(900);
    emit(await extractItemsFromPage(page, 'interpark'));
    const count = await page.locator('a').count().catch(() => 0);
    progress(`스크롤 로딩 ${i + 1}/8, 링크 ${count}개 확인`);
    if (count === previous) break;
    previous = count;
  }
}

async function scrapeMelon(page, progress, emit) {
  // 멜론은 PC(데스크톱) 모드로 접속한다. 데스크톱 목록은 li 한 줄에
  // '티켓오픈일 · 날짜/시간 · 제목 · 조회수'가 모두 있고 상세 링크(csoonId)도 노출된다.
  await page.goto('https://ticket.melon.com/csoon/index.htm#orderType=0&pageIndex=1&schGcode=GENRE_ALL&schText=&schDt=', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  progress('오픈예정 목록 로딩 중 (PC 모드)');
  emit(await extractMelonDesktopItems(page));

  let prevFirst = await melonFirstKey(page);
  for (let pageIndex = 2; pageIndex <= 10; pageIndex += 1) {
    const moved = await gotoMelonPage(page, pageIndex, prevFirst);
    if (!moved) break;
    emit(await extractMelonDesktopItems(page));
    progress(`목록 ${pageIndex}페이지 수집`);
    prevFirst = await melonFirstKey(page);
  }
}

async function melonFirstKey(page) {
  return page.evaluate(() => {
    const li = Array.from(document.querySelectorAll('li'))
      .find((n) => /티켓오픈일/.test(n.innerText || '') && /조회/.test(n.innerText || ''));
    return li ? (li.innerText || '').replace(/\s+/g, ' ').slice(0, 80) : '';
  }).catch(() => '');
}

async function gotoMelonPage(page, pageIndex, prevFirst) {
  const clicked = await page.evaluate((n) => {
    const link = Array.from(document.querySelectorAll('a, button'))
      .find((a) => (a.textContent || '').trim() === String(n));
    if (!link) return false;
    link.click();
    return true;
  }, pageIndex).catch(() => false);
  if (!clicked) return false;
  try {
    await page.waitForFunction((prev) => {
      const li = Array.from(document.querySelectorAll('li'))
        .find((n) => /티켓오픈일/.test(n.innerText || '') && /조회/.test(n.innerText || ''));
      return li && (li.innerText || '').replace(/\s+/g, ' ').slice(0, 80) !== prev;
    }, prevFirst, { timeout: 6000 });
  } catch {
    return false;
  }
  await page.waitForTimeout(400);
  return true;
}

async function extractMelonDesktopItems(page) {
  return page.evaluate(() => {
    const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const items = [];
    const seen = new Set();
    for (const li of Array.from(document.querySelectorAll('li'))) {
      const text = li.innerText || '';
      if (!/티켓오픈일/.test(text)) continue;
      const dm = text.match(/(20\d{2})\.(\d{1,2})\.(\d{1,2})\s*\([^)]*\)\s*(\d{1,2}):(\d{2})/);
      if (!dm) continue;
      const openDate = `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}`;
      const openTime = `${dm[4].padStart(2, '0')}:${dm[5]}`;
      const vm = text.match(/조회\s*([\d,]+)/);
      const viewCount = vm ? Number(vm[1].replace(/,/g, '')) : null;
      let title = clean(li.querySelector('.tit, strong, .title') ? li.querySelector('.tit, strong, .title').textContent : '');
      if (!title) {
        const lines = text.split(/\n+/).map(clean).filter(Boolean);
        title = lines.find((l) => !/^(티켓오픈일|단독판매|등록일|조회|20\d{2}\.)/.test(l) && l.length > 2) || '';
      }
      if (!title) continue;
      const a = li.querySelector('a');
      const href = a ? (a.getAttribute('href') || '') : '';
      const idm = href.match(/csoonId=(\d+)/);
      const url = idm
        ? `https://ticket.melon.com/csoon/detail.htm?csoonId=${idm[1]}`
        : 'https://ticket.melon.com/csoon/index.htm';
      const imgEl = li.querySelector('img');
      let image = imgEl ? (imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '') : '';
      if (image && image.startsWith('//')) image = `https:${image}`;
      const key = `${title}|${openDate}|${openTime}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ title, openDate, openTime, viewCount, url, image });
    }
    return items;
  });
}

async function scrapeTicketlink(page, progress, emit) {
  // 티켓링크는 모바일 UA일 때 m.ticketlink.co.kr(React SPA)로 리다이렉트된다.
  // 옛 데스크톱 사이트의 a.info_wrap / getNoticeList() 전역이 없으므로,
  // 무한 스크롤로 목록을 늘려가며 텍스트 기반으로 추출한다.
  await page.goto('https://www.ticketlink.co.kr/help/notice#TICKET_OPEN', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  progress('오픈 예정 목록 로딩 중');
  emit(await extractItemsFromPage(page, 'ticketlink'));

  let previous = 0;
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.wheel(0, 2600);
    await page.waitForTimeout(900);
    emit(await extractItemsFromPage(page, 'ticketlink'));
    const count = await page.locator('a').count().catch(() => 0);
    progress(`스크롤 로딩 ${step}/12, 링크 ${count}개 확인`);
    if (count === previous) break;
    previous = count;
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
