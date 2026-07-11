const STORAGE_KEY = 'ticket-open-checker:schedules';

const state = {
  date: new Date(),
  items: [],
  view: 'calendar',
  groupBy: 'date',
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

document.getElementById('prevMonth').addEventListener('click', () => moveMonth(-1));
document.getElementById('nextMonth').addEventListener('click', () => moveMonth(1));
document.getElementById('today').addEventListener('click', () => {
  state.date = new Date();
  render();
  playViewAnim();
});
calendarViewButton.addEventListener('click', () => setView('calendar'));
siteViewButton.addEventListener('click', () => setView('site'));
document.getElementById('groupSite').addEventListener('click', () => setGroupBy('site'));
document.getElementById('groupDate').addEventListener('click', () => setGroupBy('date'));
loadButton.addEventListener('click', loadSchedules);
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
    closeConfirm();
  }
});

const confirmModal = document.getElementById('confirmModal');
const confirmSub = document.getElementById('confirmSub');
const confirmGo = document.getElementById('confirmGo');
let pendingUrl = null;

confirmModal.addEventListener('click', (event) => {
  if (event.target.closest('[data-confirm-close]') || !event.target.closest('.confirm-card')) {
    closeConfirm();
  }
});
confirmGo.addEventListener('click', () => {
  if (pendingUrl) window.open(pendingUrl, '_blank', 'noopener');
  closeConfirm();
});

// 예매처 링크 클릭 시 바로 열지 않고 이동 여부를 먼저 확인한다.
document.addEventListener('click', (event) => {
  if (suppressNextClick) return;
  const link = event.target.closest('a.modal-item, a.unknown-card, a.site-board-card');
  if (!link || !link.href) return;
  event.preventDefault();
  const title = link.querySelector('strong')?.textContent?.trim() || '';
  askNavigate(link.href, title);
});

// 스와이프: 캘린더 위에서는 달을 넘기고, 그 외 영역에서는 캘린더↔리스트를 전환한다. (터치/펜만)
let swipeX = 0;
let swipeY = 0;
let swipeTime = 0;
let swipeEl = null;
let suppressNextClick = false;
document.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'mouse') return;
  swipeX = event.clientX;
  swipeY = event.clientY;
  swipeTime = Date.now();
  swipeEl = event.target;
}, { passive: true });
document.addEventListener('pointerup', (event) => {
  const el = swipeEl;
  swipeEl = null;
  if (!el || event.pointerType === 'mouse') return;
  const dx = event.clientX - swipeX;
  const dy = event.clientY - swipeY;
  if (Date.now() - swipeTime > 700) return;
  if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
  if (el.closest('.modal') || el.closest('.search-box')) return;
  suppressNextClick = true;
  setTimeout(() => { suppressNextClick = false; }, 400);
  if (el.closest('#calendar')) {
    moveMonth(dx < 0 ? 1 : -1);
  } else {
    setView(state.view === 'calendar' ? 'site' : 'calendar');
  }
}, { passive: true });

restoreItems();
render();
loadStaticItems();

// 남아있는 옛 서비스워커가 있으면 해제하고 캐시를 비운다 (stale 캐시 문제 종결).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations?.().then((regs) => {
    regs.forEach((reg) => reg.update());
  }).catch(() => {});
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  const meta = document.getElementById('metaTheme');
  if (meta) meta.content = next === 'dark' ? '#0b0e15' : '#eef2fb';
  try {
    localStorage.setItem('toc_theme', next);
  } catch {
    // 저장 실패해도 현재 세션 테마는 유지된다.
  }
}

function moveMonth(delta) {
  state.date = new Date(state.date.getFullYear(), state.date.getMonth() + delta, 1);
  render();
  playViewAnim();
}

function playViewAnim() {
  const el = state.view === 'calendar' ? calendar : siteBoard;
  el.classList.remove('view-anim');
  void el.offsetWidth;
  el.classList.add('view-anim');
}

function setView(view) {
  state.view = view;
  workspace.classList.toggle('is-site-view', view === 'site');
  calendarViewButton.classList.toggle('is-selected', view === 'calendar');
  siteViewButton.classList.toggle('is-selected', view === 'site');
  calendarViewButton.setAttribute('aria-pressed', view === 'calendar' ? 'true' : 'false');
  siteViewButton.setAttribute('aria-pressed', view === 'site' ? 'true' : 'false');
  render();
  playViewAnim();
}

function setGroupBy(mode) {
  state.groupBy = mode;
  document.getElementById('groupSite').classList.toggle('is-selected', mode === 'site');
  document.getElementById('groupDate').classList.toggle('is-selected', mode === 'date');
  document.getElementById('groupSite').setAttribute('aria-pressed', mode === 'site' ? 'true' : 'false');
  document.getElementById('groupDate').setAttribute('aria-pressed', mode === 'date' ? 'true' : 'false');
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
  items.forEach((item) => byKey.set(itemKey(item), item));
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
  state.popular = computePopular(state.items);
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
  } else if (state.groupBy === 'date') {
    renderDateBoard(datedMonthItems);
  } else {
    renderSiteBoard(datedMonthItems);
  }
  renderUnknown(unknownItems);
  renderSearchSuggestions();
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
  calendar.innerHTML = '';
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const todayKey = formatDate(new Date());

  for (let i = 0; i < 42; i += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = formatDate(date);
    const dayItems = state.items
      .filter((item) => item.openDate === key && item.openTime)
      .sort((a, b) => a.openTime.localeCompare(b.openTime));
    const hasHighlightedSite = highlightedSite && dayItems.some((item) => item.siteId === highlightedSite);
    const counts = getSiteCounts(dayItems);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'day';
    if (date.getMonth() !== month) button.classList.add('is-muted');
    if (key === todayKey) button.classList.add('is-today');
    if (key === highlightedDate) button.classList.add('is-highlighted');
    if (hasHighlightedSite) button.classList.add('is-site-highlighted', `site-${highlightedSite}`);
    button.dataset.date = key;
    button.innerHTML = `
      <div class="date-row">
        <span class="date-number">${date.getDate()}</span>
      </div>
      <div class="day-dots"></div>
    `;
    button.addEventListener('click', () => {
      if (suppressNextClick) return;
      if (dayItems.length) openDayModal(key, dayItems);
    });

    const dots = button.querySelector('.day-dots');
    SITES.forEach((site) => {
      const count = counts[site.id];
      if (!count) return;
      const dot = document.createElement('span');
      dot.className = `day-dot site-${site.id}`;
      dot.textContent = count;
      dot.title = `${site.name} ${count}건 오픈`;
      dots.appendChild(dot);
    });
    calendar.appendChild(button);
  }
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

function renderSiteBoardCard(item, showSite = false) {
  const link = document.createElement('a');
  link.className = `site-board-card site-${item.siteId}${isPopular(item) ? ' is-popular' : ''}`;
  link.href = item.url;
  link.target = '_blank';
  link.rel = 'noreferrer';
  const siteTag = showSite
    ? `<span class="board-card-site site-${item.siteId}">${escapeHtml(siteShortName(item.siteId))}</span>`
    : '';
  link.innerHTML = `
    <div class="board-card-title">
      ${siteTag}
      <strong>${escapeHtml(item.title)}</strong>
      ${popularFlagHtml(item)}
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

function selectSuggestion(item) {
  const date = parseLocalDate(item.openDate);
  state.date = new Date(date.getFullYear(), date.getMonth(), 1);
  state.view = 'calendar';
  setView('calendar');
  highlightedDate = item.openDate;
  searchInput.value = item.title;
  searchSuggestions.hidden = true;
  render();
  requestAnimationFrame(() => {
    document.querySelector(`.day[data-date="${item.openDate}"]`)?.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    });
  });
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
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.innerHTML = `
      <span class="site-label site-${item.siteId}">${escapeHtml(item.site)}</span>
      <strong>${escapeHtml(item.title)}</strong>
      ${popularFlagHtml(item)}
      <span>${item.openDate}</span>
    `;
    unknownList.appendChild(link);
  });
}

function openDayModal(dateKey, items) {
  modalTitle.textContent = `${dateKey} 오픈 일정`;
  renderModalItems(items, 'all');
  modal.hidden = false;
  updateScrollLock();
}

function updateScrollLock() {
  const open = !modal.hidden || !confirmModal.hidden;
  document.body.classList.toggle('no-scroll', open);
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
        link.className = `modal-item site-${item.siteId}${isPopular(item) ? ' is-popular' : ''}`;
        link.href = item.url;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.innerHTML = `
          <span class="meta-badge time-badge">${escapeHtml(item.openTime || '시간 미정')}</span>
          <strong>${isPopular(item) ? '🔥 ' : ''}${escapeHtml(item.title)}</strong>
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

function closeModal() {
  modal.hidden = true;
  updateScrollLock();
}

function askNavigate(url, title) {
  pendingUrl = url;
  confirmSub.textContent = title || '';
  confirmSub.hidden = !title;
  confirmModal.hidden = false;
  confirmGo.focus();
  updateScrollLock();
}

function closeConfirm() {
  confirmModal.hidden = true;
  pendingUrl = null;
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

const POPULAR_VIEW_THRESHOLD = 1000;

function normTitleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/티켓오픈|오픈|안내/g, '')
    .replace(/[\s\[\]<>()·:,.!?~"'`\-_/]/g, '');
}

// 인기공연: 조회수 1000 이상이거나, 같은 공연이 2개 이상 예매처에서 열리는 경우.
function computePopular(items) {
  const byTitle = new Map();
  items.forEach((item) => {
    const key = normTitleKey(item.title);
    if (!key) return;
    if (!byTitle.has(key)) byTitle.set(key, new Set());
    byTitle.get(key).add(item.siteId);
  });
  const multi = new Set();
  byTitle.forEach((sites, key) => {
    if (sites.size >= 2) multi.add(key);
  });
  return multi;
}

function isPopular(item) {
  if (item.viewCount != null && item.viewCount >= POPULAR_VIEW_THRESHOLD) return true;
  return state.popular ? state.popular.has(normTitleKey(item.title)) : false;
}

function popularFlagHtml(item) {
  if (!isPopular(item)) return '';
  const title = item.viewCount != null && item.viewCount >= POPULAR_VIEW_THRESHOLD
    ? `조회 ${item.viewCount.toLocaleString()}회 인기공연`
    : '여러 예매처 오픈 · 인기공연';
  return `<span class="popular-flag" title="${title}">🔥 인기</span>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
