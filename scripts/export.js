const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.EXPORT_PORT || 3177);
const DATA_PATH = path.join(PUBLIC_DIR, 'data.json');
const ICS_PATH = path.join(PUBLIC_DIR, 'calendar.ics');

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  const previousItems = await loadPreviousItems();
  const server = await startServer();

  try {
    const loaded = await collectItems(`http://127.0.0.1:${server.port}/api/load`);
    const items = fillMissingSites(normalizeForExport(loaded.items), previousItems);
    const loadedAt = loaded.loadedAt || new Date().toISOString();

    // 상세 수집 실패가 배포 자체를 막으면 안 된다.
    try {
      await enrichDetails(items, previousItems);
    } catch (error) {
      console.log(`[detail] skipped: ${error.message}`);
    }

    await fs.writeFile(DATA_PATH, `${JSON.stringify({
      generatedAt: loadedAt,
      itemCount: items.length,
      items,
    }, null, 2)}\n`, 'utf8');
    await fs.writeFile(ICS_PATH, buildIcs(items, loadedAt), 'utf8');

    const newItems = diffItems(items, previousItems);
    await sendTelegramSummary(newItems, items, loadedAt);
    console.log(`Exported ${items.length} items (${newItems.length} new).`);
  } finally {
    server.child.kill();
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        HEADLESS: '1',
        CHROME_PROFILE_DIR: path.join(ROOT, 'output', 'export-chrome-profile'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Timed out waiting for export server to start.'));
    }, 30000);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      const match = text.match(/localhost:(\d+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolve({ child, port: Number(match[1]) });
    });

    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Export server exited with code ${code}.`));
      }
    });
  });
}

async function collectItems(url) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to load schedules: HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let donePayload = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';

    for (const part of parts) {
      const event = parseSseEvent(part);
      if (!event) continue;
      if (event.type === 'fatal') {
        throw new Error(event.data.message || 'Schedule loading failed.');
      }
      if (event.type === 'done') {
        donePayload = event.data;
      }
    }
  }

  if (!donePayload) throw new Error('Schedule loading ended without a done event.');
  return donePayload;
}

function parseSseEvent(block) {
  const lines = block.split(/\r?\n/);
  const type = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n');
  if (!type || !data) return null;
  return { type, data: JSON.parse(data) };
}

function normalizeForExport(items) {
  return [...items].sort((a, b) => {
    const left = a.openDateTime || `${a.openDate}T99:99:99`;
    const right = b.openDateTime || `${b.openDate}T99:99:99`;
    return left.localeCompare(right) || a.title.localeCompare(b.title, 'ko');
  });
}

async function loadPreviousItems() {
  const urls = [];
  if (process.env.PREVIOUS_DATA_URL) urls.push(process.env.PREVIOUS_DATA_URL);
  if (process.env.GITHUB_REPOSITORY) {
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
    urls.push(`https://${owner}.github.io/${repo}/data.json`);
  }

  // 원격(마지막 배포본) + 로컬 저장본을 모두 모아 dedupe 한다.
  // 한 예매처가 일시적으로 0건이어도 직전 데이터로 채우기 위함이다.
  const collected = new Map();
  const absorb = (items) => {
    if (Array.isArray(items)) for (const item of items) collected.set(itemKey(item), item);
  };

  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) continue;
      const payload = await response.json();
      absorb(Array.isArray(payload) ? payload : payload.items);
    } catch {
      // Previous exports are optional, especially on the first run.
    }
  }

  try {
    const localRaw = await fs.readFile(DATA_PATH, 'utf8');
    const payload = JSON.parse(localRaw);
    absorb(Array.isArray(payload) ? payload : payload.items);
  } catch {
    // 로컬 저장본이 없을 수 있다.
  }

  return Array.from(collected.values());
}

// 특정 예매처가 이번 수집에서 0건이면 직전(미래 일정) 데이터를 유지한다.
const EXPECTED_SITES = ['interpark', 'melon', 'ticketlink'];
function fillMissingSites(items, previousItems) {
  if (!previousItems.length) return items;
  const present = new Set(items.map((item) => item.siteId));
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const isFuture = (item) => {
    if (!item.openDate) return true;
    return new Date(`${item.openDate}T23:59:59+09:00`) >= startOfToday;
  };

  const extras = [];
  for (const siteId of EXPECTED_SITES) {
    if (present.has(siteId)) continue;
    const kept = previousItems.filter((item) => item.siteId === siteId && isFuture(item));
    if (kept.length) {
      extras.push(...kept);
      console.log(`[fallback] ${siteId} returned 0 items; kept ${kept.length} from previous export.`);
    }
  }
  return extras.length ? normalizeForExport([...items, ...extras]) : items;
}

// 예매처 공지 본문을 data.json에 담아 클라이언트 미리보기 모달에서 쓴다.
// (mapi/interpark 상세는 CORS가 막혀 있어 클라이언트에서 직접 못 불러온다.)
// 본문은 사실상 불변이라 이전 export의 detail을 url 기준으로 재사용하고, 새 항목만 가져온다.
// 멜론은 tktapi가 CORS 개방이라 클라이언트가 실시간 조회한다.
const DETAIL_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function enrichDetails(items, previousItems) {
  const cache = new Map(previousItems
    .filter((item) => item.url && Array.isArray(item.detail))
    .map((item) => [item.url, item.detail]));
  let fetched = 0;
  for (const item of items) {
    if (Array.isArray(item.detail)) continue;
    if (cache.has(item.url)) { item.detail = cache.get(item.url); continue; }
    try {
      let detail;
      if (item.siteId === 'ticketlink') detail = await fetchTicketlinkDetail(item.url);
      else if (item.siteId === 'interpark') detail = await fetchInterparkDetail(item.url);
      else continue;
      if (detail && detail.length) item.detail = detail;
      fetched += 1;
      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch (error) {
      console.log(`[detail] ${item.siteId} ${item.url}: ${error.message}`);
    }
  }
  console.log(`[detail] fetched ${fetched} new details.`);
}

async function fetchTicketlinkDetail(url) {
  const id = /notice\/(\d+)/.exec(url || '')?.[1];
  if (!id) return null;
  const res = await fetch(`https://mapi.ticketlink.co.kr/mapi/notice/${id}`, {
    headers: { 'User-Agent': DETAIL_UA, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const notice = (await res.json())?.data?.notice;
  if (!notice?.content) return null;
  return [['안내', notice.content]];
}

async function fetchInterparkDetail(url) {
  const id = /detail\/(\d+)/.exec(url || '')?.[1];
  if (!id) return null;
  const res = await fetch(`https://tickets.interpark.com/contents/notice/detail/${id}`, {
    headers: { 'User-Agent': DETAIL_UA },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const match = html.match(/__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  const detail = match && JSON.parse(match[1])?.props?.pageProps?.data?.detail;
  if (!detail) return null;
  const period = [detail.goodsStartDateStr, detail.goodsEndDateStr]
    .map((s) => String(s || '').slice(0, 10)).filter(Boolean).join(' ~ ');
  const info = [
    period && `관람일정 : ${period}`,
    detail.venueName && `관람장소 : ${detail.venueName}`,
    detail.goodsAgeRatingStr && `관람연령 : ${detail.goodsAgeRatingStr}`,
    detail.goodsInfo && `공연시간 : ${detail.goodsInfo}`,
  ].filter(Boolean).join('<br>');
  return [
    ['공연정보', info],
    ['공연소개', detail.goodsIntroduce],
    ['캐스팅', detail.castingInfo],
    ['기획사 정보', detail.bizInfo],
  ].filter(([, value]) => value && String(value).trim());
}

function diffItems(items, previousItems) {
  if (!previousItems.length) return items;
  const previous = new Set(previousItems.map(itemKey));
  return items.filter((item) => !previous.has(itemKey(item)));
}

function itemKey(item) {
  return `${item.siteId}|${item.title}|${item.openDate}|${item.openTime || ''}`;
}

function buildIcs(items, loadedAt) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TicketOpenChecker//Ticket Open Calendar//KO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Ticket Open Checker',
    'X-WR-TIMEZONE:Asia/Seoul',
  ];

  items
    .filter((item) => item.openDate && item.openTime)
    .forEach((item) => {
      const start = new Date(`${item.openDate}T${item.openTime}:00+09:00`);
      const end = new Date(start.getTime() + 30 * 60 * 1000);
      lines.push(
        'BEGIN:VEVENT',
        `UID:${escapeIcs(itemKey(item))}@ticket-open-checker`,
        `DTSTAMP:${formatIcsUtc(new Date(loadedAt))}`,
        `DTSTART:${formatIcsUtc(start)}`,
        `DTEND:${formatIcsUtc(end)}`,
        `SUMMARY:${escapeIcs(`[${item.site}] ${item.title}`)}`,
        `DESCRIPTION:${escapeIcs(`${item.openDate} ${item.openTime} ticket open\\n${item.url || ''}`)}`,
        item.url ? `URL:${escapeIcs(item.url)}` : '',
        'END:VEVENT'
      );
    });

  lines.push('END:VCALENDAR');
  return `${lines.filter(Boolean).join('\r\n')}\r\n`;
}

function formatIcsUtc(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeIcs(value) {
  return String(value || '')
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replace(/\r?\n/g, '\\n');
}

async function sendTelegramSummary(newItems, allItems, loadedAt) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId || !newItems.length) return;

  const pageUrl = process.env.PAGE_URL || pageUrlFromRepository();
  const lines = [
    `티켓 오픈 새 일정 ${newItems.length}건`,
    `전체 ${allItems.length}건 / ${formatKoreanTime(loadedAt)}`,
    '',
    ...newItems.slice(0, 18).map((item) =>
      `${item.openDate} ${item.openTime || '시간 미정'} · ${item.site} · ${item.title}`
    ),
  ];
  if (newItems.length > 18) lines.push(`외 ${newItems.length - 18}건`);
  if (pageUrl) lines.push('', pageUrl);

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: lines.join('\n'),
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Telegram sendMessage failed: HTTP ${response.status} ${text}`);
  }
}

function pageUrlFromRepository() {
  if (!process.env.GITHUB_REPOSITORY) return '';
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
  return `https://${owner}.github.io/${repo}/`;
}

function formatKoreanTime(value) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}
