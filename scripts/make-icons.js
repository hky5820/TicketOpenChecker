// 앱 아이콘 생성기 — Playwright(Chromium)로 SVG를 렌더링해 PNG로 저장한다.
// 실행: node scripts/make-icons.js  (결과물은 public/ 에 저장)
const path = require('path');
const { chromium } = require('playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// rounded=true 면 모서리가 둥근 일반 아이콘, false 면 마스커블(꽉 찬 정사각형) 배경.
function svg(rounded) {
  const rx = rounded ? 112 : 0;
  return `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5b74f8"/>
      <stop offset="1" stop-color="#3346c9"/>
    </linearGradient>
    <clipPath id="card"><rect x="112" y="150" width="288" height="252" rx="40"/></clipPath>
    <filter id="sh" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#141d52" flood-opacity="0.34"/>
    </filter>
  </defs>

  <rect x="0" y="0" width="512" height="512" rx="${rx}" fill="url(#bg)"/>
  <rect x="0" y="0" width="512" height="240" rx="${rx}" fill="#ffffff" opacity="0.07"/>

  <!-- 캘린더 카드 -->
  <g filter="url(#sh)">
    <rect x="190" y="118" width="20" height="52" rx="10" fill="#dbe3ff"/>
    <rect x="302" y="118" width="20" height="52" rx="10" fill="#dbe3ff"/>
    <rect x="112" y="150" width="288" height="252" rx="40" fill="#ffffff"/>
    <g clip-path="url(#card)">
      <rect x="112" y="150" width="288" height="72" fill="#4361ee"/>
    </g>
  </g>

  <!-- 예매처 3색 동그라미 (파랑 NOL / 초록 멜론 / 빨강 티켓링크) -->
  <circle cx="176" cy="312" r="34" fill="#2e63f0"/>
  <circle cx="256" cy="312" r="34" fill="#00a33f"/>
  <circle cx="336" cy="312" r="34" fill="#e03e3e"/>
</svg>`;
}

const TARGETS = [
  { file: 'icon-512.png', size: 512, rounded: true },
  { file: 'icon-192.png', size: 192, rounded: true },
  { file: 'icon-180.png', size: 180, rounded: true },
  { file: 'favicon-32.png', size: 32, rounded: true },
  { file: 'icon-maskable-512.png', size: 512, rounded: false },
];

(async () => {
  const browser = await chromium.launch();
  try {
    for (const t of TARGETS) {
      const page = await browser.newPage({ viewport: { width: t.size, height: t.size }, deviceScaleFactor: 1 });
      const markup = svg(t.rounded).replace('width="512" height="512"', `width="${t.size}" height="${t.size}"`);
      await page.setContent(`<!doctype html><html><body style="margin:0;padding:0;background:transparent">${markup}</body></html>`);
      await page.locator('svg').screenshot({ path: path.join(PUBLIC_DIR, t.file), omitBackground: true });
      await page.close();
      console.log('wrote', t.file, `(${t.size}px)`);
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
