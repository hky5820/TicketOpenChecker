const { launchTicketlinkBrowser } = require('./ticketlink-browser');

const TEAMS = [
  { id: '59', name: 'LG 트윈스', shortName: 'LG', color: '#a50034' },
  { id: '63', name: '한화 이글스', shortName: '한화', color: '#d64b00' },
  { id: '57', name: '삼성 라이온즈', shortName: '삼성', color: '#125aa5' },
  { id: '62', name: 'KT Wiz', shortName: 'KT', color: '#292b33' },
  { id: '58', name: 'KIA 타이거즈', shortName: 'KIA', color: '#bc2433' },
].map(team => ({ ...team, url: `https://m.ticketlink.co.kr/sports/137/${team.id}` }));

function kstDateTime(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 19) + '+09:00';
}

function normalizeSchedules(schedules, team, checkedAt) {
  const items = new Map();
  for (const schedule of schedules) {
    // A team's ticket page sells home games only. Never infer ownership from a name.
    if (String(schedule.homeTeam?.teamId) !== team.id) continue;
    const gameDateTime = kstDateTime(schedule.scheduleDate);
    if (!schedule.scheduleId || !gameDateTime) throw new Error('경기 ID 또는 경기일을 확인하지 못했습니다.');
    const openDateTime = kstDateTime(schedule.reserveOpenDate ?? schedule.reserveOpenDateTime);
    const preOpenDateTime = kstDateTime(schedule.reservePreOpenDateTime);
    const away = schedule.awayTeam || {};
    const home = schedule.homeTeam;
    const https = value => String(value || '').replace(/^http:/, 'https:');
    items.set(String(schedule.scheduleId), {
      id: `ticketlink-sports-${schedule.scheduleId}`, category: 'sports',
      site: '티켓링크', siteId: 'ticketlink', teamId: team.id,
      scheduleId: String(schedule.scheduleId), productId: schedule.productId || null,
      title: `${away.teamShortName || away.teamName || '상대 미정'} vs ${home.teamShortName || team.shortName}`,
      homeTeam: team.name, awayTeam: away.teamName || away.teamShortName || '상대 미정',
      homeShortName: home.teamShortName || team.shortName, awayShortName: away.teamShortName || away.teamName || '미정',
      homeLogo: https(home.logoImagePath), awayLogo: https(away.logoImagePath),
      venue: schedule.venueName || '', gameDateTime,
      gameDate: gameDateTime.slice(0, 10), gameTime: gameDateTime.slice(11, 16),
      openDateTime, openDate: openDateTime?.slice(0, 10) || null, openTime: openDateTime?.slice(11, 16) || null,
      preOpenDateTime: preOpenDateTime !== openDateTime ? preOpenDateTime : null,
      closeDateTime: kstDateTime(schedule.reserveCloseDate),
      saleStatus: schedule.reserveButtonStatus || schedule.saleStatus || 'UNKNOWN',
      url: team.url, checkedAt,
    });
  }
  return [...items.values()].sort((a, b) => a.gameDateTime.localeCompare(b.gameDateTime));
}

// Same bounded React parent walk used by mycode's parseGameList. Read only:
// the mobile app has already decoded the schedules response at this point.
function readRenderedSchedules() {
  const schedules = new Map();
  for (const element of document.querySelectorAll('button, a, li')) {
    const key = Object.keys(element).find(name => name.startsWith('__reactFiber$'));
    let fiber = key && element[key];
    for (let depth = 0; fiber && depth < 18; depth += 1, fiber = fiber.return) {
      const match = fiber.memoizedProps?.scheduleMatch;
      if (!match?.scheduleId) continue;
      const team = value => value && ({ teamId: value.teamId, teamName: value.teamName, teamShortName: value.teamShortName, logoImagePath: value.logoImagePath });
      schedules.set(match.scheduleId, {
        scheduleId: match.scheduleId, productId: match.productId,
        homeTeam: team(match.homeTeam), awayTeam: team(match.awayTeam),
        scheduleDate: match.scheduleDate, venueName: match.venueName,
        reserveOpenDate: match.reserveOpenDate, reserveOpenDateTime: match.reserveOpenDateTime,
        reservePreOpenDateTime: match.reservePreOpenDateTime, reserveCloseDate: match.reserveCloseDate,
        reserveButtonStatus: match.reserveButtonStatus, saleStatus: match.saleStatus,
      });
      break;
    }
  }
  return [...schedules.values()];
}

let collecting;
function collectSports(progress = () => {}) {
  if (!collecting) collecting = runCollection(progress).finally(() => { collecting = null; });
  return collecting;
}

async function runCollection(progress) {
  const result = { teams: TEAMS, items: [], teamStatus: {}, generatedAt: new Date().toISOString() };
  let context;
  try {
    const launched = await launchTicketlinkBrowser();
    context = launched.context;
    const page = launched.page;
    await page.route('**/*', route => ['image', 'media', 'font'].includes(route.request().resourceType())
      ? route.abort() : route.continue());
    for (const team of TEAMS) {
      progress(`${team.name} 경기 조회 중`);
      try {
        let apiSchedules = null;
        const capture = async response => {
          if (!response.url().includes('/mapi/sports/schedules')) return;
          try {
            const payload = await response.json();
            if (payload.success !== false && Array.isArray(payload.data?.schedules)) apiSchedules = payload.data.schedules;
          } catch { /* encrypted responses are read from rendered scheduleMatch props */ }
        };
        page.on('response', capture);
        try {
          await page.goto(team.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
          await page.waitForFunction(() => {
            for (const el of document.querySelectorAll('button, a, li')) {
              const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
              let fiber = key && el[key];
              for (let d = 0; fiber && d < 18; d++, fiber = fiber.return) {
                if (fiber.memoizedProps?.scheduleMatch?.scheduleId) return true;
              }
            }
            return document.body.innerText.includes('현재 예정된 경기가 없어요');
          }, null, { timeout: 15000 });
          const rendered = await page.evaluate(readRenderedSchedules);
          const raw = rendered.length ? rendered : apiSchedules;
          const empty = await page.getByText('현재 예정된 경기가 없어요', { exact: true }).isVisible();
          if (!raw?.length && !empty) throw new Error('경기 목록을 확인하지 못했습니다.');
          const checkedAt = new Date().toISOString();
          const items = normalizeSchedules(raw || [], team, checkedAt);
          if (raw?.length && !items.length) throw new Error('홈팀 ID가 조회한 구단과 다릅니다.');
          result.items.push(...items);
          result.teamStatus[team.id] = { ok: true, count: items.length, checkedAt };
          progress(`${team.name} ${items.length}경기 확인`);
        } finally { page.off('response', capture); }
      } catch (error) {
        result.teamStatus[team.id] = { ok: false, error: error.message, checkedAt: new Date().toISOString() };
        progress(`${team.name} 조회 실패`);
      }
    }
  } catch (error) {
    for (const team of TEAMS) result.teamStatus[team.id] = { ok: false, error: error.message, checkedAt: new Date().toISOString() };
  } finally { await context?.close().catch(() => {}); }
  result.generatedAt = new Date().toISOString();
  return result;
}

function mergeSports(current, previous) {
  if (!current) return previous || { teams: TEAMS, items: [], teamStatus: {} };
  const result = { ...current, items: [...current.items], teamStatus: { ...current.teamStatus } };
  for (const team of TEAMS) {
    if (current.teamStatus[team.id]?.ok) continue;
    const saved = (previous?.items || []).filter(item => item.teamId === team.id);
    result.items.push(...saved);
    result.teamStatus[team.id] = { ...current.teamStatus[team.id], stale: saved.length > 0,
      lastSuccessAt: previous?.teamStatus?.[team.id]?.lastSuccessAt || (previous?.teamStatus?.[team.id]?.ok ? previous.teamStatus[team.id].checkedAt : null) };
  }
  return result;
}

module.exports = { TEAMS, collectSports, normalizeSchedules, kstDateTime, mergeSports, readRenderedSchedules };
