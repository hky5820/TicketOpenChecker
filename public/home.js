/* 티켓오픈 홈 — 시간대 포커스 스크롤 (다크+그린) */
const STORAGE_KEY = 'ticket-open-checker:schedules';
const VENDOR_KEY = 'toc:homeVendor';
const VN = { interpark: 'NOL 티켓', melon: '멜론 티켓', ticketlink: '티켓링크' };
const VTAB = { interpark: 'NOL티켓', melon: '멜론티켓', ticketlink: '티켓링크' };
const VORDER = ['interpark', 'ticketlink', 'melon'];
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const UNSET = '미정';

const state = {
  items: [],
  dateKey: null,          // 'YYYY-MM-DD'
  vendor: readVendor(),
  view: 'home',
  calMonth: null,         // Date (1일)
  generatedAt: null,
};

function readVendor() {
  try {
    const v = localStorage.getItem(VENDOR_KEY);
    return ['interpark', 'melon', 'ticketlink'].includes(v) ? v : null;
  } catch { return null; }
}

const $ = (s) => document.querySelector(s);

/* 모바일 주소창/제스처 바 때문에 dvh가 어긋나는 기기 대응: 실제 보이는 높이를 실측 */
function setVH() {
  const h = (window.visualViewport ? window.visualViewport.height : window.innerHeight);
  document.documentElement.style.setProperty('--vh', `${Math.round(h)}px`);
}
setVH();
(window.visualViewport || window).addEventListener('resize', setVH);
window.addEventListener('orientationchange', () => setTimeout(setVH, 250));
const feed = $('#feed'), daysEl = $('#days'), vtabsEl = $('#vtabs'), ov = $('#ov');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pad = (n) => String(n).padStart(2, '0');
const localKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayKey = () => localKey(new Date());
const dkeyOf = (it) => (it.openDate || (it.openDateTime || '').slice(0, 10) || '');
const openMs = (dk, t) => new Date(`${dk}T${t}:00+09:00`).getTime();
const secTo = (dk, t) => Math.floor((openMs(dk, t) - Date.now()) / 1000);
const isPastG = (dk, t) => t !== UNSET && secTo(dk, t) <= 0;

function cdText(dk, t) {
  const s = secTo(dk, t);
  if (s <= 0) return '오픈';
  if (s < 3600) return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분`;
  return `${Math.floor(s / 86400)}일 ${Math.floor((s % 86400) / 3600)}시간`;
}
function fmtDate(dk, withYear) {
  const [y, m, d] = dk.split('-').map(Number);
  const w = WD[new Date(y, m - 1, d).getDay()];
  return `${withYear ? y + '년 ' : ''}${m}월 ${d}일 ${w}요일`;
}

/* ── 데이터 접근 ── */
const vendorItems = () => state.items.filter((i) => !state.vendor || i.siteId === state.vendor);
function dayMap() {
  const m = new Map();
  vendorItems().forEach((i) => {
    const k = dkeyOf(i);
    if (!k) return;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(i);
  });
  return m;
}
function groupsOf(dk) {
  const items = dayMap().get(dk) || [];
  const g = {};
  items.forEach((i) => {
    const t = i.openTime || UNSET;
    (g[t] = g[t] || []).push(i);
  });
  return Object.entries(g)
    .sort((a, b) => (a[0] === UNSET ? 1 : b[0] === UNSET ? -1 : a[0].localeCompare(b[0])))
    .map(([t, its]) => ({ t, items: [...its].sort((x, y) => (y.viewCount || 0) - (x.viewCount || 0)) }));
}

/* ── 틱 피드백 ── */
function tickFx() {
  try { if (navigator.vibrate) navigator.vibrate(5); } catch { /* 미지원 무시 */ }
}

/* ── 날짜 스트립 ── */
function buildDays() {
  const map = dayMap();
  const keys = [...new Set([...map.keys(), todayKey()])].sort();
  let html = '', prevMonth = null;
  keys.forEach((k) => {
    const [y, m, d] = k.split('-').map(Number);
    if (prevMonth !== null && m !== prevMonth) html += `<span class="mchip">${m}월</span>`;
    prevMonth = m;
    const w = new Date(y, m - 1, d).getDay();
    const n = (map.get(k) || []).length;
    const tdy = k === todayKey();
    html += `<div class="day${k === state.dateKey ? ' on' : ''}${n ? '' : ' zero'}" data-k="${k}">
      <span class="w${w === 0 ? ' sun' : tdy ? ' tdy' : ''}">${tdy ? '오늘' : WD[w]}</span><b>${d}</b><span class="c">${n}</span></div>`;
  });
  daysEl.innerHTML = html;
  daysEl.querySelectorAll('.day').forEach((el) => el.addEventListener('click', () => {
    if (el.dataset.k === state.dateKey) return;
    tickFx();
    state.dateKey = el.dataset.k;
    state.popDate = el.dataset.k; // 직접 탭했을 때만 bpop 애니메이션
    buildFeed();
  }));
  if (state.popDate === state.dateKey) {
    const on = daysEl.querySelector('.day.on');
    if (on) on.classList.add('pop');
    state.popDate = null;
  }
  const on = daysEl.querySelector('.day.on');
  if (on) daysEl.scrollTo({ left: on.offsetLeft - (daysEl.clientWidth - on.offsetWidth) / 2, behavior: 'smooth' });
  const mon = $('#monLabel');
  if (mon && state.dateKey) mon.textContent = `${state.dateKey.slice(0, 4)}년 ${Number(state.dateKey.slice(5, 7))}월`;
}

/* ── 예매처 탭 ── */
function buildTabs() {
  vtabsEl.innerHTML = `<span class="vt${state.vendor ? '' : ' on'}" data-v="">전체</span>` +
    VORDER.map((v) => `<span class="vt${state.vendor === v ? ' on' : ''}" data-v="${v}">${VTAB[v]}</span>`).join('');
  vtabsEl.querySelectorAll('.vt').forEach((el) => el.addEventListener('click', () => {
    const v = el.dataset.v || null;
    if (v === state.vendor) return;
    state.vendor = v;
    try { v ? localStorage.setItem(VENDOR_KEY, v) : localStorage.removeItem(VENDOR_KEY); } catch { /* 무시 */ }
    tickFx();
    ensureDate();
    buildFeed();
  }));
}

/* ── 홈 피드 ── */
let secEls = [], focusIdx = -1, curGroups = [];

function card(it) {
  const href = it.url ? ` href="${esc(it.url)}" target="_blank" rel="noopener"` : '';
  return `<a class="rc"${href}><span class="pw"><img src="${esc(it.image || '')}" loading="lazy" onerror="this.remove()"></span>
    <div class="t">${esc(it.title)}</div><div class="v">${VN[it.siteId] || it.site} · ${(it.viewCount || 0).toLocaleString()}</div></a>`;
}
function statTxt(dk, t) {
  if (t === UNSET) return '';
  const s = secTo(dk, t);
  if (s > 0 && s <= 180 * 60) return `<span class="soon"><i></i><span class="cd" data-dk="${dk}" data-t="${t}">${cdText(dk, t)}</span>&nbsp;후 오픈</span>`;
  if (s <= 0) return '<span class="ended">종료</span>';
  return '';
}
function dayInfoHTML(h) {
  const items = dayMap().get(state.dateKey) || [];
  const per = { interpark: 0, melon: 0, ticketlink: 0 };
  items.forEach((i) => { per[i.siteId] = (per[i.siteId] || 0) + 1; });
  const dl = state.dateKey === todayKey() ? '오늘' : fmtDate(state.dateKey);
  const next = curGroups.find((g) => g.t !== UNSET && secTo(state.dateKey, g.t) > 0);
  const vsum = state.vendor
    ? `${VN[state.vendor]} ${items.length}건`
    : VORDER.filter((v) => per[v]).map((v) => `${VTAB[v]} ${per[v]}`).join(' · ');
  const tms = curGroups.map((g, i) => {
    const cls = isPastG(state.dateKey, g.t) ? ' done' : next && g.t === next.t ? ' soon' : '';
    const label = g.t === UNSET ? UNSET : `${parseInt(g.t, 10)}시`;
    return `<span class="ti${cls}" data-i="${i}">${label}<em>${g.items.length}</em></span>`;
  }).join('');
  return `<div class="spc dinfo" style="height:${h}px">
    <div class="sl">${dl} 오픈 ${items.length}건</div>
    ${next ? `<div class="nx"><i></i>다음 오픈 ${next.t} · <span class="cd" data-dk="${state.dateKey}" data-t="${next.t}">${cdText(state.dateKey, next.t)}</span>&nbsp;남음</div>` : ''}
    <div class="vsum">${vsum}</div><div class="tms">${tms}</div></div>`;
}
function buildFeed() {
  buildDays();
  buildTabs();
  curGroups = groupsOf(state.dateKey);
  secEls = []; focusIdx = -1;
  if (!curGroups.length) {
    feed.innerHTML = `<div class="fempty">${state.dateKey === todayKey() ? '오늘은' : '이 날은'} ${state.vendor ? VN[state.vendor] + ' ' : ''}오픈 일정이 없어요</div>`;
    return;
  }
  const dk = state.dateKey;
  feed.innerHTML = curGroups.map((g, i) => `<div class="sec${isPastG(dk, g.t) ? ' past' : ''}" data-i="${i}" style="animation-delay:${Math.min(i * 50, 300)}ms"><div class="sin">
    <div class="amb"><img src="${esc(g.items[0].image || '')}" loading="lazy" onerror="this.remove()"></div>
    <div class="shd"><span class="tm">${g.t}</span><span class="cnt">${g.items.length}건</span>${statTxt(dk, g.t)}
      <span class="more" data-i="${i}">전체보기 <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span></div>
    <div class="rail">${g.items.map(card).join('')}${g.items.length > 3 ? `<div class="rc morec" data-i="${i}"><span class="mbox"><span><b>+${g.items.length - 3}</b><em>더보기</em></span></span></div>` : ''}</div>
  </div></div>`).join('');
  secEls = [...feed.querySelectorAll('.sec')];
  feed.querySelectorAll('.more,.rc.morec').forEach((e) => e.addEventListener('click', (ev) => { ev.stopPropagation(); openOv(+e.dataset.i); }));
  secEls.forEach((s) => s.querySelector('.shd').addEventListener('click', (ev) => {
    if (ev.target.closest('.more')) return;
    centerOn(+s.dataset.i);
  }));
  requestAnimationFrame(() => {
    const h = secEls[0] ? Math.max(90, (feed.clientHeight - secEls[0].offsetHeight) / 2) : 0;
    feed.insertAdjacentHTML('afterbegin', dayInfoHTML(h));
    feed.insertAdjacentHTML('beforeend', `<div class="spc" style="height:${Math.max(0, h - 20)}px"></div>`);
    feed.querySelectorAll('.ti').forEach((t) => t.addEventListener('click', () => centerOn(+t.dataset.i)));
    focusIdx = -1;
    let def = curGroups.findIndex((g) => !isPastG(dk, g.t));
    if (def < 0) def = curGroups.length - 1;
    centerOn(def, false);
    fx();
  });
}
/* ── 쫀득한 스프링 스냅 (네이티브 snap 대체) ── */
let snapRaf = 0, idleTimer = 0, touching = false, animatingScroll = false;
const maxScroll = () => feed.scrollHeight - feed.clientHeight;
function targetTopOf(i) {
  const s = secEls[i];
  return Math.max(0, Math.min(maxScroll(), s.offsetTop - (feed.clientHeight - s.offsetHeight) / 2));
}
function cancelSnap() {
  cancelAnimationFrame(snapRaf);
  clearTimeout(idleTimer);
  animatingScroll = false;
}
function animateScroll(to, dur = 460) {
  cancelSnap();
  const from = feed.scrollTop;
  if (Math.abs(to - from) < 2) { feed.scrollTop = to; return; }
  animatingScroll = true;
  const t0 = performance.now();
  const s = 1.25; // 오버슈트 강도
  const easeOutBack = (x) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
  (function step(now) {
    const k = Math.min(1, (now - t0) / dur);
    feed.scrollTop = from + (to - from) * easeOutBack(k);
    fx();
    if (k < 1) snapRaf = requestAnimationFrame(step);
    else animatingScroll = false;
  })(t0);
}
function snapToNearest() {
  if (!secEls.length || animatingScroll || touching) return;
  const c = feed.scrollTop + feed.clientHeight / 2;
  let best = 0, bd = Infinity;
  secEls.forEach((el, i) => {
    const d = Math.abs(el.offsetTop + el.offsetHeight / 2 - c);
    if (d < bd) { bd = d; best = i; }
  });
  animateScroll(targetTopOf(best));
}
feed.addEventListener('touchstart', () => { touching = true; cancelSnap(); }, { passive: true });
feed.addEventListener('touchend', () => {
  touching = false;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(snapToNearest, 90);
}, { passive: true });

function centerOn(i, smooth = true) {
  const s = secEls[i];
  if (!s) return;
  if (smooth) animateScroll(targetTopOf(i));
  else { cancelSnap(); feed.scrollTop = targetTopOf(i); }
}
function fx() {
  if (!secEls.length) return;
  const c = feed.scrollTop + feed.clientHeight / 2;
  let best = 0, bd = Infinity;
  secEls.forEach((s, i) => {
    const sc = s.offsetTop + s.offsetHeight / 2;
    const dd = (sc - c) / Math.max(1, s.offsetHeight), ad = Math.abs(dd);
    const sin = s.firstElementChild;
    sin.style.transform = `scale(${(1 - Math.min(0.04, ad * 0.03)).toFixed(3)})`;
    sin.style.opacity = Math.max(0.4, 1 - ad * 0.4).toFixed(3);
    if (ad < bd) { bd = ad; best = i; }
  });
  secEls.forEach((s, i) => s.classList.toggle('on', i === best));
  if (best !== focusIdx) {
    const first = focusIdx < 0;
    focusIdx = best;
    if (!first) tickFx();
  }
}
feed.addEventListener('scroll', () => {
  requestAnimationFrame(fx);
  if (animatingScroll) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!touching) snapToNearest(); }, 90);
}, { passive: true });

/* ── 펼쳐보기 (해당 시간대만) ── */
function openOv(i) {
  const g = curGroups[i];
  if (!g) return;
  const dk = state.dateKey;
  const past = isPastG(dk, g.t);
  const dl = dk === todayKey() ? '오늘' : fmtDate(dk);
  $('#ovHd').innerHTML = `<span class="ot${past ? ' done' : ''}">${g.t}</span><span class="od">${dl} · ${g.items.length}건${state.vendor ? ` · ${VN[state.vendor]}` : ''}</span>${statTxt(dk, g.t)}`;
  $('#ovGrid').innerHTML = g.items.map((it, j) => {
    const href = it.url ? ` href="${esc(it.url)}" target="_blank" rel="noopener"` : '';
    return `<a class="gc${past ? ' dim' : ''}"${href} style="animation-delay:${Math.min(j * 35, 280)}ms"><span class="pw"><img src="${esc(it.image || '')}" loading="lazy" onerror="this.remove()"></span>
      <div class="t">${esc(it.title)}</div><div class="v">${VN[it.siteId] || it.site} · ${(it.viewCount || 0).toLocaleString()}</div></a>`;
  }).join('');
  ov.querySelector('.obody').scrollTop = 0;
  ov.classList.add('open');
}
$('#ovX').addEventListener('click', () => ov.classList.remove('open'));

/* ── 1초 틱: 카운트다운/오픈 전환 ── */
setInterval(() => {
  let crossed = false;
  document.querySelectorAll('.cd').forEach((e) => {
    const txt = cdText(e.dataset.dk, e.dataset.t);
    if (txt === '오픈') crossed = true;
    e.textContent = txt;
  });
  if (crossed && state.view === 'home') buildFeed();
}, 1000);

/* ── 캘린더 뷰 ── */
function buildCal() {
  const base = state.calMonth;
  const y = base.getFullYear(), m = base.getMonth();
  $('#calLabel').textContent = `${y}년 ${m + 1}월`;
  const map = dayMap();
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < first; i++) cells.push('<div class="ccell out"></div>');
  for (let d = 1; d <= days; d++) {
    const k = `${y}-${pad(m + 1)}-${pad(d)}`;
    const its = map.get(k) || [];
    const top = [...its].sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))[0];
    const cls = ['ccell', its.length ? 'has' : '', k === todayKey() ? 'today' : '', its.length && k < todayKey() ? 'pastd' : ''].filter(Boolean).join(' ');
    cells.push(`<div class="${cls}" data-k="${k}">${top ? `<img src="${esc(top.image || '')}" loading="lazy" onerror="this.remove()">` : ''}<span class="dn">${d}</span>${its.length ? `<span class="ct">${its.length}</span>` : ''}</div>`);
  }
  $('#calGrid').innerHTML = cells.join('');
  $('#calGrid').querySelectorAll('.ccell.has').forEach((el) => el.addEventListener('click', () => {
    tickFx();
    state.dateKey = el.dataset.k;
    setView('home');
    buildFeed();
  }));
}
$('#calPrev').addEventListener('click', () => { state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() - 1, 1); buildCal(); });
$('#calNext').addEventListener('click', () => { state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + 1, 1); buildCal(); });
$('#calToday').addEventListener('click', () => { state.calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); buildCal(); });

/* ── 마이: 새로고침(SSE) / 상태 ── */
let loading = false;
function setSt(site, msg, busy) {
  const el = $(`#st-${site}`);
  if (el) { el.textContent = msg; el.classList.toggle('busy', !!busy); }
}
function refreshMy() {
  $('#genAt').textContent = state.generatedAt ? new Date(state.generatedAt).toLocaleString('ko-KR') : '-';
  $('#totCnt').textContent = `${state.items.length}건`;
}
function itemKey(it) { return `${it.siteId}|${it.title}|${it.openDateTime || it.openDate || ''}`; }
function mergeItems(items) {
  const by = new Map(state.items.map((i) => [itemKey(i), i]));
  items.forEach((i) => {
    const prev = by.get(itemKey(i));
    if (prev && prev.detail && !i.detail) i.detail = prev.detail;
    by.set(itemKey(i), i);
  });
  state.items = [...by.values()];
}
function saveItems() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items)); } catch { /* 무시 */ }
}
function rerenderAll() {
  ensureDate();
  if (state.view === 'home') buildFeed();
  if (state.view === 'cal') buildCal();
  refreshMy();
}
/* 정적 배포(GitHub Pages)에는 수집 서버가 없다 — 버튼 대신 자동 갱신 안내 */
const IS_STATIC = location.hostname.endsWith('github.io');
if (IS_STATIC) {
  $('#rowReload').innerHTML = '<span class="rlab">자동 수집</span><span class="rval">3시간마다 자동 갱신</span>';
  $('#secStatus').hidden = true;
}
if (!IS_STATIC) $('#reloadBtn').addEventListener('click', () => {
  if (loading) return;
  loading = true;
  const btn = $('#reloadBtn');
  btn.disabled = true; btn.textContent = '수집 중…';
  VORDER.forEach((v) => setSt(v, '대기 중', true));
  const done = () => { loading = false; btn.disabled = false; btn.textContent = '새로고침'; };
  const source = new EventSource('/api/load');
  source.addEventListener('status', (e) => { const p = JSON.parse(e.data); setSt(p.site, p.message, true); });
  source.addEventListener('siteDone', (e) => { const p = JSON.parse(e.data); setSt(p.site, `${p.count}건`, false); });
  source.addEventListener('siteError', (e) => { const p = JSON.parse(e.data); setSt(p.site, `오류: ${p.message}`, false); });
  source.addEventListener('items', (e) => { const p = JSON.parse(e.data); mergeItems(p.items); saveItems(); rerenderAll(); });
  source.addEventListener('done', (e) => {
    const p = JSON.parse(e.data);
    mergeItems(p.items); saveItems();
    state.generatedAt = new Date().toISOString();
    source.close(); done(); rerenderAll();
  });
  source.addEventListener('fatal', () => { source.close(); done(); });
  source.onerror = () => { source.close(); done(); };
});
$('#clearBtn').addEventListener('click', async () => {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* 무시 */ }
  state.items = [];
  await loadStatic();
  rerenderAll();
});

/* ── 검색 ── */
const sov = $('#sov'), sInput = $('#sInput'), sRes = $('#sRes');
$('#searchBtn').addEventListener('click', () => {
  sov.classList.add('open');
  sInput.value = '';
  sRes.innerHTML = '';
  // 팝업이 아직 화면 밖일 때 focus()가 .wrap을 강제 스크롤시키는 것 방지
  sInput.focus({ preventScroll: true });
  requestAnimationFrame(() => { document.querySelector('.wrap').scrollTop = 0; });
});
$('#sovX').addEventListener('click', () => sov.classList.remove('open'));
sov.addEventListener('click', (e) => { if (e.target === sov) sov.classList.remove('open'); });
sInput.addEventListener('input', () => {
  const q = sInput.value.trim().toLowerCase();
  if (!q) { sRes.innerHTML = ''; return; }
  const hits = state.items
    .filter((i) => i.title.toLowerCase().includes(q))
    .sort((a, b) => (a.openDateTime || '').localeCompare(b.openDateTime || ''))
    .slice(0, 40);
  sRes.innerHTML = hits.length ? hits.map((it, idx) => {
    const dk = dkeyOf(it);
    const [, m, d] = dk.split('-').map(Number);
    return `<div class="srow" data-i="${idx}"><span class="sp"><img src="${esc(it.image || '')}" loading="lazy" onerror="this.remove()"></span>
      <div class="smid"><div class="st1">${esc(it.title)}</div>
      <div class="st2">${m}.${d} · ${it.openTime || UNSET} · ${VN[it.siteId] || it.site}</div></div></div>`;
  }).join('') : '<div class="snone">검색 결과가 없어요</div>';
  sRes.querySelectorAll('.srow').forEach((row) => row.addEventListener('click', () => {
    const it = hits[+row.dataset.i];
    sov.classList.remove('open');
    state.dateKey = dkeyOf(it);
    state.vendor = null;
    setView('home');
    buildFeed();
    requestAnimationFrame(() => {
      const gi = curGroups.findIndex((g) => g.t === (it.openTime || UNSET));
      if (gi >= 0) setTimeout(() => centerOn(gi), 60);
    });
  }));
});

/* ── 뷰 전환 (플로팅 독) ── */
function setView(v) {
  state.view = v;
  ['home', 'cal', 'alarm', 'my'].forEach((k) => {
    $(`#view-${k}`).hidden = k !== v;
    $(`#tab-${k}`).classList.toggle('on', k === v);
  });
  const homeCtl = v === 'home';
  daysEl.hidden = !homeCtl;
  vtabsEl.hidden = !homeCtl;
  if (v === 'cal') buildCal();
  if (v === 'my') refreshMy();
}
['home', 'cal', 'alarm', 'my'].forEach((k) => $(`#tab-${k}`).addEventListener('click', () => {
  if (state.view !== k) tickFx();
  setView(k);
}));

/* ── 초기화 ── */
function ensureDate() {
  const map = dayMap();
  const keys = [...new Set([...map.keys(), todayKey()])].sort();
  if (!state.dateKey || !keys.includes(state.dateKey)) state.dateKey = null;
  if (!state.dateKey) {
    const tk = todayKey();
    state.dateKey = keys.includes(tk) ? tk : (keys.find((k) => k >= tk) || keys[keys.length - 1]);
  }
}
async function loadStatic() {
  try {
    const res = await fetch('data.json', { cache: 'no-store' });
    if (!res.ok) return;
    const payload = await res.json();
    const items = Array.isArray(payload) ? payload : payload.items;
    if (Array.isArray(items) && items.length) {
      mergeItems(items);
      if (payload.generatedAt) state.generatedAt = payload.generatedAt;
    }
  } catch { /* 정적 데이터 없어도 동작 */ }
}
(async function init() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(saved)) mergeItems(saved);
  } catch { /* 무시 */ }
  await loadStatic();
  state.calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  ensureDate();
  setView('home');
  buildFeed();
  refreshMy();
})();
