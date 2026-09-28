const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const Model = require('../public/schedule-model');
const { feeds } = require('../public/calendar-subscriptions');

const vendors = { interpark: 'NOL 티켓', melon: '멜론 티켓', ticketlink: '티켓링크' };
const utc = value => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const escape = value => String(value || '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
function fold(line) {
  let output = '', bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character);
    if (bytes + size > 75) { output += '\r\n '; bytes = 1; }
    output += character; bytes += size;
  }
  return output;
}
function openingEvent(item) {
  const start = item.openDateTime || (item.openDate && item.openTime ? `${item.openDate}T${item.openTime}:00+09:00` : '');
  if (!Number.isFinite(Date.parse(start))) return null;
  const sports = item.category === 'sports';
  const identity = sports ? item.id : `${item.siteId}|${item.url || ''}|${item.title}`;
  if (!identity) return null;
  let url = '';
  try { const parsed = new URL(item.url); if (/^https?:$/.test(parsed.protocol)) url = parsed.href; } catch { /* Optional notice link. */ }
  const opening = new Date(Date.parse(start) + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
  const description = [`예매처: ${vendors[item.siteId] || item.site || ''}`, `예매 오픈: ${opening} (한국 시간)`];
  if (sports) {
    description.push(`경기: ${item.gameDate || '미정'} ${item.gameTime || ''}`.trim());
    if (item.venue) description.push(`경기장: ${item.venue}`);
  }
  if (url) description.push(`예매처 공지: ${url}`);
  return {
    uid: `${createHash('sha256').update(identity).digest('hex')}@ticket-open-checker`,
    category: sports ? 'sports' : 'home', siteId: item.siteId, ...(sports ? { teamId: item.teamId } : {}),
    title: `[예매 오픈] ${item.title}`, description: description.join('\n'), url,
    start: new Date(start).toISOString(), end: new Date(Date.parse(start) + 30 * 60000).toISOString(),
    status: /CANCEL/.test(item.saleStatus || '') ? 'CANCELLED' : 'CONFIRMED',
  };
}
function buildState(snapshot, previous = null) {
  const now = Date.parse(snapshot.generatedAt);
  if (!Number.isFinite(now)) throw new Error('Calendar export needs a collection timestamp.');
  const old = new Map((previous?.events || []).map(event => [event.uid, event]));
  const events = new Map();
  const content = ['title', 'description', 'url', 'start', 'end', 'status'];
  for (const item of [...snapshot.items, ...(snapshot.sports?.items || [])]) {
    if (!Model.isUpcoming(item, 'open', now)) continue;
    const event = openingEvent(item);
    if (!event) continue;
    const saved = old.get(event.uid);
    const source = event.category === 'sports' ? snapshot.sports?.teamStatus?.[event.teamId] : snapshot.siteStatus?.[event.siteId];
    if (saved && (!source?.ok || source.fallback || source.stale)) { events.set(event.uid, saved); continue; }
    const changed = !saved || content.some(key => event[key] !== saved[key]);
    events.set(event.uid, { ...event, sequence: saved ? saved.sequence + Number(changed) : 0, modified: changed ? snapshot.generatedAt : saved.modified });
  }
  for (const event of old.values()) {
    if (events.has(event.uid)) continue;
    if (event.status === 'CANCELLED') {
      if (now - Date.parse(event.modified) < 30 * 86400000) events.set(event.uid, event);
      continue;
    }
    if (Date.parse(event.start) < now) continue;
    const status = event.category === 'sports' ? snapshot.sports?.teamStatus?.[event.teamId] : snapshot.siteStatus?.[event.siteId];
    // A failed provider is not evidence of cancellation. Keep its last known event.
    const removed = status?.ok && !status.fallback && !status.stale;
    events.set(event.uid, removed ? { ...event, status: 'CANCELLED', sequence: event.sequence + 1, modified: snapshot.generatedAt } : event);
  }
  return { version: 1, generatedAt: snapshot.generatedAt, events: [...events.values()].sort((a, b) => a.start.localeCompare(b.start) || a.uid.localeCompare(b.uid)) };
}
function buildIcs(feed, events) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TicketOpenChecker//Opening Subscriptions//KO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escape(`${feed.name} · 예매 오픈`)}`, 'X-WR-TIMEZONE:Asia/Seoul',
    'X-WR-CALDESC:티켓 예매 오픈 일정입니다. 반영 시점은 캘린더 앱의 갱신 주기에 따라 달라집니다.'];
  for (const event of events) {
    if (event.category !== feed.category || (feed.teamId && event.teamId !== feed.teamId) || (feed.siteId && event.siteId !== feed.siteId)) continue;
    lines.push('BEGIN:VEVENT', `UID:${event.uid}`, `SEQUENCE:${event.sequence}`, `DTSTAMP:${utc(event.modified)}`, `LAST-MODIFIED:${utc(event.modified)}`,
      `DTSTART:${utc(event.start)}`, `DTEND:${utc(event.end)}`, `SUMMARY:${escape(event.title)}`, `DESCRIPTION:${escape(event.description)}`,
      ...(event.url ? [`URL:${event.url}`] : []), `STATUS:${event.status}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
async function loadPreviousCalendarState(directory, remoteDataUrl) {
  if (remoteDataUrl) {
    const url = new URL('calendars/state.json', remoteDataUrl);
    url.searchParams.set('t', Date.now());
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (response.ok) {
      const state = await response.json();
      if (state.version !== 1 || !Array.isArray(state.events)) throw new Error('Previous calendar state is invalid.');
      return state;
    }
    if (response.status !== 404) throw new Error(`Previous calendar state HTTP ${response.status}`);
  }
  try { return JSON.parse(await fs.readFile(path.join(directory, 'state.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function writeCalendarFeeds(snapshot, previous, directory) {
  const state = buildState(snapshot, previous);
  await fs.mkdir(directory, { recursive: true });
  await Promise.all(feeds.map(feed => fs.writeFile(path.join(directory, `${feed.id}.ics`), buildIcs(feed, state.events), 'utf8')));
  await fs.writeFile(path.join(directory, 'state.json'), JSON.stringify(state, null, 2) + '\n', 'utf8');
  return state;
}
module.exports = { openingEvent, buildState, buildIcs, loadPreviousCalendarState, writeCalendarFeeds };
