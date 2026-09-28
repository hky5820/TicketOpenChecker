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
  await assert.rejects(collectMelon(() => {}, async () => ({ ok: false, status: 503 }), async () => {}), /HTTP 503/);
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

test('Melon recovers a transient 423 on a later page without losing previous notices', async () => {
  const messages = [], waits = [];
  let secondPageCalls = 0;
  const items = await collectMelon(message => messages.push(message), async url => {
    if (url.includes('pageNo=1')) return response({ LIST: Array.from({ length: 10 }, (_, i) => notice(i + 1)) });
    if (++secondPageCalls === 1) return { ok: false, status: 423 };
    return response({ LIST: [notice(11)] });
  }, async delay => waits.push(delay));
  assert.equal(items.length, 11);
  assert.equal(secondPageCalls, 2);
  assert.deepEqual(waits, [2000]);
  assert.ok(messages.some(message => /목록 2페이지 HTTP 423.*2\/3회 재시도/.test(message)));
});

test('Melon keeps persistent detail failures as errors after three attempts', async () => {
  let detailCalls = 0;
  const waits = [];
  await assert.rejects(collectMelon(() => {}, async url => {
    if (url.includes('/list.json')) return response({ LIST: [notice(1), notice(2, { prodCnt: 2 })] });
    detailCalls++;
    return { ok: false, status: 423 };
  }, async delay => waits.push(delay)), /HTTP 423 \(공지 2 상세, 3\/3회 시도\)/);
  assert.equal(detailCalls, 3);
  assert.deepEqual(waits, [2000, 5000]);
});

test('Melon respects Retry-After and stops if the requested wait exceeds the collection budget', async () => {
  let calls = 0;
  const waits = [];
  const items = await collectMelon(() => {}, async () => ++calls === 1
    ? { ok: false, status: 429, headers: new Headers({ 'Retry-After': '8' }) }
    : response({ LIST: [notice(1)] }), async delay => waits.push(delay));
  assert.equal(items.length, 1);
  assert.deepEqual(waits, [8000]);
  calls = 0;
  await assert.rejects(collectMelon(() => {}, async () => {
    calls++;
    return { ok: false, status: 429, headers: new Headers({ 'Retry-After': '120' }) };
  }, async () => assert.fail('must not retry before Retry-After')), /HTTP 429/);
  assert.equal(calls, 1);
});

test('Melon retries connection failures but does not retry permanent HTTP errors', async () => {
  let calls = 0;
  const items = await collectMelon(() => {}, async () => {
    if (++calls === 1) throw new TypeError('fetch failed');
    return response({ LIST: [notice(1)] });
  }, async () => {});
  assert.equal(calls, 2);
  assert.equal(items.length, 1);
  await assert.rejects(collectMelon(() => {}, async () => ({ ok: false, status: 404 }), async () => assert.fail('must not retry permanent errors')), /HTTP 404.*목록 1페이지, 1\/3회/);
});
