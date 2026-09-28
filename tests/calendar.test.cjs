const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { feeds, feedUrl } = require('../public/calendar-subscriptions');
const { openingEvent, buildState, buildIcs, writeCalendarFeeds, loadPreviousCalendarState } = require('../lib/calendar-feeds');
const generatedAt = '2026-09-29T00:00:00Z';
const game = { id: 'ticketlink-sports-1', category: 'sports', siteId: 'ticketlink', teamId: '59', title: 'NC vs LG', openDateTime: '2026-09-30T11:00:00+09:00', gameDate: '2026-10-07', gameTime: '18:30', gameDateTime: '2026-10-07T18:30:00+09:00', venue: '잠실 야구장', saleStatus: 'BEFORE', url: 'https://m.ticketlink.co.kr/sports/137/59' };
const concert = { siteId: 'melon', title: '공연 · 일반예매', openDate: '2026-09-30', openTime: '20:00', url: 'https://ticket.melon.com/csoon/detail.htm?csoonId=1' };
const snapshot = (games = [game], items = [concert], time = generatedAt) => ({ generatedAt: time, items, siteStatus: { melon: { ok: true }, interpark: { ok: true }, ticketlink: { ok: true } }, sports: { items: games, teamStatus: Object.fromEntries(['59', '63', '57', '62', '58'].map(id => [id, { ok: true }])) } });
const unfold = text => text.replace(/\r\n[ \t]/g, '');

test('sports calendar uses ticket opening time and keeps game details secondary', () => {
  const event = openingEvent(game);
  assert.equal(event.start, '2026-09-30T02:00:00.000Z');
  assert.equal(event.end, '2026-09-30T02:30:00.000Z');
  assert.match(event.description, /경기: 2026-10-07 18:30/);
  assert.match(event.description, /경기장: 잠실 야구장/);
  assert.match(event.title, /예매 오픈/);
  assert.equal(openingEvent({ ...concert, openTime: null }), null);
  assert.equal(openingEvent({ ...game, openDateTime: 'invalid' }), null);
});

test('new games appear automatically and rescheduling updates the same UID once', () => {
  const initial = buildState(snapshot());
  const same = buildState(snapshot([game], [concert], '2026-09-29T03:00:00Z'), initial);
  assert.deepEqual(same.events, initial.events);
  const changed = buildState(snapshot([{ ...game, openDateTime: '2026-10-01T11:00:00+09:00' }, { ...game, id: 'ticketlink-sports-2', gameDate: '2026-10-08' }], [concert], '2026-09-29T06:00:00Z'), initial);
  assert.equal(changed.events.length, 3);
  const original = initial.events.find(event => event.category === 'sports');
  const updated = changed.events.find(event => event.uid === original.uid);
  assert.equal(updated.start, '2026-10-01T02:00:00.000Z');
  assert.equal(updated.sequence, original.sequence + 1);
  assert.equal(updated.modified, '2026-09-29T06:00:00Z');
});

test('concert time changes retain UID while separate presale rounds remain distinct', () => {
  assert.equal(openingEvent(concert).uid, openingEvent({ ...concert, openDate: '2026-10-02', openTime: '12:00' }).uid);
  assert.notEqual(openingEvent(concert).uid, openingEvent({ ...concert, title: '공연 · 선예매' }).uid);
});

test('cancelled and removed events stay cancelled while failed collections keep last known data', () => {
  const initial = buildState(snapshot());
  const failed = snapshot([]);
  failed.sports.teamStatus['59'] = { ok: false };
  assert.deepEqual(buildState(failed, initial).events, initial.events);
  const cancelled = buildState(snapshot([]), initial);
  const event = cancelled.events.find(event => event.category === 'sports');
  assert.equal(event.status, 'CANCELLED');
  assert.equal(event.sequence, 1);
  const stale = snapshot([game]); stale.sports.teamStatus['59'] = { ok: false, stale: true };
  assert.equal(buildState(stale, cancelled).events.find(item => item.uid === event.uid).status, 'CANCELLED');
  const explicit = buildState(snapshot([{ ...game, saleStatus: 'CANCELLED' }]), initial);
  assert.equal(explicit.events.find(item => item.uid === event.uid).status, 'CANCELLED');
  assert.equal(buildState(snapshot(), cancelled).events.find(item => item.uid === event.uid).sequence, 2);
});

test('feed scopes separate teams and providers and publish valid empty calendars', () => {
  const events = buildState(snapshot([game, { ...game, id: 'other', teamId: '63', title: '한화 홈경기' }])).events;
  const lg = unfold(buildIcs(feeds.find(feed => feed.id === 'sports-59'), events));
  assert.match(lg, /NC vs LG/); assert.doesNotMatch(lg, /한화 홈경기|공연 · 일반예매/);
  const melon = unfold(buildIcs(feeds.find(feed => feed.id === 'concert-melon'), events));
  assert.match(melon, /공연 · 일반예매/); assert.doesNotMatch(melon, /NC vs LG|한화 홈경기/);
  const empty = buildIcs(feeds.find(feed => feed.id === 'sports-62'), events);
  assert.match(empty, /^BEGIN:VCALENDAR\r\n/); assert.match(empty, /END:VCALENDAR\r\n$/); assert.doesNotMatch(empty, /BEGIN:VEVENT/);
  assert.equal(feeds.length, 10);
  assert.equal(feedUrl(feeds.find(feed => feed.id === 'sports-59'), 'https://example.com/app/?v=1'), 'https://example.com/app/calendars/sports-59.ics');
});

test('ICS preserves Korean, escapes content and folds at UTF-8 byte boundaries', () => {
  const title = '한글 🎫 공연 '.repeat(30) + '\r\nBEGIN:VEVENT; 끝, 제목\\';
  const events = buildState(snapshot([], [{ ...concert, title }])).events;
  const text = buildIcs(feeds[0], events), plain = unfold(text);
  assert.equal((plain.match(/\r\nBEGIN:VEVENT\r\n/g) || []).length, 1);
  assert.match(plain, /\\nBEGIN:VEVENT\\; 끝\\, 제목\\\\/);
  assert.match(plain, /DTSTART:20260930T110000Z/);
  assert.ok(text.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
  assert.ok(!text.includes('\uFFFD'));
  assert.ok(!/(^|[^\r])\n/.test(text));
});

test('expired openings and time-unknown notices do not become invented calendar events', () => {
  const state = buildState(snapshot([{ ...game, openDateTime: '2026-09-28T10:00:00+09:00' }], [{ ...concert, openTime: null }]));
  assert.equal(state.events.length, 0);
});

test('calendar exports persist revisions across collection runs', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ticket-calendars-'));
  try {
    await writeCalendarFeeds(snapshot(), null, directory);
    const previous = await loadPreviousCalendarState(directory);
    await writeCalendarFeeds(snapshot([{ ...game, openDateTime: '2026-10-01T11:00:00+09:00' }]), previous, directory);
    const text = unfold(await fs.readFile(path.join(directory, 'sports-59.ics'), 'utf8'));
    assert.match(text, /SEQUENCE:1\r\n/); assert.match(text, /DTSTART:20261001T020000Z/);
    assert.equal((await fs.readdir(directory)).length, 11);
  } finally {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('ticket-calendars-'));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
