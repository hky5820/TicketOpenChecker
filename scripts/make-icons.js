// 앱 아이콘 생성기 — Playwright(Chromium)로 SVG를 렌더링해 PNG로 저장한다.
// 실행: node scripts/make-icons.js  (결과물은 public/ 에 저장)
const path = require('path');
const { chromium } = require('playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// rounded=true 면 모서리가 둥근 일반 아이콘, false 면 마스커블(꽉 찬 정사각형) 배경.
function svg(rounded) {
  const rx = rounded ? 112 : 0;
  // 다크+그린 앱 아이덴티티: 그린 타일 + 블랙 티켓 글리프
  return `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="512" height="512" rx="${rx}" fill="#1ed760"/>
  <g transform="translate(256 256) rotate(-8) scale(5.1) translate(-48 -48)">
    <path d="M23 30 H73 A7 7 0 0 1 80 37 V43 A5 5 0 0 0 80 53 V59 A7 7 0 0 1 73 66 H23 A7 7 0 0 1 16 59 V53 A5 5 0 0 0 16 43 V37 A7 7 0 0 1 23 30 Z" fill="#0d0e11"/>
    <line x1="63" y1="35.5" x2="63" y2="60.5" stroke="#1ed760" stroke-width="2.8" stroke-dasharray="3.4 4.2" stroke-linecap="round"/>
    <circle cx="40" cy="48" r="5.2" fill="#1ed760"/>
  </g>
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
