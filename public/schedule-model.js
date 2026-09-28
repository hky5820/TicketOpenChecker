(function (root) {
  const TEAMS = [
    { id: '59', name: 'LG 트윈스', shortName: 'LG', color: '#a50034' },
    { id: '63', name: '한화 이글스', shortName: '한화', color: '#d64b00' },
    { id: '57', name: '삼성 라이온즈', shortName: '삼성', color: '#125aa5' },
    { id: '62', name: 'KT Wiz', shortName: 'KT', color: '#292b33' },
    { id: '58', name: 'KIA 타이거즈', shortName: 'KIA', color: '#bc2433' },
  ];
  const dateKey = (date = new Date()) => new Date(new Date(date).getTime() + 9 * 3600000).toISOString().slice(0, 10);
  const addDays = (key, days) => new Date(new Date(`${key}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
  const itemKey = item => item.category === 'sports' ? item.id : `${item.siteId}|${item.title}|${item.openDateTime || item.openDate || ''}`;
  function status(item, now = Date.now()) {
    if (item.category === 'sports') {
      const value = String(item.saleStatus || 'UNKNOWN');
      if (/CANCEL/.test(value)) return { id: 'closed', label: '경기 취소', tone: 'muted' };
      if (/SOLD_OUT|SOLDOUT/.test(value)) return { id: 'closed', label: '매진', tone: 'muted' };
      if (/CLOSE|END|FINISH/.test(value) || (item.closeDateTime && Date.parse(item.closeDateTime) <= now)) return { id: 'closed', label: '예매 종료', tone: 'muted' };
      if (value === 'ON_SALE') return { id: 'open', label: '예매 중', tone: 'green' };
      if (/PRE.*SALE/.test(value)) return { id: 'presale', label: '선예매', tone: 'amber' };
      if (value === 'BEFORE' && item.openDateTime && Date.parse(item.openDateTime) > now) return { id: 'scheduled', label: '오픈 예정', tone: 'blue' };
      if (value === 'BEFORE' && !item.openDateTime) return { id: 'unknown', label: '오픈 미정', tone: 'muted' };
      return { id: 'unknown', label: '상태 확인 필요', tone: 'amber' };
    }
    if (!item.openDateTime) return { id: 'unknown', label: '시간 미정', tone: 'muted' };
    return Date.parse(item.openDateTime) > now
      ? { id: 'scheduled', label: '오픈 예정', tone: 'blue' }
      : { id: 'open', label: '오픈 시각 지남', tone: 'green' };
  }
  function isUpcoming(item, basis = 'open', now = Date.now()) {
    const pending = (timestamp, day) => timestamp ? Date.parse(timestamp) >= now : !day || day >= dateKey(now);
    if (item.category === 'sports' && !pending(item.gameDateTime, item.gameDate)) return false;
    return basis === 'game' ? pending(item.gameDateTime, item.gameDate) : pending(item.openDateTime, item.openDate);
  }
  function filter(items, options, now = Date.now()) {
    const { vendor, team, query = '', range = 'day', date, basis = 'open', status: selectedStatus = 'all' } = options;
    const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return items.filter(item => {
      if (!isUpcoming(item, basis, now)) return false;
      if (vendor && item.siteId !== vendor) return false;
      if (team && item.teamId !== team) return false;
      const text = `${item.title} ${item.homeTeam || ''} ${item.awayTeam || ''} ${item.venue || ''}`.toLocaleLowerCase();
      if (!words.every(word => text.includes(word))) return false;
      const key = basis === 'game' ? item.gameDate : item.openDate;
      if (range === 'day' && key !== date) return false;
      if (range === 'week' && (!key || key < date || key > addDays(date, 6))) return false;
      return selectedStatus === 'all' || status(item, now).id === selectedStatus;
    }).sort((a, b) => {
      const aTime = basis === 'game' ? a.gameDateTime : a.openDateTime;
      const bTime = basis === 'game' ? b.gameDateTime : b.openDateTime;
      if (!!aTime !== !!bTime) return aTime ? -1 : 1;
      const left = (basis === 'game' ? a.gameDateTime : a.openDateTime || a.openDate) || '9999';
      const right = (basis === 'game' ? b.gameDateTime : b.openDateTime || b.openDate) || '9999';
      return left.localeCompare(right) || (a.gameDateTime || '').localeCompare(b.gameDateTime || '') || a.title.localeCompare(b.title, 'ko');
    });
  }
  const api = { TEAMS, dateKey, addDays, itemKey, status, isUpcoming, filter };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScheduleModel = api;
})(typeof window === 'undefined' ? globalThis : window);
