// 앱 아이콘 생성기 — 원본을 Chrome canvas로 축소해 플랫폼별 PNG로 저장한다.
// 실행: node scripts/make-icons.js
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TARGETS = [
  { file: 'icon-512.png', size: 512, rounded: true },
  { file: 'icon-192.png', size: 192, rounded: true },
  // iOS와 Android 런처가 직접 모양을 적용하므로 배경을 끝까지 채운다.
  { file: 'icon-180.png', size: 180, rounded: false },
  { file: 'icon-maskable-512.png', size: 512, rounded: false },
  { file: 'favicon-32.png', size: 32, rounded: true },
  { file: 'favicon-16.png', size: 16, rounded: true },
];

(async () => {
  const source = await fs.readFile(path.join(PUBLIC_DIR, 'assets/brand/ticket-open-master.png'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body><canvas></canvas></body></html>');
    for (const target of TARGETS) {
      const png = await page.evaluate(async ({ source, size, rounded }) => {
        const image = new Image();
        image.src = source;
        await image.decode();
        const canvas = document.querySelector('canvas');
        canvas.width = canvas.height = size;
        const context = canvas.getContext('2d');
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        if (rounded) {
          context.beginPath();
          context.roundRect(0, 0, size, size, size * 0.22);
          context.clip();
        }
        context.drawImage(image, 0, 0, size, size);
        return canvas.toDataURL('image/png').split(',')[1];
      }, { source: `data:image/png;base64,${source.toString('base64')}`, ...target });
      await fs.writeFile(path.join(PUBLIC_DIR, target.file), Buffer.from(png, 'base64'));
      console.log('wrote', target.file, `(${target.size}px)`);
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
