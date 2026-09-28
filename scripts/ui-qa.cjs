const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { default: AxeBuilder } = require('@axe-core/playwright');
const { TEAMS } = require('../public/schedule-model');

const root = path.resolve(__dirname, '../public');
const output = path.resolve(__dirname, '../output/ui-qa');
const fixedNow = new Date('2026-09-28T10:00:00Z');
const concert = (siteId, title, date, time) => ({ siteId, title, site: siteId, openDate: date, openTime: time, openDateTime: time ? `${date}T${time}:00+09:00` : null, url: 'https://example.com/notice' });
const fixture = {
  generatedAt: fixedNow.toISOString(),
  items: [concert('melon', '지난날 공지', '2026-09-27', '20:00'), concert('ticketlink', '오늘 지난 오픈', '2026-09-28', '18:00'), concert('melon', '테스트 콘서트', '2026-09-29', '20:00'), concert('interpark', '테스트 연극', '2026-09-29', '14:00'), concert('ticketlink', '테스트 전시', '2026-09-30', '10:00')],
  sports: { generatedAt: fixedNow.toISOString(), teamStatus: Object.fromEntries(TEAMS.map(team => [team.id, { ok: true, count: 3, checkedAt: fixedNow.toISOString() }])),
    items: TEAMS.flatMap(team => [0, 1, 2].map(index => ({
      id: `sports-${team.id}-${index}`, category: 'sports', siteId: 'ticketlink', site: '티켓링크', teamId: team.id,
      title: `상대 vs ${team.shortName}`, homeTeam: team.name, homeShortName: team.shortName, awayTeam: '상대 구단', awayShortName: '상대', venue: '테스트 야구장',
      gameDate: `2026-10-0${index === 1 ? 6 : 3 + index}`, gameTime: '14:00', gameDateTime: `2026-10-0${index === 1 ? 6 : 3 + index}T14:00:00+09:00`,
      openDate: index === 2 ? '2026-09-30' : index ? '2026-09-29' : '2026-09-27', openTime: '11:00', openDateTime: `2026-09-${index === 2 ? '30' : index ? '29' : '27'}T11:00:00+09:00`,
      saleStatus: index === 2 ? 'PRE_ON_SALE' : index ? 'BEFORE' : 'ON_SALE', url: `https://m.ticketlink.co.kr/sports/137/${team.id}`, checkedAt: fixedNow.toISOString(),
    }))) },
};

async function main() {
  await fs.mkdir(output, { recursive: true });
  const server = http.createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!filename.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
    try { response.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' }); response.end(await fs.readFile(filename)); }
    catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [], checks = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Seoul', reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const check = (name, result) => { assert.ok(result, name); checks.push(name); };
  const waitCount = async (selector, count) => page.waitForFunction(({ selector, count }) => [...document.querySelectorAll(selector)].filter(element => element.getClientRects().length).length === count, { selector, count });
  const checkScrollDates = async (target, width) => {
    const scrollFixture = {
      ...fixture,
      items: ['2026-09-29', '2026-09-30'].flatMap(date => Array.from({ length: 12 }, (_, i) => concert('melon', `스크롤 확인 공연 ${date} ${i + 1}`, date, '20:00'))),
      sports: { ...fixture.sports, items: fixture.sports.items.filter(item => item.openDate >= '2026-09-29').flatMap(item => Array.from({ length: 3 }, (_, i) => ({ ...item, id: `${item.id}-${i}` }))) },
    };
    await target.route('**/data.json*', route => route.fulfill({ json: scrollFixture }));
    await target.clock.setFixedTime(fixedNow);
    await target.evaluate(() => localStorage.clear()); await target.reload();
    await target.waitForFunction(() => document.querySelectorAll('#results .ticket-row').length === 12);
    await target.evaluate(() => document.fonts.ready);
    const scrollSection = async index => target.locator('#results > section').nth(index).evaluate(section => scrollTo(0, scrollY + section.getBoundingClientRect().top + 150));
    const pinned = async (heading, date) => heading.evaluate((element, date) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return Math.abs(rect.top) < 1 && element.contains(hit) && element.textContent.includes(date);
    }, date);
    await scrollSection(0);
    check(`concert ${width}px selected date stays visible above rows`, await pinned(target.locator('.results-heading'), '9월 29일'));
    await target.screenshot({ path: path.join(output, `pinned-home-${width}.png`), scale: 'css' });
    await target.locator('#dateStrip [data-date="2026-09-30"]').click();
    await scrollSection(0);
    check(`concert ${width}px pinned date follows selection`, await pinned(target.locator('.results-heading'), '9월 30일'));
    for (const view of ['home', 'sports']) {
      if (view === 'home') await target.locator('[data-range="upcoming"]').click();
      else await target.locator('#tab-sports').click();
      const headings = target.locator('#results .group-heading');
      for (const index of [0, 1, 0]) {
        await scrollSection(index);
        check(`${view} ${width}px scrolling to group ${index} pins its opening date`, await pinned(headings.nth(index), `9월 ${29 + index}일`));
      }
      await target.locator('#results > section').nth(1).evaluate(section => scrollTo(0, scrollY + section.getBoundingClientRect().top - 20));
      const outgoing = await headings.nth(0).boundingBox(), incoming = await headings.nth(1).boundingBox();
      check(`${view} ${width}px adjacent date headings do not overlap`, Math.abs(incoming.y - 20) < 1 && outgoing.y + outgoing.height <= incoming.y + 1);
      await scrollSection(1);
      await target.screenshot({ path: path.join(output, `pinned-${view === 'home' ? 'upcoming' : 'sports'}-${width}.png`), scale: 'css' });
      check(`${view} ${width}px date bar creates no horizontal overflow`, await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    check(`sports ${width}px retains opening context without date controls`, (await target.locator('#results .group-heading').last().innerText()).includes('예매 오픈') && await target.locator('.date-browser').isHidden());
  };
  const checkSubscriptions = async (target, width, audits) => {
    await target.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await target.locator('#tab-sports').click();
    await target.locator('[data-source="59"]').click();
    await target.locator('#subscribeCalendarBtn').click();
    check(`subscription ${width}px defaults to selected home team`, await target.locator('#calendarFeed').inputValue() === 'sports-59' && (await target.locator('#subscriptionSummary').innerText()).includes('일반 예매 오픈'));
    const url = await target.locator('#subscriptionUrl').inputValue();
    await target.locator('#copySubscriptionUrl').click();
    await target.getByRole('button', { name: '복사됨', exact: true }).waitFor();
    check(`subscription ${width}px copies public LG feed`, await target.evaluate(() => navigator.clipboard.readText()) === url && url === 'https://hky5820.github.io/TicketOpenChecker/calendars/sports-59.ics');
    await target.locator('#calendarFeed').selectOption('sports-62');
    check(`subscription ${width}px switching teams updates both subscription addresses`, (await target.locator('#subscriptionUrl').inputValue()).endsWith('/sports-62.ics') && (await target.locator('#appleSubscribeLink').getAttribute('href')).endsWith('/sports-62.ics') && (await target.locator('#appleSubscribeLink').getAttribute('href')).startsWith('webcal://'));
    check(`subscription ${width}px explains one-time desktop setup and refresh timing`, (await target.locator('.subscription-guide').innerText()).includes('PC의 구글 캘린더') && (await target.locator('.subscription-cadence').innerText()).includes('갱신 주기') && (await target.locator('#googleSubscribeLink').getAttribute('href')).endsWith('/settings/addbyurl'));
    check(`subscription ${width}px dialog fits viewport`, await target.locator('#calendarSubscriptionDialog').evaluate(dialog => { const r = dialog.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && dialog.scrollWidth <= dialog.clientWidth; }));
    await target.screenshot({ path: path.join(output, `subscription-${width}.png`), scale: 'css' });
    const audit = await new AxeBuilder({ page: target }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    audits.push({ view: 'calendar-subscription', width, violations: audit.violations.map(v => ({ id: v.id, impact: v.impact, count: v.nodes.length })) });
    await target.keyboard.press('Escape');
    check(`subscription ${width}px closing returns focus and preserves list team`, await target.locator('#subscribeCalendarBtn').evaluate(element => document.activeElement === element) && await target.locator('[data-source="59"]').getAttribute('aria-pressed') === 'true');
    await target.locator('#tab-home').click(); await target.locator('[data-source="melon"]').click();
    await target.locator('#subscribeCalendarBtn').click();
    check(`subscription ${width}px defaults to selected concert provider`, await target.locator('#calendarFeed').inputValue() === 'concert-melon' && (await target.locator('#subscriptionUrl').inputValue()).endsWith('/concert-melon.ics'));
    await target.locator('[data-close="calendarSubscriptionDialog"]').click();
  };
  try {
    await page.clock.setFixedTime(fixedNow);
    await page.route('**/data.json*', route => route.fulfill({ json: fixture }));
    await page.route('**/api/push/key', route => route.fulfill({ json: { key: null } }));
    await page.goto(url);
    await waitCount('.ticket-row', 2);
    check('initial view begins with nearest future opening', (await page.locator('.ticket-row').first().innerText()).includes('테스트 연극') && !(await page.locator('#results').innerText()).includes('지난'));
    check('default selected date, calendar and list agree', await page.locator('#selectedDate').inputValue() === '2026-09-29' && await page.locator('#dateStrip [aria-pressed="true"]').getAttribute('data-date') === '2026-09-29' && await page.locator('#calendarGrid .selected').getAttribute('data-date') === '2026-09-29' && !(await page.locator('#results').innerText()).includes('테스트 전시'));
    check('past dates cannot be selected', await page.locator('#calendarGrid [data-date="2026-09-27"]').isDisabled());
    await page.locator('#dateStrip [data-date="2026-09-29"]').click();
    await waitCount('.ticket-row', 2);
    await page.locator('[data-source="melon"]').click();
    await waitCount('.ticket-row', 1);
    check('date + vendor intersection', (await page.locator('#results').innerText()).includes('테스트 콘서트'));
    await page.locator('#dateStrip [data-date="2026-09-30"]').click();
    check('empty day remains selected', await page.locator('#selectedDate').inputValue() === '2026-09-30');
    await page.getByRole('heading', { name: '선택한 조건의 일정이 없습니다' }).waitFor();
    await page.locator('#searchInput').fill('없음');
    check('empty search does not reset date or vendor', await page.locator('[data-source="melon"]').getAttribute('aria-pressed') === 'true');
    await page.locator('#resetFilters').click();
    await page.locator('[data-range="upcoming"]').click();
    await waitCount('.ticket-row', 3);
    await page.locator('#searchInput').fill('연극'); await waitCount('.ticket-row', 1);
    check('inline search', (await page.locator('#results').innerText()).includes('테스트 연극'));

    await page.locator('#tab-sports').click(); await waitCount('.sports-row', 10);
    for (const team of TEAMS) {
      await page.locator(`[data-source="${team.id}"]`).click(); await waitCount('.sports-row', 2);
      check(`${team.name} isolation`, await page.locator(`.sports-row:not([data-team="${team.id}"])`).count() === 0);
    }
    await page.locator('[data-source="59"]').click();
    check('sports has no date or basis switching', await page.locator('.date-browser').isHidden() && await page.locator('[data-range="upcoming"]').isHidden() && await page.locator('.calendar-panel').isHidden() && await page.locator('[data-basis]').count() === 0);
    check('sports order uses opening time despite reversed game dates', JSON.stringify(await page.locator('#results .sports-row').evaluateAll(rows => rows.map(row => row.dataset.item))) === JSON.stringify(['sports-59-1', 'sports-59-2']));
    check('sports groups by opening date', (await page.locator('#results .group-heading').first().innerText()).includes('9월 29일'));
    check('opening time is primary, game date secondary', await page.locator('.sports-row').first().evaluate(row => parseFloat(getComputedStyle(row.querySelector('.open-info strong')).fontSize) > parseFloat(getComputedStyle(row.querySelector('.game-date')).fontSize)));
    await page.locator('[data-status="scheduled"]').click(); await waitCount('.sports-row', 1);
    check('status filter preserves team and future opening', (await page.locator('.sports-row').innerText()).includes('10.6'));
    await page.locator('.sports-row .bell').click();
    await page.locator('#tab-alarm').click(); await waitCount('.sports-row', 1);
    check('sports reminder uses opening timestamp', (await page.locator('#alarmBody').innerText()).includes('9월 29일'));
    await page.reload(); await page.locator('#tab-alarm').click(); await waitCount('.sports-row', 1);
    check('reminder persists after reload', await page.locator('#alarmBody .bell').getAttribute('aria-pressed') === 'true');
    await page.locator('#alarmBody .bell').click();
    await page.getByRole('heading', { name: '등록한 오픈 알림이 없습니다' }).waitFor();
    check('reminder removal', await page.locator('#alarmCount').isHidden());

    await page.locator('#settingsBtn').click(); await page.locator('#settingsDialog').waitFor();
    await page.keyboard.press('Escape'); check('settings keyboard dismissal', !await page.locator('#settingsDialog').isVisible());
    await page.locator('#tab-sports').click(); await waitCount('.sports-row', 10);
    await page.route('**/api/sports', route => route.fulfill({ json: { generatedAt: fixedNow.toISOString(), items: [], teamStatus: { '59': { ok: false }, '63': { ok: true, count: 0 }, '57': { ok: true, count: 0 }, '62': { ok: true, count: 0 }, '58': { ok: true, count: 0 } } } }));
    await page.locator('#reloadBtn').click(); await waitCount('.sports-row', 2);
    check('failed team retains snapshot, successful empty clears it', (await page.locator('#dataNotice').innerText()).includes('LG 트윈스 조회 실패'));
    check('stale status does not claim current availability', await page.getByText('이전 조회 자료', { exact: true }).count() === 2);

    await page.route('**/data.json*', route => route.fulfill({ json: { ...fixture, items: [...fixture.items, concert('melon', '곧 지나는 오픈', '2026-09-28', '19:01')] } }));
    await page.evaluate(() => localStorage.clear()); await page.reload();
    await waitCount('.ticket-row', 1);
    check('next opening is first before deadline', (await page.locator('.ticket-row').first().innerText()).includes('곧 지나는 오픈'));
    await page.clock.setFixedTime(new Date('2026-09-28T10:01:01Z'));
    await waitCount('.ticket-row', 2);
    check('expired opening disappears without reload', !(await page.locator('#results').innerText()).includes('곧 지나는 오픈') && (await page.locator('.ticket-row').first().innerText()).includes('테스트 연극'));
    check('default date follows next remaining opening', await page.locator('#selectedDate').inputValue() === '2026-09-29' && await page.locator('#dateStrip [aria-pressed="true"]').getAttribute('data-date') === '2026-09-29');
    await page.locator('#dateStrip [data-date="2026-09-28"]').click(); await waitCount('.ticket-row', 0);
    await page.clock.setFixedTime(new Date('2026-09-28T15:00:01Z')); await waitCount('.ticket-row', 2);
    check('KST midnight selects next valid date', await page.locator('#selectedDate').inputValue() === '2026-09-29' && await page.locator('#dateStrip [aria-pressed="true"]').getAttribute('data-date') === '2026-09-29');

    await checkScrollDates(page, 1440);

    // Visual and axe checks below use the real committed export, not test fixtures.
    await page.unroute('**/data.json*');
    await page.clock.setFixedTime(new Date());
    await page.evaluate(() => localStorage.clear()); await page.reload();
    await page.waitForFunction(() => document.querySelector('#resultCount').textContent.length > 0);
    const audits = [];
    await checkSubscriptions(page, 1440, audits);
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: width === 375 ? 844 : 1000 });
      for (const view of ['home', 'sports']) {
        await page.locator(`#tab-${view}`).click();
        await page.locator('#resetFilters').click();
        if (view === 'sports') await page.locator('[data-source="59"]').click();
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => Promise.race([
          Promise.all([...document.images].filter(image => image.getBoundingClientRect().top < innerHeight && image.getBoundingClientRect().bottom > 0).map(image => image.decode().catch(() => {}))),
          new Promise(resolve => setTimeout(resolve, 3000)),
        ]));
        await page.screenshot({ path: path.join(output, `${view}-${width}.png`), animations: 'disabled' });
        check(`${view} ${width}px no document overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        audits.push({ view, width, violations: audit.violations.map(v => ({ id: v.id, impact: v.impact, count: v.nodes.length, nodes: v.nodes.slice(0, 3).map(n => n.target) })) });
      }
    }
    // Cover-display CSS widths vary with the Fold generation and Android zoom.
    // Reserve browser chrome by testing a conservative 748px content height.
    const mobile = await browser.newContext({ viewport: { width: 344, height: 748 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, timezoneId: 'Asia/Seoul', reducedMotion: 'reduce' });
    const cover = await mobile.newPage();
    cover.on('pageerror', error => errors.push(error.message));
    await cover.clock.setFixedTime(fixedNow);
    await cover.route('**/data.json*', route => route.fulfill({ json: fixture }));
    await cover.goto(url);
    await cover.locator('[data-source="ticketlink"]').tap();
    check('default vendor view selects its nearest opening date', await cover.locator('#selectedDate').inputValue() === '2026-09-30' && await cover.locator('#dateStrip [aria-pressed="true"]').getAttribute('data-date') === '2026-09-30' && await cover.locator('#results .ticket-row').count() === 1);
    await cover.locator('[data-source="melon"]').tap();
    check('continuous dates focus nearest future opening', await cover.locator('#dateStrip button').count() >= 61 && await cover.locator('#dateStrip').getAttribute('data-focus') === '2026-09-29');
    await cover.locator('#dateStrip [data-date="2026-09-30"]').tap();
    check('direct date choice keeps empty day and vendor', await cover.locator('#selectedDate').inputValue() === '2026-09-30' && await cover.locator('#results .ticket-row').count() === 0 && await cover.locator('[data-source="melon"]').getAttribute('aria-pressed') === 'true');
    await cover.locator('#dateStrip [data-date="2026-09-29"]').tap();
    check('neighboring date takes one tap', await cover.locator('#results .ticket-row').count() === 1);
    const stripRect = await cover.locator('#dateStrip').boundingBox();
    const beforeSwipe = await cover.locator('#dateStrip').evaluate(el => el.scrollLeft);
    const cdp = await mobile.newCDPSession(cover);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: stripRect.x + 280, y: stripRect.y + 30 }] });
    for (let step = 1; step <= 8; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: stripRect.x + 280 - step * 28, y: stripRect.y + 30 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cover.waitForFunction(before => document.querySelector('#dateStrip').scrollLeft > before + 100, beforeSwipe);
    await cdp.detach();
    check('touch swipe scrolls dates without changing selection', await cover.locator('#selectedDate').inputValue() === '2026-09-29' && await cover.locator('[data-source="melon"]').getAttribute('aria-pressed') === 'true');
    await cover.locator('#dateStrip [data-date="2026-10-06"]').tap();
    check('scrolling into next month selects exact date', await cover.locator('#selectedDate').inputValue() === '2026-10-06');
    await cover.locator('#dateStrip [data-date="2026-09-29"]').tap();
    await cover.locator('#datePickerBtn').tap();
    check('cover calendar focuses selected date', await cover.locator('#calendarGrid [data-date="2026-09-29"]').evaluate(element => document.activeElement === element));
    check('calendar disables past dates', await cover.locator('#calendarGrid [data-date="2026-09-27"]').isDisabled());
    const calendarAudit = await new AxeBuilder({ page: cover }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    audits.push({ view: 'cover-calendar', width: 344, violations: calendarAudit.violations.map(v => ({ id: v.id, impact: v.impact, count: v.nodes.length })) });
    await cover.screenshot({ path: path.join(output, 'cover-calendar-344.png'), scale: 'css' });
    check('calendar marks vendor openings', await cover.locator('#calendarGrid [data-date="2026-09-29"]').getAttribute('class').then(value => value.includes('has-events')));
    for (let month = 0; month < 3; month++) await cover.locator('#monthNext').tap();
    await cover.locator('#calendarGrid [data-date="2026-12-31"]').tap();
    await cover.locator('#dateDialog').waitFor({ state: 'hidden' });
    check('calendar selects exact day and restores focus', await cover.locator('#selectedDate').inputValue() === '2026-12-31' && await cover.locator('#datePickerBtn').evaluate(element => document.activeElement === element));
    await cover.locator('#dateStrip [data-date="2027-01-01"]').tap();
    check('date navigation crosses year boundary', await cover.locator('#selectedDate').inputValue() === '2027-01-01');
    await cover.locator('[data-range="upcoming"]').tap();
    check('all upcoming has no date pretending to be selected', await cover.locator('#selectedDate').inputValue() === '' && await cover.locator('#dateStrip [aria-pressed="true"]').count() === 0 && await cover.locator('#calendarGrid .selected').count() === 0);
    await cover.locator('#datePickerBtn').tap();
    await cover.locator('#monthNext').tap();
    await cover.keyboard.press('Escape');
    await cover.locator('.sidebar .calendar-panel').waitFor({ state: 'attached' });
    check('calendar cancel keeps date and returns single calendar', await cover.locator('#selectedDate').inputValue() === '' && await cover.locator('.sidebar .calendar-panel').count() === 1);
    await cover.locator('#tab-sports').tap();
    for (const team of TEAMS) {
      await cover.getByRole('button', { name: team.name, exact: true }).tap();
      check(`cover touch selects ${team.name}`, await cover.locator('#results .sports-row').count() === 2 && await cover.locator(`#results .sports-row:not([data-team="${team.id}"])`).count() === 0);
    }
    check('cover sports hides every date control', await cover.locator('.date-browser').isHidden() && await cover.locator('[data-range="upcoming"]').isHidden());
    await cover.locator('[data-status="scheduled"]').tap();
    check('cover sports opening date is distinct from game date', await cover.locator('#results .sports-row').count() === 1 && (await cover.locator('.sports-row').innerText()).includes('10.6'));
    await cover.locator('.bell').tap();
    await cover.locator('#tab-alarm').tap();
    check('cover reminder and navigation', await cover.locator('#alarmBody .sports-row').count() === 1);
    await cover.locator('#settingsBtn').tap();
    await cover.locator('[data-close="settingsDialog"]').tap();
    check('cover settings controls', !await cover.locator('#settingsDialog').isVisible());

    await checkScrollDates(cover, 344);
    await checkSubscriptions(cover, 344, audits);

    await cover.unroute('**/data.json*');
    await cover.clock.setFixedTime(new Date());
    await cover.evaluate(() => localStorage.clear()); await cover.reload();
    const coverMetrics = [];
    for (const width of [344, 360, 384]) {
      await cover.setViewportSize({ width, height: 748 });
      for (const view of ['home', 'sports']) {
        await cover.locator(`#tab-${view}`).tap(); await cover.locator('#resetFilters').tap();
        if (view === 'sports') await cover.locator('[data-source="59"]').tap();
        await cover.evaluate(() => document.fonts.ready);
        await cover.evaluate(() => scrollTo(0, 0));
        await cover.locator('.source-logo').evaluateAll(images => Promise.all(images.map(image => image.decode())));
        check(`cover ${view} ${width}px logos load`, await cover.locator('.source-logo').count() === (view === 'sports' ? 5 : 3));
        await cover.evaluate(() => Promise.race([
          Promise.all([...document.images].filter(image => image.getBoundingClientRect().top < innerHeight && image.getBoundingClientRect().bottom > 0).map(image => image.decode().catch(() => {}))),
          new Promise(resolve => setTimeout(resolve, 3000)),
        ]));
        await cover.screenshot({ path: path.join(output, `cover-${view}-${width}.png`), scale: 'css', animations: 'disabled' });
        const metrics = await cover.evaluate(() => {
          const rows = [...document.querySelectorAll('#results article')].map(row => row.getBoundingClientRect());
          const sources = [...document.querySelectorAll('.source-filter')].map(button => button.getBoundingClientRect());
          return { overflow: document.documentElement.scrollWidth > innerWidth, firstRowTop: rows[0]?.top, rowHeight: rows[0]?.height, fullyVisibleRows: rows.filter(row => row.top >= 0 && row.bottom <= innerHeight).length, singleSourceLine: new Set(sources.map(rect => rect.top)).size === 1, sourcesReachable: sources.every(rect => rect.left >= 0 && rect.right <= innerWidth && rect.width >= 24 && rect.height >= 24) };
        });
        coverMetrics.push({ view, width, height: 748, ...metrics });
        check(`cover ${view} ${width}px fits with one accessible source row`, !metrics.overflow && metrics.singleSourceLine && metrics.sourcesReachable);
        if (view === 'home') check(`cover ${width}px has scrollable dates and six visible targets`, await cover.locator('#dateStrip').evaluate(strip => { const bounds = strip.getBoundingClientRect(); return strip.scrollWidth > strip.clientWidth && [...strip.children].filter(button => { const r = button.getBoundingClientRect(); return r.left >= bounds.left && r.right <= bounds.right && r.width >= 44; }).length >= 6; }));
        else check(`cover sports ${width}px has no date picker`, await cover.locator('.date-browser').isHidden() && await cover.locator('[data-range="upcoming"]').isHidden());
        if (view === 'home') check(`cover concert ${width}px consistent item heights`, await cover.locator('#results .ticket-row').evaluateAll(rows => { const heights = rows.map(row => row.getBoundingClientRect().height - parseFloat(getComputedStyle(row).borderBottomWidth)); return heights.length < 2 || Math.max(...heights) - Math.min(...heights) < 1; }));
        const audit = await new AxeBuilder({ page: cover }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        audits.push({ view: `cover-${view}`, width, violations: audit.violations.map(v => ({ id: v.id, impact: v.impact, count: v.nodes.length })) });
      }
    }
    await mobile.close();
    check('no uncaught browser errors', errors.length === 0);
    const report = { checkedAt: new Date().toISOString(), functionalData: 'synthetic fixture', visualData: 'real public/data.json export', checks, errors, audits, coverMetrics };
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    assert.equal(audits.reduce((n, audit) => n + audit.violations.length, 0), 0, JSON.stringify(audits, null, 2));
    console.log(JSON.stringify({ checks: checks.length, screenshots: 21, axeViolations: 0, browserErrors: errors.length, coverMetrics, report: path.join(output, 'report.json') }, null, 2));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
