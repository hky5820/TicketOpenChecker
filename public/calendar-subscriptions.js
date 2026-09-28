(function (root) {
  const Model = typeof module !== 'undefined' && module.exports ? require('./schedule-model') : root.ScheduleModel;
  const feeds = [
    { id: 'concert-all', name: '공연·전시 전체', category: 'home' },
    ...Object.entries({ interpark: 'NOL 티켓', melon: '멜론 티켓', ticketlink: '티켓링크' }).map(([siteId, name]) => ({ id: `concert-${siteId}`, name, category: 'home', siteId })),
    { id: 'sports-all', name: 'KBO 5개 구단 전체', category: 'sports' },
    ...Model.TEAMS.map(team => ({ id: `sports-${team.id}`, name: team.name, category: 'sports', teamId: team.id })),
  ];
  const feedUrl = (feed, base) => new URL(`calendars/${feed.id}.ics`, base).href;
  const api = { feeds, feedUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CalendarSubscriptions = api;
})(typeof window === 'undefined' ? globalThis : window);
