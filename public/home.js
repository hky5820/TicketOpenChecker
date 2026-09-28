const Model = window.ScheduleModel;
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const safeUrl = value => { try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? esc(url.href) : ''; } catch { return ''; } };
const VN = { interpark: 'NOL 티켓', melon: '멜론 티켓', ticketlink: '티켓링크' };
const STORAGE_KEY = 'ticket-open-checker:schedules';
const DATA_KEY = 'toc:workspaceData';
const ALARM_KEY = 'toc:alarms';
const ALARM_ITEMS_KEY = 'toc:alarmItems';
const IS_STATIC = location.hostname.endsWith('github.io');
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const itemKey = Model.itemKey;
const CALENDAR_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 5h4"/></svg>';
const BELL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage may be full or disabled. */ } };
const defaults = (view = 'home') => ({ date: Model.dateKey(), range: view === 'sports' ? 'upcoming' : 'day', autoDate: view === 'home', basis: 'open', vendor: '', team: '', status: 'all', query: '' });
const state = {
  items: [], sports: { items: [], teamStatus: {} }, siteStatus: {}, generatedAt: null, view: 'home',
  filters: { home: defaults(), sports: defaults('sports') }, month: Model.dateKey().slice(0, 7),
  alarms: read(ALARM_KEY, {}), alarmItems: read(ALARM_ITEMS_KEY, []), loading: false, statuses: {},
};
if (!state.alarms || typeof state.alarms !== 'object' || Array.isArray(state.alarms)) state.alarms = {};
if (!Array.isArray(state.alarmItems)) state.alarmItems = [];
const options = () => state.filters[state.view === 'sports' ? 'sports' : 'home'];
const sourceItems = () => state.view === 'sports' ? state.sports.items || [] : state.items;
const allItems = () => [...new Map([...state.alarmItems, ...state.items, ...(state.sports.items || [])].map(item => [itemKey(item), item])).values()];
const shortDate = key => key ? `${Number(key.slice(5, 7))}.${Number(key.slice(8, 10))} (${WD[new Date(`${key}T00:00:00Z`).getUTCDay()]})` : '미정';
const fullDate = key => key ? `${Number(key.slice(5, 7))}월 ${Number(key.slice(8, 10))}일 ${WD[new Date(`${key}T00:00:00Z`).getUTCDay()]}요일` : '오픈일 미정';
const stamp = value => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '아직 수집 전';
const timeLabel = value => value ? `${shortDate(value.slice(0, 10))} ${value.slice(11, 16)}` : '미정';

function countdown(value) {
  const seconds = Math.floor((Date.parse(value) - Date.now()) / 1000);
  if (!(seconds > 0)) return '오픈 시각 도래';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 ${String(seconds % 60).padStart(2, '0')}초 후`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간 ${Math.floor(seconds % 3600 / 60)}분 후`;
  return `${Math.floor(seconds / 86400)}일 ${Math.floor(seconds % 86400 / 3600)}시간 후`;
}
function hasAlarm(key) { return Object.prototype.hasOwnProperty.call(state.alarms, key); }
function bell(item) {
  const key = itemKey(item), on = hasAlarm(key);
  if (!on && (!item.openDateTime || Date.parse(item.openDateTime) <= Date.now())) return '<span class="alarm-spacer"></span>';
  return `<button class="bell${on ? ' on' : ''}" data-alarm="${esc(key)}" aria-pressed="${on}" aria-label="${esc(item.title)} 오픈 알림 ${on ? '해제' : '설정'}" title="오픈 알림 ${on ? '해제' : '설정'}">${BELL_ICON}</button>`;
}
function statusMarkup(item) {
  const status = Model.status(item);
  return `<span class="status ${status.tone}">${status.label}</span>${status.id === 'scheduled' ? `<span class="countdown" data-countdown="${esc(item.openDateTime)}">${countdown(item.openDateTime)}</span>` : ''}`;
}
function vendorMarkup(item, extra = '') {
  return `<span class="vendor-label ${esc(item.siteId)} ${extra}"><i></i>${esc(VN[item.siteId] || item.site)}</span>`;
}
function concertRow(item) {
  const url = safeUrl(item.url), image = safeUrl(item.image);
  return `<article class="ticket-row" data-item="${esc(itemKey(item))}">
    <div class="row-time">${esc(item.openTime || '미정')}<small>티켓 오픈</small></div>
    <div class="ticket-info">${image ? `<img class="poster" src="${image}" alt="" loading="lazy">` : '<span class="poster"></span>'}<div class="ticket-copy"><a class="ticket-title" title="${esc(item.title)}" href="${url || '#'}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a><div class="ticket-meta">${vendorMarkup(item, 'mobile-vendor')}<a class="row-link" href="${url || '#'}" target="_blank" rel="noopener noreferrer">오픈 공지 ↗</a></div></div></div>
    ${vendorMarkup(item)}<div class="row-status">${statusMarkup(item)}</div>${bell(item)}</article>`;
}
function sportsRow(item) {
  const logo = (url) => safeUrl(url) ? `<img src="${safeUrl(url)}" alt="" loading="lazy">` : '';
  const status = Model.status(item);
  const uncertain = state.sports.teamStatus?.[item.teamId]?.ok === false;
  return `<article class="sports-row" data-team="${esc(item.teamId)}" data-item="${esc(item.id)}">
    <div class="open-info"><strong>${esc(item.openTime || item.openDateTime?.slice(11, 16) || '미정')}</strong><small>예매 오픈</small></div>
    <div class="match-info"><a class="match-teams" href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(item.awayTeam)} 대 ${esc(item.homeTeam)} 경기 페이지">${logo(item.awayLogo)}<span>${esc(item.awayShortName)}</span><span class="versus">vs</span>${logo(item.homeLogo)}<span>${esc(item.homeShortName)}</span><span class="home-label">홈</span></a><div class="game-date">경기 ${shortDate(item.gameDate)} ${esc(item.gameTime)}<span class="venue">${esc(item.venue)}</span></div>${item.preOpenDateTime ? `<span class="preopen">선예매 ${timeLabel(item.preOpenDateTime)}</span>` : ''}</div>
    <div class="row-status">${uncertain ? '<span class="status amber">이전 조회 자료</span>' : statusMarkup(item)}<a class="row-link" href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer">${status.id === 'open' && !uncertain ? '예매처 열기' : '경기 확인'} ↗</a></div>${bell(item)}</article>`;
}

function renderCalendar() {
  const filter = options();
  const first = `${state.month}-01`;
  const offset = new Date(`${first}T00:00:00Z`).getUTCDay();
  const counts = new Map();
  Model.filter(sourceItems(), { ...filter, range: 'all' }).forEach(item => {
    const key = filter.basis === 'game' ? item.gameDate : item.openDate;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  $('#calendarMonth').textContent = `${state.month.slice(0, 4)}년 ${Number(state.month.slice(5))}월`;
  $('#monthPrev').disabled = state.month <= Model.dateKey().slice(0, 7);
  $('#calendarGrid').innerHTML = Array.from({ length: 42 }, (_, index) => {
    const key = Model.addDays(first, index - offset), count = counts.get(key) || 0;
    const selected = filter.range === 'day' && key === filter.date;
    const classes = [key.slice(0, 7) !== state.month ? 'outside' : '', key === Model.dateKey() ? 'today' : '', selected ? 'selected' : '', count ? 'has-events' : ''].join(' ');
    return `<button class="${classes}" data-date="${key}" ${key < Model.dateKey() ? 'disabled' : ''} aria-pressed="${selected}" aria-label="${key} ${count}건">${Number(key.slice(8))}</button>`;
  }).join('');
}

function renderDateStrip() {
  if (state.view !== 'home') return;
  const filter = options(), today = Model.dateKey(), strip = $('#dateStrip');
  const items = Model.filter(sourceItems(), { ...filter, range: 'all' });
  const target = filter.range === 'upcoming' ? items.find(item => item.openDate)?.openDate || today : filter.date;
  const start = target > Model.addDays(today, 60) ? Model.addDays(target, -7) : today;
  const days = 61;
  const previousTarget = strip.dataset.focus, previousScroll = strip.scrollLeft;
  strip.dataset.start = start;
  strip.dataset.focus = target;
  $('#dateDialogTitle').textContent = '오픈 날짜 선택';
  strip.innerHTML = Array.from({ length: days }, (_, index) => {
    const key = Model.addDays(start, index), count = items.filter(item => item.openDate === key).length;
    const selected = filter.range === 'day' && key === filter.date;
    return `<button data-date="${key}" class="${count ? 'has-events' : ''}" aria-pressed="${selected}" aria-label="${fullDate(key)} ${count}건"><span>${key === today ? '오늘' : WD[new Date(`${key}T00:00:00Z`).getUTCDay()]}</span><strong>${Number(key.slice(8)) === 1 ? `${Number(key.slice(5, 7))}/1` : Number(key.slice(8))}</strong><small>${count ? `${count}건` : '·'}</small></button>`;
  }).join('');
  strip.scrollLeft = previousScroll;
  const button = strip.querySelector(`[data-date="${target}"]`);
  if (button) {
    const bounds = strip.getBoundingClientRect(), rect = button.getBoundingClientRect();
    if ((filter.range === 'upcoming' && previousTarget !== target) || rect.left < bounds.left || rect.right > bounds.right) strip.scrollLeft += rect.left - bounds.left;
  }
  updateStripMonth();
}

function updateStripMonth() {
  const strip = $('#dateStrip'), left = strip.getBoundingClientRect().left;
  const first = [...strip.children].find(button => button.getBoundingClientRect().right > left + 1);
  if (first) {
    strip.dataset.visible = first.dataset.date;
    $('#datePickerLabel').textContent = `${first.dataset.date.slice(0, 4)}년 ${Number(first.dataset.date.slice(5, 7))}월`;
  }
}

function renderSources() {
  const sports = state.view === 'sports', filter = options();
  const list = Model.filter(sourceItems(), { ...filter, vendor: '', team: '', status: 'all' });
  const sources = sports ? Model.TEAMS : Object.entries(VN).map(([id, name]) => ({ id, name }));
  const active = sports ? filter.team : filter.vendor;
  const symbol = source => `<img class="source-logo" src="assets/logos/${sports ? 'team-' : ''}${source.id}.png" alt="" width="28" height="28">`;
  $('#sourceTitle').textContent = sports ? '홈 구단' : '예매처';
  $('#sourceFilters').innerHTML = `<button class="source-filter" data-source="" aria-pressed="${!active}" aria-label="${sports ? '전체 구단' : '전체 예매처'}"><span class="source-all" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></span><span class="source-name">${sports ? '전체 구단' : '전체 예매처'}</span><span class="source-short" aria-hidden="true">전체</span><span class="count">${list.length}</span></button>` + sources.map(source => {
    const count = list.filter(item => (sports ? item.teamId : item.siteId) === source.id).length;
    return `<button class="source-filter" data-source="${source.id}" aria-pressed="${active === source.id}" aria-label="${source.name}">${symbol(source)}<span class="source-name">${source.name}</span><span class="source-short" aria-hidden="true">${source.shortName || source.name}</span><span class="count">${count}</span></button>`;
  }).join('');
  $('#sourceNote').innerHTML = sports
    ? `<strong>가까운 예매 오픈부터</strong>홈 구단의 티켓 오픈 시간순입니다. 경기 일시는 각 일정 아래에서 확인하세요.${active ? `<br><a href="https://m.ticketlink.co.kr/sports/137/${active}" target="_blank" rel="noopener noreferrer">구단 페이지 열기 ↗</a>` : ''}`
    : '<strong>티켓이 열리는 날 기준</strong>공연일이 아닌 예매 오픈일입니다. 정확한 판매 조건은 예매처의 공지를 확인하세요.';
}

function renderNotices() {
  const notices = [];
  const sports = state.view === 'sports';
  const generatedAt = sports ? state.sports.generatedAt : state.generatedAt;
  if (!generatedAt) notices.push(sports ? '스포츠 일정을 아직 수집하지 않았습니다.' : '수집된 일정이 없습니다. 새로고침으로 일정을 가져오세요.');
  else if (Date.now() - Date.parse(generatedAt) > 12 * 3600000) notices.push(`마지막 수집 ${stamp(generatedAt)}. 최신 일정과 다를 수 있습니다.`);
  if (sports) {
    const failures = Model.TEAMS.filter(team => (!options().team || options().team === team.id) && state.sports.teamStatus?.[team.id]?.ok === false);
    if (failures.length) notices.push(`${failures.map(team => team.name).join(', ')} 조회 실패. 이전 자료가 있으면 유지하며, 경기 없음으로 처리하지 않습니다.`);
  } else {
    const failures = Object.entries(state.siteStatus).filter(([id, value]) => (!options().vendor || options().vendor === id) && (!value.ok || value.fallback));
    if (failures.length) notices.push(`${failures.map(([id]) => VN[id] || id).join(', ')} 최신 조회를 확인하지 못해 이전 자료를 표시합니다.`);
  }
  $('#dataNotice').hidden = !notices.length;
  $('#dataNotice').textContent = notices.join(' ');
  $('#updatedAt').textContent = `${stamp(generatedAt)} 수집`;
  $('#updatedAt').title = generatedAt ? `${new Date(generatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST` : '';
}

function emptyMarkup(alarm = false) {
  if (alarm) return `<div class="empty-state"><span class="empty-icon">${BELL_ICON}</span><h3>등록한 오픈 알림이 없습니다</h3><p>일정 옆 종 버튼을 누르면 오픈 10·5·3·1분 전과 정각에 알려드립니다.</p><button class="button" data-view="home">일정 찾아보기</button></div>`;
  const filter = options();
  const next = Model.filter(sourceItems(), { ...filter, range: 'all' }).find(item => (filter.basis === 'game' ? item.gameDate : item.openDate) > filter.date);
  const nextDate = state.view === 'home' && next?.openDate;
  const teamFailed = state.view === 'sports' && Model.TEAMS.some(team => (!filter.team || filter.team === team.id) && state.sports.teamStatus?.[team.id]?.ok === false);
  return `<div class="empty-state"><span class="empty-icon">${CALENDAR_ICON}</span><h3>${teamFailed ? '경기 일정을 확인하지 못했습니다' : '선택한 조건의 일정이 없습니다'}</h3><p>${teamFailed ? '조회 실패한 구단이 있습니다. 새로고침하거나 구단 페이지를 확인하세요.' : `${filter.range === 'day' ? fullDate(filter.date) + ' · ' : ''}${state.view === 'sports' ? '구단·예매 상태' : '예매처·오픈일'}를 바꿔 확인해 보세요.`}</p>${nextDate ? `<button class="button" data-date="${nextDate}">다음 일정 · ${shortDate(nextDate)} 보기 →</button>` : '<button class="button" data-reset>필터 초기화</button>'}</div>`;
}

function groupedRows(items, basis) {
  const groups = new Map();
  items.forEach(item => {
    const key = (basis === 'game' ? item.gameDate : item.openDate) || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return [...groups].map(([key, rows]) => `<section><div class="group-heading"><strong>${fullDate(key)}</strong><span>${basis === 'game' ? '경기' : '예매 오픈'} ${rows.length}건</span></div>${rows.map(item => item.category === 'sports' ? sportsRow(item) : concertRow(item)).join('')}</section>`).join('');
}

function renderResults() {
  if (state.view === 'alarm') return renderAlarms();
  const filter = options(), sports = state.view === 'sports';
  const base = Model.filter(sourceItems(), { ...filter, status: 'all' });
  const list = Model.filter(sourceItems(), filter);
  const availableStatuses = new Set(base.map(item => Model.status(item).id));
  $('#statusFilters').hidden = availableStatuses.size <= 1 && (filter.status === 'all' || availableStatuses.has(filter.status));
  const labels = sports ? [['all', '전체'], ['scheduled', '오픈 예정'], ['open', '예매 중'], ['presale', '선예매'], ['closed', '종료·매진'], ['unknown', '확인 필요']]
    : [['all', '전체'], ['scheduled', '오픈 예정'], ['unknown', '시간 미정']];
  $('#statusFilters').innerHTML = labels.filter(([id]) => !['presale', 'closed', 'unknown'].includes(id) || base.some(item => Model.status(item).id === id) || filter.status === id).map(([id, label]) => `<button data-status="${id}" aria-pressed="${filter.status === id}">${label}<b>${id === 'all' ? base.length : base.filter(item => Model.status(item).id === id).length}</b></button>`).join('');
  $('#resultTitle').textContent = filter.range === 'upcoming' ? '다가오는 오픈' : fullDate(filter.date);
  $('#resultCount').textContent = `${list.length}건`;
  $('#results').dataset.layout = filter.range;
  $('#results').innerHTML = list.length ? groupedRows(list, filter.basis) : emptyMarkup();
  $('#listTotal').textContent = `오픈 ${list.length}건`;
  $('#listHint').textContent = sports ? '일반 예매 오픈순 · 지난 오픈 제외 · KST' : '공연일이 아닌 티켓 오픈일 기준 · KST';
  renderNotices();
}

function render() {
  document.body.dataset.view = state.view;
  const sports = state.view === 'sports', alarm = state.view === 'alarm';
  document.querySelectorAll('.main-nav [data-view]').forEach(button => {
    if (button.dataset.view === state.view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $('#pageTitle').textContent = alarm ? '내 오픈 알림' : sports ? '야구 티켓 일정' : '티켓 오픈 일정';
  $('#eyebrow').textContent = alarm ? 'MY REMINDERS' : sports ? 'KBO · TICKET OPENING' : 'TICKET OPENING';
  $('#pageDescription').textContent = alarm ? '기다리는 티켓의 오픈을 놓치지 않도록.' : sports ? '응원하는 팀의 티켓, 가까운 오픈부터.' : '원하는 날짜, 원하는 예매처의 오픈을 한눈에.';
  document.title = `티켓 오픈 · ${alarm ? '내 알림' : sports ? '스포츠' : '일정'}`;
  $('#scheduleWorkspace').hidden = alarm;
  $('#alarmWorkspace').hidden = !alarm;
  updateAlarmBadge();
  if (alarm) { renderAlarms(); return; }
  const filter = options();
  if (filter.date < Model.dateKey()) { filter.date = Model.dateKey(); if (!sports && filter.range === 'day') filter.autoDate = true; }
  if (!sports && filter.autoDate) {
    filter.date = Model.filter(sourceItems(), { ...filter, range: 'all' }).find(item => item.openDate)?.openDate || Model.dateKey();
    state.month = filter.date.slice(0, 7);
  }
  $('#selectedDate').value = filter.range === 'upcoming' ? '' : filter.date;
  $('#selectedDate').min = Model.dateKey();
  $('#searchInput').value = filter.query;
  $('#searchInput').placeholder = sports ? '팀·구장 검색' : '공연명 검색';
  $('.calendar-panel').hidden = sports;
  $('.date-browser').hidden = sports;
  document.querySelectorAll('[data-range]').forEach(button => button.setAttribute('aria-pressed', button.dataset.range === filter.range));
  renderCalendar(); renderSources(); renderDateStrip(); renderResults();
}

function selectDate(date) {
  if (state.view !== 'home') return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  if (date < Model.dateKey()) { render(); return; }
  const fromStrip = $('#dateStrip').contains(document.activeElement);
  options().date = date; options().range = 'day'; options().autoDate = false; state.month = date.slice(0, 7); render();
  if (fromStrip) $(`#dateStrip [data-date="${date}"]`)?.focus({ preventScroll: true });
  if ($('#dateDialog').open) $('#dateDialog').close();
}
function resetFilters() { state.filters[state.view] = defaults(state.view); state.month = Model.dateKey().slice(0, 7); render(); }
function setView(view) {
  if (!['home', 'sports', 'alarm'].includes(view)) return;
  state.view = view;
  if (view !== 'alarm') state.month = options().date.slice(0, 7);
  render();
}
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if ('view' in button.dataset) setView(button.dataset.view);
  else if ('source' in button.dataset) { options()[state.view === 'sports' ? 'team' : 'vendor'] = button.dataset.source; render(); }
  else if ('date' in button.dataset) selectDate(button.dataset.date);
  else if ('range' in button.dataset) { options().range = button.dataset.range; options().autoDate = false; if (button.dataset.range === 'upcoming') options().date = Model.dateKey(); render(); }
  else if ('status' in button.dataset) { options().status = button.dataset.status; render(); }
  else if ('alarm' in button.dataset) toggleAlarm(button.dataset.alarm);
  else if ('reset' in button.dataset || button.id === 'resetFilters') resetFilters();
  else if ('close' in button.dataset) document.getElementById(button.dataset.close).close();
  else if (button.id === 'clearBtn') { try { localStorage.removeItem(DATA_KEY); localStorage.removeItem(STORAGE_KEY); } catch {} state.items = []; state.sports = { items: [], teamStatus: {} }; state.generatedAt = null; loadStatic().then(() => { render(); renderSettings(); }); }
});
function renderSubscription() {
  const feed = CalendarSubscriptions.feeds.find(feed => feed.id === $('#calendarFeed').value);
  const base = IS_STATIC ? location.href : 'https://hky5820.github.io/TicketOpenChecker/';
  const url = CalendarSubscriptions.feedUrl(feed, base);
  $('#subscriptionUrl').value = url;
  $('#appleSubscribeLink').href = url.replace(/^https?:/, 'webcal:');
  $('#subscriptionSummary').textContent = feed.category === 'sports'
    ? `${feed.name} · 홈경기 일반 예매 오픈 시간 기준`
    : `${feed.name} · 공연일이 아닌 티켓 오픈 시간 기준`;
  $('#copySubscriptionUrl').textContent = '주소 복사';
}
$('#subscribeCalendarBtn').addEventListener('click', () => {
  $('#calendarFeed').innerHTML = ['sports', 'home'].map(category => `<optgroup label="${category === 'sports' ? '스포츠 · 홈경기' : '공연·전시'}">${CalendarSubscriptions.feeds.filter(feed => feed.category === category).map(feed => `<option value="${feed.id}">${feed.name}</option>`).join('')}</optgroup>`).join('');
  $('#calendarFeed').value = state.view === 'sports' ? `sports-${options().team || 'all'}` : `concert-${options().vendor || 'all'}`;
  renderSubscription(); $('#calendarSubscriptionDialog').showModal();
});
$('#calendarFeed').addEventListener('change', renderSubscription);
$('#subscriptionUrl').addEventListener('click', event => event.target.select());
$('#copySubscriptionUrl').addEventListener('click', async () => {
  const input = $('#subscriptionUrl');
  try { await navigator.clipboard.writeText(input.value); $('#copySubscriptionUrl').textContent = '복사됨'; }
  catch { input.focus(); input.select(); toast('선택된 주소를 복사해 주세요.'); }
});
$('#selectedDate').addEventListener('change', event => selectDate(event.target.value));
$('#searchInput').addEventListener('input', event => { options().query = event.target.value; render(); });
$('#dateStrip').addEventListener('scroll', updateStripMonth, { passive: true });
$('#todayBtn').addEventListener('click', () => selectDate(Model.dateKey()));
$('#datePickerBtn').addEventListener('click', () => {
  const date = options().range === 'day' ? options().date : $('#dateStrip').dataset.visible || Model.dateKey();
  state.month = date.slice(0, 7);
  $('#dateDialogBody').append($('.calendar-panel'));
  renderCalendar(); $('#dateDialog').showModal();
  ($('#calendarGrid .selected:not(:disabled)') || $(`#calendarGrid [data-date="${date}"]`) || $('#calendarGrid button:not(:disabled)'))?.focus();
});
$('#dateDialog').addEventListener('close', () => $('.sidebar').prepend($('.calendar-panel')));
for (const [id, amount] of [['monthPrev', -1], ['monthNext', 1]]) $( `#${id}`).addEventListener('click', () => {
  const [year, month] = state.month.split('-').map(Number);
  state.month = new Date(Date.UTC(year, month - 1 + amount, 1)).toISOString().slice(0, 7); renderCalendar();
});
$('#results').addEventListener('error', event => { if (event.target.tagName === 'IMG') event.target.style.visibility = 'hidden'; }, true);

let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500); }
function updateAlarmBadge() { const count = allItems().filter(item => hasAlarm(itemKey(item)) && Model.isUpcoming(item)).length; $('#alarmCount').textContent = count; $('#alarmCount').hidden = !count; }
function saveAlarms() {
  state.alarmItems = allItems().filter(item => hasAlarm(itemKey(item)));
  write(ALARM_KEY, state.alarms); write(ALARM_ITEMS_KEY, state.alarmItems);
}
function toggleAlarm(key) {
  if (hasAlarm(key)) { delete state.alarms[key]; toast('오픈 알림을 해제했습니다.'); }
  else {
    state.alarms[key] = {};
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().then(() => syncPush());
    toast('오픈 알림 등록 · 10·5·3·1분 전과 정각');
  }
  saveAlarms(); syncPush(); updateAlarmBadge(); renderResults();
}
function renderAlarms() {
  const items = allItems().filter(item => hasAlarm(itemKey(item)) && Model.isUpcoming(item)).sort((a, b) => (a.openDateTime || '').localeCompare(b.openDateTime || ''));
  $('#alarmHint').textContent = pushOk ? '오픈 10·5·3·1분 전과 정각에 알림 · 앱을 닫아도 서버에서 전달합니다.' : '오픈 10·5·3·1분 전과 정각에 알림 · 푸시 서버 연결 전에는 이 화면을 열어 두세요.';
  $('#alarmBody').innerHTML = items.length ? groupedRows(items, 'open') : emptyMarkup(true);
}

// Existing VAPID channel and local service-worker notifications remain compatible.
const PUSH_API = (() => { try { return localStorage.getItem('toc:pushApi') || ''; } catch { return ''; } })();
let pushOk = false;
async function syncPush() {
  try {
    if (IS_STATIC && !PUSH_API) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window) || Notification.permission !== 'granted') return;
    const keyResponse = await fetch(`${PUSH_API}/api/push/key`);
    if (!keyResponse.ok) return;
    const { key } = await keyResponse.json(); if (!key) return;
    const bytes = atob((key + '='.repeat((4 - key.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(bytes, value => value.charCodeAt(0)) });
    const alarms = allItems().filter(item => hasAlarm(itemKey(item)) && item.openDateTime).map(item => ({ key: itemKey(item), title: item.title, open: item.openDateTime, url: item.url }));
    const response = await fetch(`${PUSH_API}/api/push/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sub: subscription.toJSON(), alarms }) });
    pushOk = response.ok;
  } catch { pushOk = false; }
  if (state.view === 'alarm') renderAlarms();
}
async function notify(title, body, key) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) { await registration.showNotification(title, { body, icon: 'icon-192.png?v=20260929-open-icon', tag: `toc:${key}`, renotify: true, vibrate: [200, 100, 200] }); return; }
    new Notification(title, { body, tag: `toc:${key}` });
  } catch { /* Notification support depends on browser and permissions. */ }
}
function checkAlarms() {
  let expired = false;
  for (const item of allItems()) {
    const key = itemKey(item), alarm = state.alarms[key];
    if (!alarm || !item.openDateTime) continue;
    const seconds = (Date.parse(item.openDateTime) - Date.now()) / 1000;
    if (seconds < -3600) { delete state.alarms[key]; expired = true; continue; }
    if (pushOk) continue;
    for (const minutes of [10, 5, 3, 1, 0]) {
      if (seconds > minutes * 60 || alarm[`f${minutes}`]) continue;
      alarm[`f${minutes}`] = 1; saveAlarms();
      if (seconds > minutes * 60 - 60) notify(minutes ? '곧 티켓 오픈!' : '티켓 오픈!', `${item.title} — ${item.openTime} ${minutes ? `(${minutes}분 전)` : '지금 오픈'}`, key);
    }
  }
  if (expired) { saveAlarms(); updateAlarmBadge(); if (state.view === 'alarm') renderAlarms(); }
}

function applySports(next) {
  if (!next) return;
  const previous = state.sports;
  state.sports = { ...next, items: [...(next.items || [])], teamStatus: { ...next.teamStatus } };
  for (const team of Model.TEAMS) {
    if (next.teamStatus?.[team.id]?.ok !== false) continue;
    const keys = new Set(state.sports.items.map(item => item.id));
    state.sports.items.push(...(previous.items || []).filter(item => item.teamId === team.id && !keys.has(item.id)));
  }
}
function saveData() { write(STORAGE_KEY, state.items); write(DATA_KEY, { items: state.items, sports: state.sports, siteStatus: state.siteStatus, generatedAt: state.generatedAt }); saveAlarms(); }
async function loadStatic() {
  try {
    const response = await fetch(`data.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const items = Array.isArray(data) ? data : data.items;
    if (Array.isArray(items) && (!state.generatedAt || !data.generatedAt || Date.parse(data.generatedAt) >= Date.parse(state.generatedAt))) {
      state.items = items; state.generatedAt = data.generatedAt || null;
      state.siteStatus = data.siteStatus || {};
    }
    if (data.sports && (!state.sports.generatedAt || Date.parse(data.sports.generatedAt) >= Date.parse(state.sports.generatedAt))) applySports(data.sports);
    saveData(); return true;
  } catch { return false; }
}
function showLoad(message, error = false) { $('#loadStatus').hidden = false; $('#loadStatus').textContent = message; $('#loadStatus').classList.toggle('error', error); }
$('#reloadBtn').addEventListener('click', async () => {
  if (state.loading) return;
  state.loading = true; $('#reloadBtn').disabled = true; $('#reloadBtn span').textContent = '불러오는 중';
  const finish = () => { state.loading = false; $('#reloadBtn').disabled = false; $('#reloadBtn span').textContent = '새로고침'; render(); syncPush(); };
  if (IS_STATIC) {
    const ok = await loadStatic();
    showLoad(ok ? '배포된 최신 자료를 확인했습니다. 자동 수집: 매일 09·12·15·18·21시 17분.' : '자료를 불러오지 못했습니다. 저장된 자료를 표시합니다.', !ok);
    finish(); return;
  }
  if (state.view === 'sports') {
    showLoad('5개 구단의 경기와 티켓 오픈을 확인하는 중입니다.');
    try {
      const response = await fetch('/api/sports', { signal: AbortSignal.timeout(210000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      applySports(await response.json()); saveData();
      const failures = Object.values(state.sports.teamStatus).filter(status => !status.ok).length;
      showLoad(failures ? `${failures}개 구단 조회 실패. 이전 자료를 유지합니다.` : `5개 구단 · ${state.sports.items.length}경기 확인했습니다.`, !!failures);
    } catch { showLoad('스포츠 조회에 실패했습니다. 저장된 자료를 유지합니다.', true); }
    finish(); return;
  }
  showLoad('예매처의 최신 오픈 일정을 수집하는 중입니다.');
  const source = new EventSource('/api/load');
  const collected = new Map(), successful = new Set(), errors = [];
  const finishStream = () => { source.close(); clearTimeout(timer); finish(); };
  const timer = setTimeout(() => { showLoad('수집 시간이 초과되었습니다. 기존 자료를 유지합니다.', true); finishStream(); }, 240000);
  source.addEventListener('status', event => { const payload = JSON.parse(event.data); state.statuses[payload.site] = payload.message; showLoad(Object.entries(state.statuses).filter(([key]) => key !== 'system').map(([key, value]) => `${VN[key] || '스포츠'}: ${value}`).join(' · ') || payload.message); });
  source.addEventListener('items', event => { for (const item of JSON.parse(event.data).items) collected.set(itemKey(item), item); });
  source.addEventListener('siteDone', event => successful.add(JSON.parse(event.data).site));
  source.addEventListener('siteError', event => { const payload = JSON.parse(event.data); errors.push(VN[payload.site] || payload.site); });
  source.addEventListener('sports', event => { applySports(JSON.parse(event.data)); saveData(); });
  source.addEventListener('done', event => {
    const payload = JSON.parse(event.data);
    for (const item of payload.items || []) collected.set(itemKey(item), item);
    state.items = [...state.items.filter(item => !successful.has(item.siteId)), ...collected.values()];
    state.generatedAt = payload.loadedAt; state.siteStatus = payload.siteStatus || {};
    applySports(payload.sports); saveData();
    showLoad(errors.length ? `${errors.join(', ')} 조회 실패. 해당 예매처의 이전 자료를 유지합니다.` : `${state.items.length}개 오픈 일정을 확인했습니다.`, !!errors.length);
    finishStream();
  });
  source.addEventListener('fatal', () => { showLoad('수집을 완료하지 못했습니다. 기존 자료를 유지합니다.', true); finishStream(); });
  source.onerror = () => { showLoad('수집 연결이 끊겼거나 다른 수집이 진행 중입니다. 기존 자료를 유지합니다.', true); finishStream(); };
});

function renderSettings() {
  const permissions = !('Notification' in window) ? '브라우저 미지원' : ({ granted: '허용됨', denied: '차단됨', default: '아직 허용하지 않음' })[Notification.permission];
  const rows = [['공연 일정 수집', stamp(state.generatedAt)], ['공연 일정', `${state.items.length}건`], ['스포츠 수집', stamp(state.sports.generatedAt)], ['알림 권한', permissions], ['백그라운드 푸시', pushOk ? '연결됨' : '연결 안 됨']];
  $('#settingsBody').innerHTML = rows.map(([label, value]) => `<div class="settings-row"><span>${label}</span><strong>${esc(value)}</strong></div>`).join('') + Model.TEAMS.map(team => {
    const status = state.sports.teamStatus?.[team.id];
    return `<div class="settings-row"><span>${team.name}</span><strong>${status ? status.ok ? `${status.count}경기 · ${stamp(status.checkedAt)}` : '조회 실패 · 이전 자료 유지' : '수집 전'}</strong></div>`;
  }).join('') + `<p class="settings-note">${IS_STATIC ? '자동 수집: 매일 09:17·12:17·15:17·18:17·21:17 (한국 시각). 새로고침은 배포된 자료를 다시 불러옵니다.' : '새로고침으로 예매처에서 일정을 직접 수집합니다.'}<br>푸시 서버 연결 전에는 화면을 열어 두어야 알림이 동작합니다.</p><div class="settings-row"><span>저장된 일정 다시 받기</span><button id="clearBtn" class="button">캐시 초기화</button></div>`;
}
$('#settingsBtn').addEventListener('click', () => { renderSettings(); $('#settingsDialog').showModal(); });
$('#settingsDialog').addEventListener('click', event => { if (event.target === $('#settingsDialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

(async function init() {
  const saved = read(DATA_KEY, null), legacy = read(STORAGE_KEY, []);
  if (saved && Array.isArray(saved.items)) { state.items = saved.items; state.generatedAt = saved.generatedAt; state.siteStatus = saved.siteStatus || {}; if (saved.sports) state.sports = saved.sports; }
  else if (Array.isArray(legacy)) state.items = legacy;
  saveAlarms();
  await loadStatic(); render(); lastStatusSignature = visibilitySignature();
  if (Object.keys(state.alarms).length) syncPush();
})();
let lastStatusSignature = '';
function visibilitySignature() { return Model.dateKey() + allItems().map(item => `${Model.status(item).id}:${Model.isUpcoming(item)}:${Model.isUpcoming(item, 'game')}`).join('|'); }
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); lastStatusSignature = visibilitySignature(); } });
setInterval(() => {
  document.querySelectorAll('[data-countdown]').forEach(element => { element.textContent = countdown(element.dataset.countdown); });
  checkAlarms();
  const signature = visibilitySignature();
  if (signature !== lastStatusSignature) render();
  lastStatusSignature = signature;
}, 1000);
