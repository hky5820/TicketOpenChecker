const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TEAMS, kstDateTime, normalizeSchedules, mergeSports } = require('../lib/sports');
const model = require('../public/schedule-model');
const now = Date.parse('2026-09-28T19:00:00+09:00');
const team = TEAMS.find(team => team.id === '59');
const raw = {
  scheduleId: 354324833, productId: 61881,
  homeTeam: { teamId: 59, teamName: 'LG트윈스', teamShortName: 'LG' },
  awayTeam: { teamId: 58, teamName: 'KIA 타이거즈', teamShortName: 'KIA' },
  venueName: '잠실야구장', scheduleDate: Date.parse('2026-10-03T14:00:00+09:00'),
  reserveOpenDate: Date.parse('2026-09-26T11:00:00+09:00'),
  reservePreOpenDateTime: Date.parse('2026-09-25T10:00:00+09:00'),
  reserveButtonStatus: 'ON_SALE', reserveCloseDate: Date.parse('2026-10-03T15:00:00+09:00'),
};
const item = normalizeSchedules([raw], team, new Date(now).toISOString())[0];

test('KST timestamps do not depend on host timezone or coerce missing dates to epoch', () => {
  assert.equal(kstDateTime('1790388000000'), '2026-09-26T11:00:00+09:00');
  assert.equal(kstDateTime('2026-09-28T16:00:00Z'), '2026-09-29T01:00:00+09:00');
  for (const value of [null, undefined, '', 'invalid']) assert.equal(kstDateTime(value), null);
});
test('game, general opening and preopening remain separate', () => {
  assert.equal(item.gameDate, '2026-10-03');
  assert.equal(item.openDate, '2026-09-26');
  assert.equal(item.preOpenDateTime, '2026-09-25T10:00:00+09:00');
  assert.equal(item.saleStatus, 'ON_SALE');
  assert.equal(item.url, 'https://m.ticketlink.co.kr/sports/137/59');
});
test('strict home-team ownership and schedule IDs prevent duplicates and cross-team games', () => {
  const wrongHome = { ...raw, scheduleId: 3, homeTeam: { teamId: 58, teamName: 'LG트윈스' } };
  assert.equal(normalizeSchedules([raw, raw, wrongHome], team, 'now').length, 1);
  assert.throws(() => normalizeSchedules([{ ...raw, scheduleDate: null }], team, 'now'));
});
test('preopening never substitutes missing general opening', () => {
  const missing = normalizeSchedules([{ ...raw, reserveOpenDate: null, reserveOpenDateTime: null }], team, 'now')[0];
  assert.equal(missing.openDateTime, null);
  assert.equal(missing.preOpenDateTime, '2026-09-25T10:00:00+09:00');
});
test('expired BEFORE data asks for verification instead of claiming tickets are on sale', () => {
  assert.equal(model.status({ ...item, saleStatus: 'BEFORE' }, now).id, 'unknown');
  assert.equal(model.status(item, now).id, 'open');
  assert.equal(model.status(item, Date.parse('2026-10-03T16:00:00+09:00')).id, 'closed');
  assert.equal(model.status({ ...item, saleStatus: 'CANCEL' }, now).label, '경기 취소');
  assert.equal(model.status({ ...item, saleStatus: 'SOLD_OUT' }, now).label, '매진');
  assert.equal(model.status({ ...item, saleStatus: 'PRE_ON_SALE' }, now).id, 'presale');
});
test('date basis returns precise game or opening date without relaxing filters', () => {
  assert.equal(model.filter([item], { date: '2026-10-03', basis: 'game', team: '59' }, now).length, 1);
  assert.equal(model.filter([item], { date: '2026-10-03', basis: 'open' }, now).length, 0);
  assert.equal(model.filter([item], { date: '2026-09-26', basis: 'open' }, now).length, 0);
  assert.equal(model.filter([item], { date: '2026-10-03', basis: 'game', team: '63' }, now).length, 0);
});
test('upcoming games include tickets already opened; week spans month boundaries', () => {
  assert.equal(model.filter([item], { range: 'upcoming', basis: 'game' }, now).length, 1);
  assert.equal(model.filter([item], { range: 'upcoming', basis: 'open' }, now).length, 0);
  assert.equal(model.filter([item], { range: 'week', date: '2026-09-28', basis: 'game' }, now).length, 1);
  assert.equal(model.filter([item], { range: 'week', date: '2026-09-26', basis: 'game' }, now).length, 0);
  assert.equal(model.dateKey('2026-09-28T16:00:00Z'), '2026-09-29');
});
test('vendor, text and status filters apply together', () => {
  assert.equal(model.filter([item], { range: 'all', vendor: 'melon' }, now).length, 0);
  assert.equal(model.filter([item], { range: 'all', basis: 'game', query: 'kia 잠실', status: 'open' }, now).length, 1);
  assert.equal(model.filter([item], { range: 'all', query: 'kia 잠실', status: 'scheduled' }, now).length, 0);
});
test('failed team keeps last successful snapshot; successful empty removes old games', () => {
  const previous = { items: [item], teamStatus: { '59': { ok: true, checkedAt: 'old' } } };
  const failed = mergeSports({ items: [], teamStatus: { '59': { ok: false } } }, previous);
  assert.equal(failed.items.length, 1);
  assert.equal(failed.teamStatus['59'].stale, true);
  assert.equal(failed.teamStatus['59'].lastSuccessAt, 'old');
  const empty = mergeSports({ items: [], teamStatus: { '59': { ok: true, count: 0 } } }, previous);
  assert.equal(empty.items.length, 0);
  assert.equal(previous.items.length, 1);
});
test('legacy concert alarm keys remain compatible; separate games get separate keys', () => {
  assert.equal(model.itemKey({ siteId: 'melon', title: '공연', openDateTime: '2026-10-01T12:00:00+09:00' }), 'melon|공연|2026-10-01T12:00:00+09:00');
  assert.notEqual(model.itemKey(item), model.itemKey({ ...item, id: 'ticketlink-sports-2' }));
});

test('past openings are excluded even on the same day and in explicit date ranges', () => {
  const concert = time => ({ title: time, siteId: 'melon', openDate: '2026-09-28', openDateTime: `2026-09-28T${time}+09:00` });
  const items = [concert('18:59:59'), concert('19:00:00'), concert('20:00:00')];
  for (const range of ['day', 'week', 'all', 'upcoming']) {
    assert.deepEqual(model.filter(items, { date: '2026-09-28', range }, now).map(item => item.title), ['19:00:00', '20:00:00']);
  }
  assert.equal(model.filter(items, { range: 'upcoming' }, now + 3600001).length, 0);
});

test('future open times come before unknown times and stale unknown dates disappear in KST', () => {
  const items = [
    { title: 'unknown today', openDate: '2026-09-28' },
    { title: 'unknown yesterday', openDate: '2026-09-27' },
    { title: 'later', openDate: '2026-09-30', openDateTime: '2026-09-30T11:00:00+09:00' },
    { title: 'nearest', openDate: '2026-09-29', openDateTime: '2026-09-29T11:00:00+09:00' },
  ];
  assert.deepEqual(model.filter(items, { range: 'upcoming' }, now).map(item => item.title), ['nearest', 'later', 'unknown today']);
  assert.deepEqual(model.filter(items, { range: 'upcoming' }, Date.parse('2026-09-28T15:00:00Z')).map(item => item.title), ['nearest', 'later']);
});

test('game view retains open tickets until game time, opening view excludes past opens', () => {
  const game = { ...item, gameDate: '2026-09-28', gameDateTime: '2026-09-28T19:30:00+09:00' };
  assert.equal(model.filter([game], { basis: 'game', range: 'upcoming' }, now).length, 1);
  assert.equal(model.filter([game], { basis: 'open', range: 'upcoming' }, now).length, 0);
  assert.equal(model.filter([game], { basis: 'game', range: 'upcoming' }, now + 1800001).length, 0);
});
