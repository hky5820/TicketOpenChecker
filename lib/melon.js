const API = 'https://tktapi.melon.com/poc/ticketOpen';
const { setTimeout: sleep } = require('node:timers/promises');

async function readJson(url, fetchImpl, progress, wait) {
  const request = new URL(url);
  const source = request.pathname.endsWith('/list.json') ? `목록 ${request.searchParams.get('pageNo')}페이지` : `공지 ${request.searchParams.get('csoonId')} 상세`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let response, failure;
    try {
      response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    } catch (error) {
      failure = error.name === 'TimeoutError' ? '20초 시간 초과' : '연결 실패';
    }
    if (response?.ok) {
      let json;
      try { json = await response.json(); } catch { throw new Error(`멜론 API가 JSON 대신 오류 페이지를 반환했습니다. (${source})`); }
      if (json.result !== 0 || !json.data) throw new Error(`멜론 API 응답 오류 (result=${json.result}, ${source})`);
      return json.data;
    }
    failure ||= `HTTP ${response.status}`;
    const error = new Error(`멜론 API ${failure} (${source}, ${attempt}/3회 시도)`);
    await response?.body?.cancel().catch(() => {});
    if (attempt === 3 || (response && ![423, 429, 500, 502, 503, 504].includes(response.status))) throw error;
    const retryAfter = response?.headers?.get('retry-after');
    const retryMs = retryAfter ? (/^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now()) : 0;
    const delay = Math.max(attempt === 1 ? 2000 : 5000, Number.isFinite(retryMs) ? retryMs : 0);
    // Do not retry earlier than requested or keep the whole export waiting indefinitely.
    if (delay > 20000) throw error;
    progress(`${source} ${failure} · ${delay / 1000}초 후 ${attempt + 1}/3회 재시도`);
    await wait(delay);
  }
}

function normalizeOpening(notice, openDt, label = '', viewCount = null) {
  const date = /^(20\d{2})\.(\d{2})\.(\d{2})(?: (\d{2}):(\d{2}))?$/.exec(openDt || '');
  if (openDt && !date) throw new Error(`멜론 공지 ${notice.csoonId}의 오픈 날짜 형식이 변경되었습니다.`);
  if (!date) return null;
  return {
    title: `${notice.title}${label ? ` · ${label}` : ''}`,
    openDate: `${date[1]}-${date[2]}-${date[3]}`,
    // Melon's own UI treats 23:23 as an unknown-time marker.
    openTime: date[4] && `${date[4]}:${date[5]}` !== '23:23' ? `${date[4]}:${date[5]}` : null,
    image: notice.posterUrl ? new URL(notice.posterUrl, 'https://cdnticket.melon.co.kr').href : null,
    url: `https://ticket.melon.com/csoon/detail.htm?csoonId=${notice.csoonId}`,
    viewCount,
  };
}

// Same public JSON API used by m.ticket.melon.com/#ticketopen.index.
// Pagination follows raw notice count, never the number of parsed opening times.
async function collectMelon(progress = () => {}, fetchImpl = fetch, wait = sleep) {
  const notices = new Map();
  for (let pageNo = 1; pageNo <= 10; pageNo++) {
    const data = await readJson(`${API}/list.json?sortType=OPEN&pageNo=${pageNo}&gCode=&v=1`, fetchImpl, progress, wait);
    if (!Array.isArray(data.LIST)) throw new Error('멜론 목록 응답에 LIST가 없습니다.');
    for (const notice of data.LIST) {
      if (!notice.csoonId || !notice.title) throw new Error('멜론 목록의 공지 식별자 또는 제목이 없습니다.');
      notices.set(notice.csoonId, notice);
    }
    progress(`오픈일순 ${pageNo}페이지 (${notices.size}개 공지)`);
    if (data.LIST.length < 10) break;
    if (pageNo === 10) throw new Error('멜론 목록이 조회 한도를 초과했습니다. 일부 결과를 최신 자료로 처리하지 않습니다.');
  }
  const items = new Map();
  const add = item => { if (item) items.set(`${item.url}|${item.title}|${item.openDate}|${item.openTime}`, item); };
  for (const notice of notices.values()) {
    if (notice.typeFlg === 'C' || notice.hasProdYn === 'Y') continue;
    if (Number(notice.prodCnt) > 1) {
      const detail = await readJson(`${API}/detail.json?csoonId=${notice.csoonId}&v=1`, fetchImpl, progress, wait);
      if (!Array.isArray(detail.prodList) || !detail.prodList.length) throw new Error(`멜론 공지 ${notice.csoonId}의 상세 오픈 일정이 없습니다.`);
      for (const product of detail.prodList) {
        if (!Array.isArray(product.detailList)) throw new Error(`멜론 공지 ${notice.csoonId}의 상품 일정 형식이 변경되었습니다.`);
        for (const opening of product.detailList) {
          const type = { N: '일반예매', F: '선예매', R: '추첨식' }[opening.schTypeFlg] || '';
          const label = Number(opening.schTypeFlgCnt) > 1 ? `${type} ${opening.typeGroupRnum}차` : type;
          const productLabel = detail.prodList.length > 1 ? product.title || '' : '';
          add(normalizeOpening(notice, opening.openDt, [productLabel, label].filter(Boolean).join(' · '), Number.isFinite(detail.summCnt) ? detail.summCnt : null));
        }
      }
    } else add(normalizeOpening(notice, notice.openDt));
  }
  progress(`${items.size}개 오픈 일정 확인`);
  return [...items.values()];
}

module.exports = { collectMelon, normalizeOpening };
