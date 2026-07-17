/* 티켓오픈 홈 — 시간대 포커스 스크롤 (다크+그린) */
const STORAGE_KEY = 'ticket-open-checker:schedules';
const VENDOR_KEY = 'toc:homeVendor';
const ALARM_KEY = 'toc:alarms';
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
  calSel: null,           // 캘린더에서 선택한 날짜
  generatedAt: null,
  popDate: null,          // 직접 탭한 날짜(bpop용)
  alarms: readAlarms(),   // { itemKey: {f5,f0} }
};

function readVendor() {
  try {
    const v = localStorage.getItem(VENDOR_KEY);
    return ['interpark', 'melon', 'ticketlink'].includes(v) ? v : null;
  } catch { return null; }
}
function readAlarms() {
  try {
    const a = JSON.parse(localStorage.getItem(ALARM_KEY) || '{}');
    return a && typeof a === 'object' ? a : {};
  } catch { return {}; }
}
function saveAlarms() {
  try { localStorage.setItem(ALARM_KEY, JSON.stringify(state.alarms)); } catch { /* 무시 */ }
}

const $ = (s) => document.querySelector(s);

/* 모바일 주소창/제스처 바 때문에 dvh가 어긋나는 기기 대응: 실제 보이는 높이를 실측 */
function setVH() {
  const h = (window.visualViewport ? window.visualViewport.height : window.innerHeight);
  document.documentElement.style.setProperty('--vh', `${Math.round(h)}px`);
}
setVH();
(window.visualViewport || window).addEventListener('resize', () => {
  setVH();
  requestAnimationFrame(() => { if (typeof measureSecs === 'function' && secEls.length) measureSecs(); });
});
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
const itemKey = (it) => `${it.siteId}|${it.title}|${it.openDateTime || it.openDate || ''}`;

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
function dayMap(all) {
  const m = new Map();
  (all ? state.items : vendorItems()).forEach((i) => {
    const k = dkeyOf(i);
    if (!k) return;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(i);
  });
  return m;
}
function groupsOf(dk, all) {
  const items = dayMap(all).get(dk) || [];
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

/* ── 알람 ── */
const BELL_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
const BELL_SVG_LG = BELL_SVG.replace('width="13" height="13"', 'width="17" height="17"');
const hasAlarm = (k) => Object.prototype.hasOwnProperty.call(state.alarms, k);
function bellBtn(it) {
  const k = itemKey(it);
  return `<button class="bell${hasAlarm(k) ? ' on' : ''}" data-ak="${esc(k)}" aria-label="오픈 알림">${BELL_SVG}</button>`;
}
function toggleAlarm(k) {
  if (hasAlarm(k)) delete state.alarms[k];
  else {
    state.alarms[k] = {};
    try {
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    } catch { /* 무시 */ }
  }
  saveAlarms();
  tickFx();
  document.querySelectorAll(`[data-ak="${CSS.escape(k)}"]`).forEach((b) => b.classList.toggle('on', hasAlarm(k)));
  updateAlarmBadge();
  if (state.view === 'alarm') buildAlarm();
}
function bindBells(root) {
  root.querySelectorAll('[data-ak]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleAlarm(b.dataset.ak);
  }));
}
function alarmedItems() {
  const by = new Map(state.items.map((i) => [itemKey(i), i]));
  // 지난 지 1시간 넘은 알람은 자동 정리
  let dirty = false;
  Object.keys(state.alarms).forEach((k) => {
    const it = by.get(k);
    if (!it) return; // 데이터 갱신 대기 중일 수 있어 유지
    const dk = dkeyOf(it), t = it.openTime;
    if (t && openMs(dk, t) < Date.now() - 3600 * 1000) { delete state.alarms[k]; dirty = true; }
  });
  if (dirty) saveAlarms();
  return Object.keys(state.alarms).map((k) => by.get(k)).filter(Boolean)
    .sort((a, b) => (a.openDateTime || '').localeCompare(b.openDateTime || ''));
}
function updateAlarmBadge() {
  const n = Object.keys(state.alarms).length;
  let b = $('#tab-alarm .badge');
  if (!n) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('span'); b.className = 'badge'; $('#tab-alarm').appendChild(b); }
  b.textContent = n;
}
function notifyFx(title, body) {
  try { if (navigator.vibrate) navigator.vibrate([80, 60, 80]); } catch { /* 무시 */ }
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: 'icon-192.png' });
    }
  } catch { /* 무시 */ }
}
function checkAlarms() {
  const by = new Map(state.items.map((i) => [itemKey(i), i]));
  Object.entries(state.alarms).forEach(([k, st]) => {
    const it = by.get(k);
    if (!it || !it.openTime) return;
    const s = secTo(dkeyOf(it), it.openTime);
    if (s <= 300 && s > 0 && !st.f5) {
      st.f5 = 1; saveAlarms();
      notifyFx('곧 티켓 오픈!', `${it.title} — ${it.openTime} 오픈 (5분 전)`);
    }
    if (s <= 0 && s > -120 && !st.f0) {
      st.f0 = 1; saveAlarms();
      notifyFx('티켓 오픈!', `${it.title} — 지금 오픈했어요`);
    }
  });
}
function buildAlarm() {
  const body = $('#alarmBody');
  const list = alarmedItems();
  if (!list.length) {
    body.innerHTML = `<div class="empty">
      ${BELL_SVG.replace('width="13" height="13"', 'width="34" height="34"').replace('stroke-width="2.2"', 'stroke-width="1.7"')}
      <b>오픈 알림</b>
      <p>공연 포스터의 종 아이콘을 누르면<br>오픈 5분 전과 정각에 알려드려요.</p></div>`;
    return;
  }
  let html = '', prevDk = null;
  list.forEach((it) => {
    const dk = dkeyOf(it), t = it.openTime || UNSET;
    if (dk !== prevDk) {
      html += `<div class="cgh"><b>${fmtDate(dk)}</b></div>`;
      prevDk = dk;
    }
    const past = t !== UNSET && isPastG(dk, t);
    const cd = t === UNSET ? `<span class="acd faroff">${UNSET}</span>`
      : past ? '<span class="acd faroff">오픈됨</span>'
        : `<span class="acd cd" data-dk="${dk}" data-t="${t}">${cdText(dk, t)}</span>`;
    html += `<a class="crow v-${it.siteId}${past ? ' dim' : ''}" ${it.url ? `href="${esc(it.url)}" target="_blank" rel="noopener"` : ''}>
      <span class="cp"><img src="${esc(it.image || '')}" loading="lazy" onerror="this.remove()"></span>
      <div class="cmid"><div class="ct1">${esc(it.title)}</div>
      <div class="ct2"><span>${t}</span><span class="vn"><i></i>${VN[it.siteId] || it.site}</span></div></div>
      ${cd}
      <button class="bellr on" data-ak="${esc(itemKey(it))}" aria-label="알림 해제">${BELL_SVG_LG}</button></a>`;
  });
  html += '<div class="ahint">알림은 앱이 열려 있는 동안 동작해요. 오픈 5분 전과 정각에 알림·진동으로 알려드립니다.</div>';
  body.innerHTML = html;
  bindBells(body);
}

/* ── 날짜 스트립 ── */
function buildDays() {
  const vMap = dayMap();        // 현재 예매처 건수(0이면 흐리게 표시)
  const map = dayMap(true);     // 날짜 컬럼은 예매처와 무관하게 전체 고정 — 탭 전환에도 안 흔들림
  const keys = [...new Set([...map.keys(), todayKey()])].sort();
  let html = '', prevMonth = null;
  keys.forEach((k) => {
    const [y, m, d] = k.split('-').map(Number);
    if (prevMonth !== null && m !== prevMonth) html += `<span class="mchip">${m}월</span>`;
    prevMonth = m;
    const w = new Date(y, m - 1, d).getDay();
    const n = (vMap.get(k) || []).length;
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
  return `<a class="rc"${href}><span class="pw"><img src="${esc(it.image || '')}" loading="lazy" onerror="this.remove()">${bellBtn(it)}</span>
    <div class="t">${esc(it.title)}</div><div class="v">${VN[it.siteId] || it.site} · ${(it.viewCount || 0).toLocaleString()}</div></a>`;
}
function statTxt(dk, t) {
  if (t === UNSET) return '';
  const s = secTo(dk, t);
  if (s > 0 && s <= 180 * 60) return `<span class="soon"><i></i><span class="cd" data-dk="${dk}" data-t="${t}">${cdText(dk, t)}</span>&nbsp;후 오픈</span>`;
  if (s <= 0) return '<span class="ended">종료</span>';
  return '';
}
function dayInfoHTML() {
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
  return `<div class="dinfo">
    <div class="sl">${dl} 오픈 ${items.length}건</div>
    ${next ? `<div class="nx"><i></i>다음 오픈 ${next.t} · <span class="cd" data-dk="${state.dateKey}" data-t="${next.t}">${cdText(state.dateKey, next.t)}</span>&nbsp;남음</div>` : ''}
    <div class="vsum">${vsum}</div><div class="tms">${tms}</div></div>`;
}
function buildFeed() {
  buildDays();
  buildTabs();
  curGroups = groupsOf(state.dateKey);
  secEls = []; focusIdx = -1;
  cancelSnap();
  if (!curGroups.length) {
    feed.innerHTML = `<div class="fempty">${state.dateKey === todayKey() ? '오늘은' : '이 날은'} ${state.vendor ? VN[state.vendor] + ' ' : ''}오픈 일정이 없어요</div>`;
    return;
  }
  const dk = state.dateKey;
  feed.innerHTML = dayInfoHTML() + curGroups.map((g, i) => `<div class="sec${isPastG(dk, g.t) ? ' past' : ''}" data-i="${i}" style="animation-delay:${Math.min(i * 50, 300)}ms"><div class="sin">
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
  bindBells(feed);
  feed.querySelectorAll('.ti').forEach((t) => t.addEventListener('click', () => centerOn(+t.dataset.i)));
  requestAnimationFrame(() => {
    measureSecs();
    // 마지막 섹션도 기준선까지 올라올 만큼의 여백(끝에서 20px는 일부러 덜 — 기존 감각 유지)
    const last = secEls[secEls.length - 1], lm = secMeta[secMeta.length - 1];
    const hB = lm ? Math.max(0, feedH - anchorY - (last.offsetTop + last.offsetHeight - lm.a) - 20) : 0;
    feed.insertAdjacentHTML('beforeend', `<div class="spc" style="height:${hB}px"></div>`);
    measureSecs(); // 스페이서 반영해 maxS 갱신
    focusIdx = -1;
    let def = curGroups.findIndex((g) => !isPastG(dk, g.t));
    if (def < 0) def = curGroups.length - 1;
    centerOn(def, false);
    fx();
  });
}

/* ── 쫀득한 스프링 스냅 ── */
let snapRaf = 0, idleTimer = 0, touching = false, animatingScroll = false;
/* 스크롤 중 레이아웃 재측정(스래싱) 방지: 섹션 위치는 빌드 때 한 번만 측정해 캐시 */
let secMeta = [], feedH = 0, maxS = 0, anchorY = 0;
/* 포커스 기준선 = '화면 전체'의 세로 중앙(피드 좌표계).
   피드는 헤더/날짜/탭 아래에서 시작하므로 피드 중앙보다 그만큼 위다 */
function measureSecs() {
  feedH = feed.clientHeight;
  if (!feedH) return; // 홈이 숨겨진(display:none) 동안엔 피드가 전부 0으로 측정된다 — 캐시 오염 방지
  const wr = $('.wrap').getBoundingClientRect();
  anchorY = wr.top + wr.height / 2 - feed.getBoundingClientRect().top;
  secMeta = secEls.map((el) => ({ top: el.offsetTop, h: el.offsetHeight, a: posterY(el) }));
  maxS = feed.scrollHeight - feedH;
}
/* 포스터 중앙의 피드 콘텐츠 좌표. fx()가 걸어둔 scale에 오염되지 않게 rect 대신 offsetTop 누적 */
function posterY(el) {
  const pw = el.querySelector('.pw');
  if (!pw) return el.offsetTop + el.offsetHeight / 2;
  let y = pw.offsetHeight / 2;
  for (let n = pw; n && n !== feed; n = n.offsetParent) y += n.offsetTop;
  return y;
}
const maxScroll = () => maxS;
function targetTopOf(i) {
  const m = secMeta[i];
  if (!m) return 0;
  return Math.max(0, Math.min(maxS, m.a - anchorY));
}
function cancelSnap() {
  cancelAnimationFrame(snapRaf);
  clearTimeout(idleTimer);
  animatingScroll = false;
}
function animateScroll(to, dur = 460) {
  cancelSnap();
  const from = feed.scrollTop;
  // 미세 오차는 그대로 둔다 — 여기서 쓰기를 하면 scrollend가 재발화하며 루프를 만든다
  if (Math.abs(to - from) < 2) return;
  animatingScroll = true;
  const t0 = performance.now();
  // 경계(맨 위/맨 아래)에서는 오버슈트하면 클램프에 걸려 덜컹거린다 → 순수 감속만
  const atEdge = to <= 1 || to >= maxScroll() - 1;
  const s = 1.25;
  const easeBack = (x) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
  const easeCubic = (x) => 1 - Math.pow(1 - x, 3);
  const ease = atEdge ? easeCubic : easeBack;
  (function step(now) {
    const k = Math.min(1, (now - t0) / dur);
    feed.scrollTop = from + (to - from) * ease(k);
    fx();
    if (k < 1) snapRaf = requestAnimationFrame(step);
    else animatingScroll = false;
  })(t0);
}
function snapToNearest() {
  if (!secMeta.length || animatingScroll || touching) return;
  const st = feed.scrollTop;
  // 맨 위/맨 아래 근처에서는 그대로 둔다 (요약을 읽거나 끝을 보는 중)
  if (st <= 2 || st >= maxS - 2) return;
  const c = st + anchorY;
  let best = 0, bd = Infinity;
  secMeta.forEach((m, i) => {
    const d = Math.abs(m.a - c);
    if (d < bd) { bd = d; best = i; }
  });
  const target = targetTopOf(best);
  if (Math.abs(target - st) < 6) return; // 거의 맞아있으면 건드리지 않는다
  animateScroll(target);
}
/* 스냅 시점: 관성 스크롤까지 완전히 끝난 시점(scrollend)에만 — 도중에 끼어들면 튄다 */
const HAS_SCROLLEND = 'onscrollend' in window;
feed.addEventListener('touchstart', () => { touching = true; cancelSnap(); }, { passive: true });
feed.addEventListener('touchend', () => {
  touching = false;
  if (!HAS_SCROLLEND) { clearTimeout(idleTimer); idleTimer = setTimeout(snapToNearest, 160); }
}, { passive: true });
feed.addEventListener('wheel', () => cancelSnap(), { passive: true });
feed.addEventListener('scroll', () => {
  requestAnimationFrame(fx);
  if (HAS_SCROLLEND || animatingScroll) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!touching) snapToNearest(); }, 160);
}, { passive: true });
if (HAS_SCROLLEND) feed.addEventListener('scrollend', () => {
  if (!touching && !animatingScroll) snapToNearest();
});

function centerOn(i, smooth = true) {
  const s = secEls[i];
  if (!s) return;
  if (smooth) animateScroll(targetTopOf(i));
  else { cancelSnap(); feed.scrollTop = targetTopOf(i); }
}
function fx() {
  if (!secMeta.length) return;
  const c = feed.scrollTop + anchorY;
  let best = 0, bd = Infinity;
  secMeta.forEach((m, i) => {
    const dd = (m.a - c) / Math.max(1, m.h), ad = Math.abs(dd);
    const sin = secEls[i].firstElementChild;
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
    return `<a class="gc${past ? ' dim' : ''}"${href} style="animation-delay:${Math.min(j * 35, 280)}ms"><span class="pw"><img src="${esc(it.image || '')}" loading="lazy" onerror="this.remove()">${bellBtn(it)}</span>
      <div class="t">${esc(it.title)}</div><div class="v">${VN[it.siteId] || it.site} · ${(it.viewCount || 0).toLocaleString()}</div></a>`;
  }).join('');
  bindBells($('#ovGrid'));
  ov.querySelector('.obody').scrollTop = 0;
  ov.classList.add('open');
}
$('#ovX').addEventListener('click', () => ov.classList.remove('open'));

/* ── 1초 틱: 카운트다운/오픈 전환/알람 ── */
setInterval(() => {
  let crossed = false;
  document.querySelectorAll('.cd').forEach((e) => {
    const txt = cdText(e.dataset.dk, e.dataset.t);
    if (txt === '오픈' && e.textContent !== '오픈') crossed = true;
    e.textContent = txt;
  });
  checkAlarms();
  if (crossed) {
    // 전체 리빌드는 스크롤 위치를 튀게 하므로 지난 상태만 제자리 갱신
    if (state.view === 'home' && secEls.length) {
      const dk = state.dateKey;
      secEls.forEach((s, i) => {
        const g = curGroups[i];
        if (g && isPastG(dk, g.t) && !s.classList.contains('past')) {
          s.classList.add('past');
          const soon = s.querySelector('.soon');
          if (soon) soon.outerHTML = '<span class="ended">종료</span>';
        }
      });
    }
    if (state.view === 'alarm') buildAlarm();
  }
}, 1000);

/* ── 캘린더 뷰 ── */
function buildCal() {
  const base = state.calMonth;
  const y = base.getFullYear(), m = base.getMonth();
  $('#calLabel').textContent = `${y}년 ${m + 1}월`;
  const map = dayMap(true);
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  // 선택 기본값: 오늘(이 달이면) → 이 달의 첫 일정 날짜
  if (!state.calSel || !state.calSel.startsWith(`${y}-${pad(m + 1)}`)) {
    const tk = todayKey();
    if (tk.startsWith(`${y}-${pad(m + 1)}`) && map.has(tk)) state.calSel = tk;
    else {
      state.calSel = null;
      for (let d = 1; d <= days; d++) {
        const k = `${y}-${pad(m + 1)}-${pad(d)}`;
        if (map.has(k)) { state.calSel = k; break; }
      }
    }
  }
  const cells = [];
  for (let i = 0; i < first; i++) cells.push('<div class="ccell out"></div>');
  for (let d = 1; d <= days; d++) {
    const k = `${y}-${pad(m + 1)}-${pad(d)}`;
    const its = map.get(k) || [];
    const top = [...its].sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))[0];
    const cls = ['ccell', its.length ? 'has' : '', k === todayKey() ? 'today' : '',
      k === state.calSel ? 'sel' : '', its.length && k < todayKey() ? 'pastd' : ''].filter(Boolean).join(' ');
    cells.push(`<div class="${cls}" data-k="${k}">${top ? `<img src="${esc(top.image || '')}" loading="lazy" onerror="this.remove()">` : ''}<span class="dn">${d}</span>${its.length ? `<span class="ct">${its.length}</span>` : ''}</div>`);
  }
  $('#calGrid').innerHTML = cells.join('');
  $('#calGrid').querySelectorAll('.ccell.has').forEach((el) => el.addEventListener('click', () => {
    if (el.dataset.k === state.calSel) return;
    tickFx();
    state.calSel = el.dataset.k;
    $('#calGrid').querySelectorAll('.ccell.sel').forEach((c) => c.classList.remove('sel'));
    el.classList.add('sel');
    buildCalDetail();
  }));
  buildCalDetail();
}
function buildCalDetail() {
  const box = $('#calDetail');
  const dk = state.calSel;
  if (!dk) { box.innerHTML = '<div class="cempty">이 달에는 오픈 일정이 없어요</div>'; return; }
  const gs = groupsOf(dk, true);
  const total = gs.reduce((s, g) => s + g.items.length, 0);
  let html = `<div class="cdh"><b>${fmtDate(dk)}</b><span>${total}건</span><span class="gohome" id="calGoHome">홈에서 보기 ›</span></div>`;
  gs.forEach((g) => {
    const past = isPastG(dk, g.t);
    html += `<div class="cgh${past ? ' done' : ''}"><b>${g.t}</b><span>${g.items.length}건${past ? ' · 종료' : ''}</span></div>`;
    g.items.forEach((it) => {
      html += `<a class="crow v-${it.siteId}${past ? ' dim' : ''}" ${it.url ? `href="${esc(it.url)}" target="_blank" rel="noopener"` : ''}>
        <span class="cp"><img src="${esc(it.image || '')}" loading="lazy" onerror="this.remove()"></span>
        <div class="cmid"><div class="ct1">${esc(it.title)}</div>
        <div class="ct2"><span class="vn"><i></i>${VN[it.siteId] || it.site}</span><span>조회 ${(it.viewCount || 0).toLocaleString()}</span></div></div>
        <button class="bellr${hasAlarm(itemKey(it)) ? ' on' : ''}" data-ak="${esc(itemKey(it))}" aria-label="오픈 알림">${BELL_SVG_LG}</button></a>`;
    });
  });
  box.innerHTML = html;
  bindBells(box);
  const go = $('#calGoHome');
  if (go) go.addEventListener('click', () => {
    state.dateKey = dk;
    setView('home');
    buildFeed();
  });
}
$('#calPrev').addEventListener('click', () => { state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() - 1, 1); buildCal(); });
$('#calNext').addEventListener('click', () => { state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + 1, 1); buildCal(); });
$('#calToday').addEventListener('click', () => {
  state.calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  state.calSel = null;
  buildCal();
});

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
  if (state.view === 'alarm') buildAlarm();
  refreshMy();
  updateAlarmBadge();
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
  if (v === 'alarm') buildAlarm();
  if (v === 'my') refreshMy();
  if (v === 'home' && secEls.length) measureSecs(); // 숨어있는 동안 화면 크기가 바뀌었을 수 있다
}
/* 독 탭: 관성 스크롤을 멈추는 탭은 click이 삼켜진다 → pointerup으로 직접 처리 */
function bindTap(el, fn) {
  let sx = 0, sy = 0, armed = false;
  el.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; armed = true; });
  el.addEventListener('pointerup', (e) => {
    if (armed && Math.hypot(e.clientX - sx, e.clientY - sy) < 12) fn();
    armed = false;
  });
  el.addEventListener('click', (e) => e.preventDefault()); // 중복 발화 방지
}
['home', 'cal', 'alarm', 'my'].forEach((k) => bindTap($(`#tab-${k}`), () => {
  if (state.view !== k) tickFx();
  else if (k === 'home') centerOn(focusIdx >= 0 ? focusIdx : 0); // 홈 재탭 = 현재 위치 재정렬
  setView(k);
}));

/* ── 초기화 ── */
function ensureDate() {
  const map = dayMap(true); // 예매처와 무관하게 날짜 유효성 판단 — 탭 전환 시 선택 날짜 유지(없으면 빈 상태로)
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
  updateAlarmBadge();
})();
