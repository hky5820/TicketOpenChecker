const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectMelon, normalizeOpening } = require('../lib/melon');
const notice = (id, fields = {}) => ({ csoonId: id, title: `공연 ${id}`, typeFlg: 'O', hasProdYn: 'N', prodCnt: 1, openDt: '2026.09.29 20:00', posterUrl: '/poster.jpg', ...fields });
const response = data => ({ ok: true, status: 200, json: async () => ({ result: 0, data }) });

test('Melon paginates raw notices even when one notice has no opening date', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    return response({ LIST: url.includes('pageNo=1') ? Array.from({ length: 10 }, (_, index) => notice(index + 1, index === 0 ? { hasProdYn: 'Y', openDt: null } : {})) : [notice(11)] });
  };
  const items = await collectMelon(() => {}, fetchImpl);
  assert.equal(calls.length, 2);
  assert.equal(items.length, 10);
  assert.ok(items.some(item => item.title === '공연 11'));
});

test('Melon expands presale and general opening from the same notice', async () => {
  const items = await collectMelon(() => {}, async url => response(url.includes('/list.json') ? { LIST: [notice(1, { prodCnt: 2 })] } : {
    summCnt: 123,
    prodList: [{ title: '공연', detailList: [{ schTypeFlg: 'F', openDt: '2026.10.07 16:00' }, { schTypeFlg: 'N', openDt: '2026.10.12 18:00' }] }],
  }));
  assert.deepEqual(items.map(item => [item.title, item.openDate, item.openTime]), [['공연 1 · 선예매', '2026-10-07', '16:00'], ['공연 1 · 일반예매', '2026-10-12', '18:00']]);
  assert.equal(items[0].viewCount, 123);
});

test('Melon failures are errors, never successful empty schedules', async () => {
  await assert.rejects(collectMelon(() => {}, async () => ({ ok: false, status: 503 })), /HTTP 503/);
  await assert.rejects(collectMelon(() => {}, async () => ({ ok: true, json: async () => { throw new Error('HTML'); } })), /JSON 대신/);
  await assert.rejects(collectMelon(() => {}, async () => ({ ok: true, json: async () => ({ result: -1, data: {} }) })), /result=-1/);
  await assert.rejects(collectMelon(() => {}, async () => response({})), /LIST/);
  await assert.rejects(collectMelon(() => {}, async () => response({ LIST: [notice(1, { openDt: 'changed-format' })] })), /날짜 형식/);
  assert.deepEqual(await collectMelon(() => {}, async () => response({ LIST: [] })), []);
});

test('Melon unknown time marker and cancelled notices do not invent opening times', async () => {
  assert.equal(normalizeOpening(notice(1), '2026.09.29 23:23').openTime, null);
  assert.equal(normalizeOpening(notice(1), null), null);
  const items = await collectMelon(() => {}, async () => response({ LIST: [notice(1, { typeFlg: 'C' }), notice(2, { openDt: '2026.09.29 23:23' })] }));
  assert.equal(items.length, 1);
  assert.equal(items[0].openTime, null);
});

test('Melon overlapping pages deduplicate notices; missing detail cannot silently pass', async () => {
  const first = Array.from({ length: 10 }, (_, index) => notice(index + 1));
  const items = await collectMelon(() => {}, async url => response({ LIST: url.includes('pageNo=1') ? first : [notice(10), notice(11)] }));
  assert.equal(items.length, 11);
  await assert.rejects(collectMelon(() => {}, async url => response(url.includes('/list.json') ? { LIST: [notice(1, { prodCnt: 2 })] } : {})), /상세 오픈 일정/);
});

test('Melon lottery and multiple opening rounds retain their actual labels', async () => {
  const items = await collectMelon(() => {}, async url => response(url.includes('/list.json') ? { LIST: [notice(1, { prodCnt: 2 })] } : {
    prodList: [{ title: '공연', detailList: [{ schTypeFlg: 'R', openDt: '2026.10.01 18:00', schTypeFlgCnt: 1 }, { schTypeFlg: 'N', openDt: '2026.10.02 18:00', schTypeFlgCnt: 2, typeGroupRnum: 2 }] }],
  }));
  assert.deepEqual(items.map(item => item.title), ['공연 1 · 추첨식', '공연 1 · 일반예매 2차']);
});
