const STORAGE_KEY = 'ticket-open-checker:schedules';
const VIEW_KEY = 'toc:view';
const GROUP_KEY = 'toc:groupBy';
// 인기공연 임계값: 최상단 render() 호출보다 먼저 초기화돼야 TDZ 오류가 없다.
const POPULAR_VIEW_THRESHOLD = 500;

function readStored(key, allowed, fallback) {
  try {
    const value = localStorage.getItem(key);
    return allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

const state = {
  date: new Date(),
  items: [],
  view: readStored(VIEW_KEY, ['calendar', 'site'], 'calendar'),
  groupBy: readStored(GROUP_KEY, ['date', 'site', 'views'], 'date'),
};

const calendar = document.getElementById('calendar');
const siteBoard = document.getElementById('siteBoard');
const weekdayGrid = document.getElementById('weekdayGrid');
const workspace = document.querySelector('.workspace');
const monthLabel = document.getElementById('monthLabel');
const summary = document.getElementById('summary');
const unknownList = document.getElementById('unknownList');
const unknownCount = document.getElementById('unknownCount');
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modalTitle');
const modalList = document.getElementById('modalList');
const loadButton = document.getElementById('load');
const searchInput = document.getElementById('searchInput');
const searchSuggestions = document.getElementById('searchSuggestions');
const calendarViewButton = document.getElementById('calendarView');
const siteViewButton = document.getElementById('siteView');
const groupSwitch = document.getElementById('groupSwitch');
let highlightedDate = null;
let highlightedSite = null;

const SITES = [
  { id: 'interpark', name: 'NOL 티켓', shortName: 'NOL' },
  { id: 'melon', name: '멜론 티켓', shortName: '멜론' },
  { id: 'ticketlink', name: '티켓링크', shortName: '티링' },
];

// blur(): 모바일에서 탭 후 focus 가 남아 버튼 색이 안 돌아오는 것 방지
document.getElementById('prevMonth').addEventListener('click', (e) => { e.currentTarget.blur(); slideMonth(-1); });
document.getElementById('nextMonth').addEventListener('click', (e) => { e.currentTarget.blur(); slideMonth(1); });
document.getElementById('today').addEventListener('click', () => {
  state.date = new Date();
  render();
  playViewAnim();
});
calendarViewButton.addEventListener('click', () => setView('calendar'));
siteViewButton.addEventListener('click', () => setView('site'));
document.getElementById('groupSite').addEventListener('click', () => setGroupBy('site'));
document.getElementById('groupDate').addEventListener('click', () => setGroupBy('date'));
document.getElementById('groupViews').addEventListener('click', () => setGroupBy('views'));
loadButton.addEventListener('click', loadSchedules);
document.getElementById('themeToggle').addEventListener('click', toggleTheme);
searchInput.addEventListener('input', renderSearchSuggestions);
searchInput.addEventListener('focus', renderSearchSuggestions);
document.querySelectorAll('.status-item').forEach((item) => {
  item.tabIndex = 0;
  item.role = 'button';
  item.setAttribute('aria-pressed', 'false');
  item.addEventListener('click', () => toggleSiteHighlight(item.dataset.site));
  item.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleSiteHighlight(item.dataset.site);
  });
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.search-box')) {
    searchSuggestions.hidden = true;
  }
});
modal.addEventListener('click', (event) => {
  if (event.target.closest('[data-close]') || !event.target.closest('.modal-card')) {
    closeModal();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeModal();
  }
});

// 예매처 아이템 클릭 시 사이트로 보내지 않고 인앱 미리보기 모달을 연다.
// (삼성인터넷 등 일부 환경에서 예매처 페이지가 제대로 렌더되지 않아서.)
document.addEventListener('click', (event) => {
  if (suppressNextClick) return;
  const link = event.target.closest('a.modal-item, a.unknown-card, a.site-board-card');
  if (!link) return;
  const item = state.items.find((it) => it.url === link.dataset.url);
  if (!item) return;
  event.preventDefault();
  openPreview(item);
});

// 스와이프(터치): 캘린더 위 = 달 넘기기, 그 외 영역 = 캘린더↔리스트 전환.
// 터치 이벤트 + 가로 제스처일 때 preventDefault 로 브라우저 스크롤이 제스처를 가로채지 않게 한다.
let suppressNextClick = false;
let touchStartX = 0;
let touchStartY = 0;
let touchActive = false;
let touchDecided = false;
let touchHoriz = false;
let touchEl = null;

document.addEventListener('touchstart', (event) => {
  if (event.touches.length !== 1) { touchActive = false; return; }
  const t = event.touches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;
  touchActive = true;
  touchDecided = false;
  touchHoriz = false;
  touchEl = event.target;
  // 캘린더 그리드 위 스와이프는 월 전환(슬라이드 애니메이션)이 따로 처리한다.
  if (touchEl && touchEl.closest('.cal-viewport')) touchActive = false;
}, { passive: true });

// 캘린더 그리드 밖(헤더·리스트 등) 가로 스와이프도 손가락을 따라 콘텐츠가 밀리고,
// 놓으면 월이 슬라이드로 전환된다. 캘린더↔리스트 전환은 상단 버튼으로만 한다.
let dragEl = null;

document.addEventListener('touchmove', (event) => {
  if (!touchActive || event.touches.length !== 1) return;
  const t = event.touches[0];
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;
  if (!touchDecided) {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    touchDecided = true;
    touchHoriz = Math.abs(dx) > Math.abs(dy);
    if (!touchHoriz) { touchActive = false; return; } // 세로 → 스크롤에 양보
    if (sliding || (touchEl && (touchEl.closest('.modal') || touchEl.closest('.search-box')))) {
      touchActive = false;
      return;
    }
    dragEl = state.view === 'calendar' ? calendar : siteBoard;
    dragEl.style.transition = 'none';
    suppressNextClick = true;
  }
  if (touchHoriz && event.cancelable) event.preventDefault();
  if (touchHoriz && dragEl) dragEl.style.transform = `translate3d(${dx}px, 0, 0)`;
}, { passive: false });

function springBackDrag() {
  const el = dragEl;
  dragEl = null;
  if (!el) return;
  el.style.transition = 'transform 0.2s ease';
  el.style.transform = 'translate3d(0, 0, 0)';
  setTimeout(() => {
    el.style.transition = '';
    el.style.transform = '';
    suppressNextClick = false;
  }, 220);
}

document.addEventListener('touchend', (event) => {
  if (!touchActive || !touchDecided || !touchHoriz) { touchActive = false; return; }
  touchActive = false;
  const dx = event.changedTouches[0].clientX - touchStartX;
  if (Math.abs(dx) < 45) { springBackDrag(); return; }
  suppressNextClick = true;
  setTimeout(() => { suppressNextClick = false; }, 500);
  dragEl = null;
  slideMonth(dx < 0 ? 1 : -1, dx);
}, { passive: true });

document.addEventListener('touchcancel', () => {
  touchActive = false;
  springBackDrag();
}, { passive: true });

syncControls();
restoreItems();
render();
loadStaticItems();

calendar.addEventListener('click', (event) => {
  if (suppressNextClick) return;
  const btn = event.target.closest('.day');
  if (!btn || !btn.dataset.date) return;
  const key = btn.dataset.date;
  const dayItems = state.items
    .filter((item) => item.openDate === key && item.openTime)
    .sort((a, b) => a.openTime.localeCompare(b.openTime));
  if (dayItems.length) openDayModal(key, dayItems);
});

initCalendarSwipe();

// 남아있는 옛 서비스워커가 있으면 해제하고 캐시를 비운다 (stale 캐시 문제 종결).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations?.().then((regs) => {
    regs.forEach((reg) => reg.update());
  }).catch(() => {});
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  const root = document.documentElement;
  root.setAttribute('data-theme', next);
  root.style.colorScheme = next;
  const meta = document.getElementById('metaTheme');
  if (meta) meta.content = next === 'dark' ? '#0b0e15' : '#eef2fb';
  try {
    localStorage.setItem('toc_theme', next);
  } catch {
    // 저장 실패해도 현재 세션 테마는 유지된다.
  }
}

// 월 전환 슬라이드: 현재 콘텐츠가 밀려나가고 새 달이 반대편에서 들어온다.
// fromDx = 드래그로 이미 밀려 있던 위치(이어서 자연스럽게 나간다).
let sliding = false;
function slideMonth(dir, fromDx = 0) {
  if (sliding) return;
  const el = state.view === 'calendar' ? calendar : siteBoard;
  const W = el.parentElement?.offsetWidth || el.offsetWidth || 320;
  sliding = true;
  if (!fromDx) el.style.transform = 'translate3d(0, 0, 0)';
  void el.offsetWidth;
  el.style.transition = 'transform 0.16s ease-in';
  el.style.transform = `translate3d(${dir > 0 ? -W : W}px, 0, 0)`;
  setTimeout(() => {
    state.date = new Date(state.date.getFullYear(), state.date.getMonth() + dir, 1);
    render();
    el.style.transition = 'none';
    el.style.transform = `translate3d(${dir > 0 ? W : -W}px, 0, 0)`;
    void el.offsetWidth;
    el.style.transition = 'transform 0.26s cubic-bezier(0.25, 0.1, 0.25, 1)';
    el.style.transform = 'translate3d(0, 0, 0)';
    setTimeout(() => {
      el.style.transition = '';
      el.style.transform = '';
      sliding = false;
    }, 280);
  }, 170);
}

function playViewAnim() {
  const el = state.view === 'calendar' ? calendar : siteBoard;
  el.classList.remove('view-anim');
  void el.offsetWidth;
  el.classList.add('view-anim');
}

// TicketManager식 월 스와이프: 손가락 따라 현재 달이 밀려나고 인접 달이 옆에서 들어온다.
function initCalendarSwipe() {
  const vp = document.querySelector('.cal-viewport');
  if (!vp) return;
  let sx = 0;
  let sy = 0;
  let active = false;
  let decided = false;
  let horiz = false;
  let dir = 0;
  let W = 0;
  let pane = null;
  const SETTLE = 300;
  const EASE = 'transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)';

  function cleanup() {
    if (pane) { pane.remove(); pane = null; }
    calendar.style.transition = '';
    calendar.style.transform = '';
  }

  vp.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1 || state.view !== 'calendar') { active = false; return; }
    const t = event.touches[0];
    sx = t.clientX; sy = t.clientY; active = true; decided = false; horiz = false; dir = 0;
    W = vp.offsetWidth || 320;
  }, { passive: true });

  vp.addEventListener('touchmove', (event) => {
    if (!active || event.touches.length !== 1) return;
    const t = event.touches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (!decided) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dy) > Math.abs(dx)) { active = false; return; }
      decided = true; horiz = true; dir = dx < 0 ? 1 : -1;
      suppressNextClick = true;
      let ty = state.date.getFullYear();
      let tm = state.date.getMonth() + dir;
      if (tm < 0) { tm = 11; ty -= 1; }
      if (tm > 11) { tm = 0; ty += 1; }
      pane = document.createElement('div');
      pane.className = 'calendar-grid cal-pane';
      pane.innerHTML = calendarGridHTML(ty, tm);
      vp.appendChild(pane);
      pane.style.transition = 'none';
      calendar.style.transition = 'none';
      pane.style.transform = `translate3d(${dir > 0 ? W : -W}px, 0, 0)`;
    }
    if (horiz) {
      if (event.cancelable) event.preventDefault();
      const dxc = dir > 0 ? Math.max(-W, Math.min(0, dx)) : Math.min(W, Math.max(0, dx));
      calendar.style.transform = `translate3d(${dxc}px, 0, 0)`;
      if (pane) pane.style.transform = `translate3d(${(dir > 0 ? W : -W) + dxc}px, 0, 0)`;
    }
  }, { passive: false });

  function finish(event) {
    if (!active) return;
    active = false;
    if (!decided) return;
    const dx = event.changedTouches[0].clientX - sx;
    const pass = Math.abs(dx) > W * 0.16;
    calendar.style.transition = EASE;
    if (pane) pane.style.transition = EASE;
    if (pass) {
      calendar.style.transform = `translate3d(${dir > 0 ? -W : W}px, 0, 0)`;
      if (pane) pane.style.transform = 'translate3d(0, 0, 0)';
      setTimeout(() => {
        state.date = new Date(state.date.getFullYear(), state.date.getMonth() + dir, 1);
        render();
        cleanup();
        suppressNextClick = false;
      }, SETTLE);
    } else {
      calendar.style.transform = 'translate3d(0, 0, 0)';
      if (pane) pane.style.transform = `translate3d(${dir > 0 ? W : -W}px, 0, 0)`;
      setTimeout(() => { cleanup(); suppressNextClick = false; }, SETTLE);
    }
  }

  vp.addEventListener('touchend', finish, { passive: true });
  vp.addEventListener('touchcancel', () => {
    if (!active) return;
    active = false;
    calendar.style.transition = EASE;
    calendar.style.transform = 'translate3d(0, 0, 0)';
    setTimeout(cleanup, SETTLE);
  }, { passive: true });
}

function syncControls() {
  workspace.classList.toggle('is-site-view', state.view === 'site');
  calendarViewButton.classList.toggle('is-selected', state.view === 'calendar');
  siteViewButton.classList.toggle('is-selected', state.view === 'site');
  calendarViewButton.setAttribute('aria-pressed', state.view === 'calendar' ? 'true' : 'false');
  siteViewButton.setAttribute('aria-pressed', state.view === 'site' ? 'true' : 'false');
  const groups = {
    date: document.getElementById('groupDate'),
    views: document.getElementById('groupViews'),
    site: document.getElementById('groupSite'),
  };
  Object.entries(groups).forEach(([mode, btn]) => {
    btn.classList.toggle('is-selected', state.groupBy === mode);
    btn.setAttribute('aria-pressed', state.groupBy === mode ? 'true' : 'false');
  });
}

function setView(view) {
  state.view = view;
  try { localStorage.setItem(VIEW_KEY, view); } catch { /* 저장 실패 무시 */ }
  syncControls();
  render();
  playViewAnim();
}

function setGroupBy(mode) {
  state.groupBy = mode;
  try { localStorage.setItem(GROUP_KEY, mode); } catch { /* 저장 실패 무시 */ }
  syncControls();
  render();
}

function loadSchedules() {
  clearItems();
  resetStatus();
  loadButton.disabled = true;
  loadButton.classList.add('is-loading');
  summary.textContent = '사이트별 일정을 불러오는 중입니다.';

  const source = new EventSource('/api/load');
  source.addEventListener('status', (event) => {
    const payload = JSON.parse(event.data);
    setStatus(payload.site, payload.message, true);
  });
  source.addEventListener('siteDone', (event) => {
    const payload = JSON.parse(event.data);
    setStatus(payload.site, `${payload.count}건`, false);
  });
  source.addEventListener('siteError', (event) => {
    const payload = JSON.parse(event.data);
    setStatus(payload.site, `오류: ${payload.message}`, false);
  });
  source.addEventListener('items', (event) => {
    const payload = JSON.parse(event.data);
    mergeItems(payload.items);
    saveItems();
    setStatus(payload.site, `${siteCount(payload.site)}건 표시됨`, true);
    render();
  });
  source.addEventListener('done', (event) => {
    const payload = JSON.parse(event.data);
    mergeItems(payload.items);
    saveItems();
    source.close();
    loadButton.disabled = false;
    loadButton.classList.remove('is-loading');
    render();
  });
  source.addEventListener('fatal', (event) => {
    const payload = JSON.parse(event.data);
    source.close();
    loadButton.disabled = false;
    loadButton.classList.remove('is-loading');
    summary.textContent = `불러오기 실패: ${payload.message}`;
  });
  source.onerror = () => {
    source.close();
    loadButton.disabled = false;
    loadButton.classList.remove('is-loading');
  };
}

function mergeItems(items) {
  const byKey = new Map(state.items.map((item) => [itemKey(item), item]));
  items.forEach((item) => {
    // detail(공지 본문)은 data.json에만 있다 — detail 없는 소스(SSE 등)가 덮어써도 유지.
    const prev = byKey.get(itemKey(item));
    if (prev?.detail && !item.detail) item.detail = prev.detail;
    byKey.set(itemKey(item), item);
  });
  state.items = Array.from(byKey.values()).sort((a, b) => {
    const left = a.openDateTime || `${a.openDate}T99:99:99`;
    const right = b.openDateTime || `${b.openDate}T99:99:99`;
    return left.localeCompare(right) || a.title.localeCompare(b.title, 'ko');
  });
}

function clearItems() {
  state.items = [];
  highlightedDate = null;
  highlightedSite = null;
  searchInput.value = '';
  searchSuggestions.hidden = true;
  searchSuggestions.innerHTML = '';
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures; the in-memory reset still completes.
  }
  document.querySelectorAll('.status-item').forEach((item) => {
    item.classList.remove('is-selected');
    item.setAttribute('aria-pressed', 'false');
  });
  render();
}

function restoreItems() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(saved)) mergeItems(saved);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function saveItems() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items));
  } catch {
    // Ignore storage failures so rendering stays usable.
  }
}

async function loadStaticItems() {
  try {
    const response = await fetch('data.json', { cache: 'no-store' });
    if (!response.ok) return;
    const payload = await response.json();
    const items = Array.isArray(payload) ? payload : payload.items;
    if (!Array.isArray(items) || !items.length) return;
    mergeItems(items);
    render();
  } catch {
    // Static exports are optional; local manual loading still works without them.
  }
}

function itemKey(item) {
  return `${item.siteId}|${item.title}|${item.openDate}|${item.openTime || ''}`;
}

function siteCount(siteId) {
  return state.items.filter((item) => item.siteId === siteId).length;
}

function resetStatus() {
  document.querySelectorAll('.status-item').forEach((item) => {
    item.classList.remove('is-active');
    item.querySelector('span').textContent = '대기 중';
  });
}

function setStatus(site, message, active) {
  if (site === 'system') {
    summary.textContent = message;
    return;
  }
  const item = document.querySelector(`.status-item[data-site="${site}"]`);
  if (!item) return;
  item.classList.toggle('is-active', active);
  item.querySelector('span').textContent = message;
}

function toggleSiteHighlight(siteId) {
  highlightedSite = highlightedSite === siteId ? null : siteId;
  document.querySelectorAll('.status-item').forEach((item) => {
    const selected = item.dataset.site === highlightedSite;
    item.classList.toggle('is-selected', selected);
    item.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  render();
}

function render() {
  const year = state.date.getFullYear();
  const month = state.date.getMonth();
  monthLabel.textContent = `${year}년 ${month + 1}월`;
  workspace.classList.toggle('is-site-view', state.view === 'site');

  const datedMonthItems = state.items.filter((item) => {
    const date = parseLocalDate(item.openDate);
    return date.getFullYear() === year && date.getMonth() === month;
  });
  const monthItems = datedMonthItems.filter((item) => item.openTime);
  const unknownItems = state.items.filter((item) => !item.openTime);
  summary.textContent = state.items.length
    ? `전체 ${state.items.length}건, 이번 달 ${datedMonthItems.length}건`
    : '불러오기를 누르면 최신 일정이 표시됩니다.';

  calendar.hidden = state.view !== 'calendar';
  weekdayGrid.hidden = state.view !== 'calendar';
  siteBoard.hidden = state.view !== 'site';
  groupSwitch.hidden = state.view !== 'site';

  if (state.view === 'calendar') {
    renderCalendar(year, month);
  } else if (state.groupBy === 'views') {
    renderViewsBoard(datedMonthItems);
  } else if (state.groupBy === 'date') {
    renderDateBoard(datedMonthItems);
  } else {
    renderSiteBoard(datedMonthItems);
  }
  renderUnknown(unknownItems);
  renderSearchSuggestions();
}

function renderViewsBoard(items) {
  siteBoard.innerHTML = '';
  siteBoard.classList.add('by-date');
  const sorted = items
    .filter((item) => item.openTime)
    .slice()
    .sort((a, b) => {
      const av = a.viewCount == null ? -1 : a.viewCount;
      const bv = b.viewCount == null ? -1 : b.viewCount;
      return bv - av
        || `${a.openDate}T${a.openTime}`.localeCompare(`${b.openDate}T${b.openTime}`)
        || a.title.localeCompare(b.title, 'ko');
    });
  if (!sorted.length) {
    siteBoard.innerHTML = '<p class="empty">이번 달 일정이 없습니다.</p>';
    return;
  }
  const list = document.createElement('div');
  list.className = 'views-list';
  sorted.forEach((item) => list.appendChild(renderSiteBoardCard(item, true, true)));
  siteBoard.appendChild(list);
}

function renderDateBoard(items) {
  siteBoard.innerHTML = '';
  siteBoard.classList.add('by-date');

  const dated = items
    .filter((item) => item.openTime)
    .sort((a, b) => {
      const left = `${a.openDate}T${a.openTime || '99:99'}`;
      const right = `${b.openDate}T${b.openTime || '99:99'}`;
      return left.localeCompare(right) || a.title.localeCompare(b.title, 'ko');
    });

  if (!dated.length) {
    siteBoard.innerHTML = '<p class="empty">이번 달 일정이 없습니다.</p>';
    return;
  }

  const byDate = new Map();
  dated.forEach((item) => {
    if (!byDate.has(item.openDate)) byDate.set(item.openDate, []);
    byDate.get(item.openDate).push(item);
  });

  Array.from(byDate.entries()).forEach(([dateKey, dateItems]) => {
    const dateGroup = document.createElement('section');
    dateGroup.className = 'date-group';
    dateGroup.innerHTML = `
      <div class="site-date-head">
        <strong>${formatMonthDay(dateKey)}</strong>
        <span>${getWeekdayLabel(dateKey)} · ${dateItems.length}건</span>
      </div>
      <div class="site-time-list"></div>
    `;

    const timeList = dateGroup.querySelector('.site-time-list');
    const byTime = new Map();
    dateItems.forEach((item) => {
      const time = item.openTime || '시간 미정';
      if (!byTime.has(time)) byTime.set(time, []);
      byTime.get(time).push(item);
    });

    Array.from(byTime.entries()).forEach(([time, timeItems]) => {
      const timeGroup = document.createElement('section');
      timeGroup.className = 'site-time-group';
      timeGroup.innerHTML = `
        <div class="site-time-head">
          <span>${escapeHtml(time)}</span>
          <small>${timeItems.length}건</small>
        </div>
        <div class="site-time-items"></div>
      `;
      const timeItemsList = timeGroup.querySelector('.site-time-items');
      timeItems.forEach((item) => timeItemsList.appendChild(renderSiteBoardCard(item, true)));
      timeList.appendChild(timeGroup);
    });

    siteBoard.appendChild(dateGroup);
  });
}

function renderCalendar(year, month) {
  calendar.innerHTML = calendarGridHTML(year, month);
}

// 임의의 연/월에 대한 42칸 그리드 HTML (스와이프 인입 패널 재사용용, 리스너 없음)
function calendarGridHTML(year, month) {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const todayKey = formatDate(new Date());
  let html = '';
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = formatDate(date);
    const dayItems = state.items.filter((item) => item.openDate === key && item.openTime);
    const counts = getSiteCounts(dayItems);
    const cls = ['day'];
    if (dayItems.length) cls.push('has');
    if (date.getMonth() !== month) cls.push('is-muted');
    if (key === todayKey) cls.push('is-today');
    if (key === highlightedDate) cls.push('is-highlighted');
    if (highlightedSite && dayItems.some((item) => item.siteId === highlightedSite)) {
      cls.push('is-site-highlighted', `site-${highlightedSite}`);
    }
    let dots = '';
    SITES.forEach((site) => {
      const count = counts[site.id];
      if (count) dots += `<span class="day-dot site-${site.id}">${count}</span>`;
    });
    html += `<button type="button" class="${cls.join(' ')}" data-date="${key}">`
      + `<div class="date-row"><span class="date-number">${date.getDate()}</span></div>`
      + `<div class="day-dots">${dots}</div></button>`;
  }
  return html;
}

function getSiteCounts(items) {
  return {
    all: items.length,
    interpark: items.filter((item) => item.siteId === 'interpark').length,
    ticketlink: items.filter((item) => item.siteId === 'ticketlink').length,
    melon: items.filter((item) => item.siteId === 'melon').length,
  };
}

function renderSiteBoard(items) {
  siteBoard.innerHTML = '';
  siteBoard.classList.remove('by-date');
  SITES.forEach((site) => {
    const siteItems = items
      .filter((item) => item.siteId === site.id)
      .sort((a, b) => {
        const left = `${a.openDate}T${a.openTime || '99:99'}`;
        const right = `${b.openDate}T${b.openTime || '99:99'}`;
        return left.localeCompare(right) || a.title.localeCompare(b.title, 'ko');
      });

    const column = document.createElement('section');
    column.className = `site-column site-${site.id}`;
    column.innerHTML = `
      <div class="site-column-head">
        <span class="site-mark">${escapeHtml(site.shortName)}</span>
        <div>
          <h3>${escapeHtml(site.name)}</h3>
          <p>${siteItems.length}건</p>
        </div>
      </div>
      <div class="site-column-list"></div>
    `;

    const list = column.querySelector('.site-column-list');
    if (!siteItems.length) {
      list.innerHTML = '<p class="empty">이번 달 일정이 없습니다.</p>';
    } else {
      const byDate = new Map();
      siteItems.forEach((item) => {
        if (!byDate.has(item.openDate)) byDate.set(item.openDate, []);
        byDate.get(item.openDate).push(item);
      });

      Array.from(byDate.entries()).forEach(([dateKey, dateItems]) => {
        const dateGroup = document.createElement('section');
        dateGroup.className = 'site-date-group';
        dateGroup.innerHTML = `
          <div class="site-date-head">
            <strong>${formatMonthDay(dateKey)}</strong>
            <span>${getWeekdayLabel(dateKey)} · ${dateItems.length}건</span>
          </div>
          <div class="site-time-list"></div>
        `;

        const timeList = dateGroup.querySelector('.site-time-list');
        const byTime = new Map();
        dateItems.forEach((item) => {
          const time = item.openTime || '시간 미정';
          if (!byTime.has(time)) byTime.set(time, []);
          byTime.get(time).push(item);
        });

        Array.from(byTime.entries()).forEach(([time, timeItems]) => {
          const timeGroup = document.createElement('section');
          timeGroup.className = 'site-time-group';
          timeGroup.innerHTML = `
            <div class="site-time-head">
              <span>${escapeHtml(time)}</span>
              <small>${timeItems.length}건</small>
            </div>
            <div class="site-time-items"></div>
          `;

          const timeItemsList = timeGroup.querySelector('.site-time-items');
          timeItems.forEach((item) => timeItemsList.appendChild(renderSiteBoardCard(item)));
          timeList.appendChild(timeGroup);
        });

        list.appendChild(dateGroup);
      });
    }
    siteBoard.appendChild(column);
  });
}

function renderSiteBoardCard(item, showSite = false, showDate = false) {
  const link = document.createElement('a');
  link.className = `site-board-card site-${item.siteId}${item.image ? ' has-thumb' : ''}${isPopular(item) ? ' is-popular' : ''}`;
  link.href = resolveMelonUrl(item.url);
  link.dataset.url = item.url;
  link.target = '_blank';
  link.rel = 'noreferrer';
  const siteTag = showSite
    ? `<span class="board-card-site site-${item.siteId}">${escapeHtml(siteShortName(item.siteId))}</span>`
    : '';
  const dateTag = showDate
    ? `<span class="board-card-date">${escapeHtml(formatMonthDay(item.openDate))} ${escapeHtml(item.openTime || '')}</span>`
    : '';
  // 썸네일 칸을 먼저 잡고, 이미지가 깨지면 칸까지 제거한다(빈 회색칸 방지).
  const thumb = item.image
    ? `<img class="board-thumb" src="${escapeHtml(item.image)}" alt="" onerror="this.closest('.site-board-card')?.classList.remove('has-thumb');this.remove();">`
    : '';
  link.innerHTML = `
    ${popularFlagHtml(item)}
    ${thumb}
    <div class="board-card-title">
      ${siteTag}
      ${dateTag}
      <strong>${escapeHtml(item.title)}</strong>
      ${viewCountHtml(item)}
    </div>
  `;
  return link;
}

function siteShortName(siteId) {
  return SITES.find((site) => site.id === siteId)?.shortName || siteId;
}

function renderSearchSuggestions() {
  const query = searchInput.value.trim().toLowerCase();
  if (!query || !state.items.length || document.activeElement !== searchInput) {
    searchSuggestions.hidden = true;
    searchSuggestions.innerHTML = '';
    return;
  }

  const matches = state.items
    .filter((item) => item.title.toLowerCase().includes(query))
    .slice(0, 10);

  if (!matches.length) {
    searchSuggestions.innerHTML = '<div class="suggestion-empty">검색 결과 없음</div>';
    searchSuggestions.hidden = false;
    return;
  }

  searchSuggestions.innerHTML = '';
  matches.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `suggestion-item site-${item.siteId}`;
    button.innerHTML = `
      <strong>${escapeHtml(item.title)}</strong>
      <span>${item.openDate} ${item.openTime || '시간 미정'} · ${escapeHtml(item.site)}</span>
    `;
    button.addEventListener('click', () => selectSuggestion(item));
    searchSuggestions.appendChild(button);
  });
  searchSuggestions.hidden = false;
}

// 검색 결과 선택 = 해당 아이템 미리보기 팝업 (뷰 전환/스크롤 점프는 하지 않는다)
function selectSuggestion(item) {
  searchInput.value = item.title;
  searchSuggestions.hidden = true;
  searchInput.blur();
  openPreview(item);
}

function renderUnknown(items) {
  unknownCount.textContent = `${items.length}건`;
  unknownList.innerHTML = '';
  if (!items.length) {
    unknownList.innerHTML = '<p class="empty">시간이 정해지지 않은 공연이 없습니다.</p>';
    return;
  }
  items.forEach((item) => {
    const link = document.createElement('a');
    link.className = `unknown-card site-${item.siteId}${isPopular(item) ? ' is-popular' : ''}`;
    link.href = resolveMelonUrl(item.url);
    link.dataset.url = item.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.innerHTML = `
      ${popularFlagHtml(item)}
      <span class="site-label site-${item.siteId}">${escapeHtml(item.site)}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <span>${item.openDate}</span>
    `;
    unknownList.appendChild(link);
  });
}

function openDayModal(dateKey, items) {
  pushModalHistory();
  modalTitle.textContent = `${dateKey} 오픈 일정`;
  renderModalItems(items, 'all');
  modal.hidden = false;
  updateScrollLock();
}

// 아이템 미리보기 모달: 모든 예매처 공통. 이동은 포스터 아래 예매처색 뱃지 링크로.
function openPreview(item) {
  pushModalHistory();
  modalTitle.textContent = item.title;
  modal.hidden = false;
  updateScrollLock();
  const melonId = item.siteId === 'melon' ? /csoonId=(\d+)/.exec(item.url || '')?.[1] : null;
  if (melonId) {
    openMelonDetail(melonId, previewGoHtml(item));
    return;
  }
  renderStoredDetail(item);
}

function previewGoHtml(item) {
  return `<a class="modal-go site-${item.siteId}" href="${escapeHtml(resolveMelonUrl(item.url))}" target="_blank" rel="noreferrer noopener">예매처 사이트로 이동 ↗</a>`;
}

// 수집 단계에서 긁어온 상세(detail: [label, html][])를 렌더한다. 없으면 안내만.
function renderStoredDetail(item) {
  const poster = item.image
    ? `<img class="melon-detail-poster" src="${escapeHtml(item.image)}" alt="" onerror="this.remove();">`
    : '';
  const sections = (Array.isArray(item.detail) ? item.detail : [])
    .filter(([, html]) => html && String(html).trim())
    .map(([label, html]) => `
      <section class="melon-detail-section">
        <h3>${escapeHtml(label)}</h3>
        <div class="melon-detail-body">${sanitizeNoticeHtml(html)}</div>
      </section>
    `).join('');
  modalList.innerHTML = `
    <div class="melon-detail">
      ${poster}
      ${previewGoHtml(item)}
      ${sections || '<p class="empty">상세 정보가 아직 수집되지 않았습니다.</p>'}
    </div>
  `;
}

// 멜론 공지 HTML에서 위험 요소(script 등)와 인라인 이벤트를 제거한다.
function sanitizeNoticeHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  doc.querySelectorAll('script, style, iframe, object, embed, link, meta, form').forEach((el) => el.remove());
  doc.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || (name === 'href' && /^javascript:/i.test(attr.value))) el.removeAttribute(attr.name);
    });
  });
  return doc.body.innerHTML;
}

// 멜론 상세는 tktapi 상세 API가 CORS 개방(ACAO: *)이라 클라이언트에서 실시간으로 불러온다.
async function openMelonDetail(csoonId, goHtml) {
  modalList.innerHTML = '<p class="empty">멜론 상세 정보를 불러오는 중...</p>';

  let data = null;
  try {
    const res = await fetch(`https://tktapi.melon.com/poc/ticketOpen/detail.json?csoonId=${csoonId}&v=1`);
    const json = await res.json();
    if (json.result === 0 && json.data) data = json.data;
  } catch {
    // 아래 폴백 처리
  }

  if (!data) {
    modalList.innerHTML = `
      <div class="melon-detail">
        ${goHtml || ''}
        <p class="empty">상세 정보를 불러오지 못했습니다.</p>
      </div>
    `;
    return;
  }

  const poster = data.posterUrl ? `https://cdnticket.melon.co.kr${data.posterUrl}` : '';
  const sections = [
    ['기본정보', data.infoPerf],
    ['공연소개', data.infoComt],
    ['할인정보', data.infoDisc],
    ['기획사 정보', data.infoPartner ? escapeHtml(data.infoPartner).replace(/\n/g, '<br>') : ''],
  ].filter(([, html]) => html && String(html).trim());

  modalList.innerHTML = `
    <div class="melon-detail">
      ${poster ? `<img class="melon-detail-poster" src="${escapeHtml(poster)}" alt="" onerror="this.remove();">` : ''}
      ${goHtml || ''}
      ${sections.map(([label, html]) => `
        <section class="melon-detail-section">
          <h3>${label}</h3>
          <div class="melon-detail-body">${sanitizeNoticeHtml(html)}</div>
        </section>
      `).join('')}
    </div>
  `;
}

function updateScrollLock() {
  document.body.classList.toggle('no-scroll', !modal.hidden);
}

function renderModalItems(items, siteId) {
  const filtered = siteId === 'all' ? items : items.filter((item) => item.siteId === siteId);
  const counts = {
    all: items.length,
    interpark: items.filter((item) => item.siteId === 'interpark').length,
    ticketlink: items.filter((item) => item.siteId === 'ticketlink').length,
    melon: items.filter((item) => item.siteId === 'melon').length,
  };
  modalList.innerHTML = `
    <div class="modal-filter" role="tablist">
      ${filterButton('all', '전체', counts.all, siteId)}
      ${filterButton('interpark', 'NOL', counts.interpark, siteId)}
      ${filterButton('ticketlink', '티켓링크', counts.ticketlink, siteId)}
      ${filterButton('melon', '멜론', counts.melon, siteId)}
    </div>
    <div class="modal-items"></div>
  `;
  modalList.querySelectorAll('.filter-chip').forEach((button) => {
    button.addEventListener('click', () => renderModalItems(items, button.dataset.site));
  });

  const container = modalList.querySelector('.modal-items');
  if (!filtered.length) {
    container.innerHTML = '<p class="empty">선택한 예매처의 일정이 없습니다.</p>';
    return;
  }

  const grouped = filtered.reduce((groups, item) => {
    const time = item.openTime || '시간 미정';
    if (!groups.has(time)) groups.set(time, []);
    groups.get(time).push(item);
    return groups;
  }, new Map());

  Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([time, groupItems]) => {
      const group = document.createElement('section');
      group.className = 'time-group';
      group.innerHTML = `
        <div class="time-group-head">
          <strong>${escapeHtml(time)}</strong>
          <span>${groupItems.length}건</span>
        </div>
      `;

      const list = document.createElement('div');
      list.className = 'time-group-list';
      groupItems.forEach((item) => {
        const link = document.createElement('a');
        link.className = `modal-item site-${item.siteId}${item.image ? ' has-thumb' : ''}${isPopular(item) ? ' is-popular' : ''}`;
        link.href = resolveMelonUrl(item.url);
        link.dataset.url = item.url;
        link.target = '_blank';
        link.rel = 'noreferrer';
        const mThumb = item.image
          ? `<img class="modal-thumb" src="${escapeHtml(item.image)}" alt="" onerror="this.closest('.modal-item')?.classList.remove('has-thumb');this.remove();">`
          : '';
        link.innerHTML = `
          ${popularFlagHtml(item)}
          ${mThumb}
          <span class="meta-badge time-badge">${escapeHtml(item.openTime || '시간 미정')}</span>
          <span class="modal-mid">
            <strong>${escapeHtml(item.title)}</strong>
            ${viewCountHtml(item)}
          </span>
          <span class="meta-badge site-badge site-${item.siteId}">${escapeHtml(item.site)}</span>
        `;
        list.appendChild(link);
      });
      group.appendChild(list);
      container.appendChild(group);
    });
}

function filterButton(siteId, label, count, active) {
  return `<button type="button" class="filter-chip ${siteId === active ? 'is-selected' : ''} site-${siteId}" data-site="${siteId}">
    <span>${label}</span><strong>${count}</strong>
  </button>`;
}

// 뒤로가기 = 모달 닫기 (앱 종료 방지): 모달 열 때 히스토리 한 칸을 쌓고,
// popstate(뒤로가기)에서 닫는다. X/배경 탭 닫기는 history.back()으로 그 칸을 소비한다.
let modalPushed = false;

function pushModalHistory() {
  if (modal.hidden && !modalPushed) {
    history.pushState({ tocModal: 1 }, '');
    modalPushed = true;
  }
}

window.addEventListener('popstate', () => {
  modalPushed = false;
  if (!modal.hidden) reallyCloseModal();
});

function closeModal() {
  if (modal.hidden) return;
  if (modalPushed) {
    history.back(); // popstate 핸들러가 실제로 닫는다
    return;
  }
  reallyCloseModal();
}

function reallyCloseModal() {
  modal.hidden = true;
  updateScrollLock();
}

function parseLocalDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatMonthDay(value) {
  const date = parseLocalDate(value);
  return `${date.getMonth() + 1}.${String(date.getDate()).padStart(2, '0')}`;
}

function getWeekdayLabel(value) {
  return ['일', '월', '화', '수', '목', '금', '토'][parseLocalDate(value).getDay()];
}

// 인기공연: 조회수가 임계값(500) 이상.
function isPopular(item) {
  return item.viewCount != null && item.viewCount >= POPULAR_VIEW_THRESHOLD;
}

// TicketManager 양도/취소 표시처럼 카드 모서리에 대각선 띠(리본)로 인기 표시.
function popularFlagHtml(item) {
  if (!isPopular(item)) return '';
  return `<span class="popular-ribbon" title="조회 ${item.viewCount.toLocaleString()}회 인기공연">인기</span>`;
}

// 멜론 데스크톱 상세 URL을 모바일 딥링크로 변환한다.
// 데스크톱 URL(ticket.melon.com/csoon/detail.htm)은 모바일에서 홈으로 튕길 수 있어,
// 모바일에선 상세 SPA로 바로 가고 데스크톱에선 상세로 리다이렉트되는 딥링크로 통일한다.
function resolveMelonUrl(url) {
  // 멜론은 항상 https 정규 URL 로 통일한다.
  // 안드로이드/데스크톱: 데스크톱 상세 URL — 기본 브라우저에서 열면 모바일은 302로
  // 정상 모바일 상세로 넘어가고, 데스크톱은 그대로 열린다.
  // iOS: 모바일 해시 딥링크(에뮬레이션 검증 — 콜드 로드로 상세 렌더).
  if (!/melon\.com/.test(url || '')) return url;
  const m = /csoonId=(\d+)/.exec(url);
  if (!m) return url;
  if (/iPhone|iPad/i.test(navigator.userAgent)) {
    return `https://m.ticket.melon.com/public/index.html#ticketopen.detail?csoonId=${m[1]}`;
  }
  return `https://ticket.melon.com/csoon/detail.htm?csoonId=${m[1]}`;
}

// 조회수 숫자 표시
function viewCountHtml(item) {
  if (item.viewCount == null) return '';
  return `<span class="view-count">조회 ${item.viewCount.toLocaleString()}</span>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
