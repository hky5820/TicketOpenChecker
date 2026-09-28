const path = require('path');
const { chromium, devices } = require('playwright');

// mycode/providers/ticketlink/src/browser.js lookup flow: real Chrome, Pixel 7,
// matching UA + Client Hints, CDP touch, isolated persistent profile. No login import.
async function launchTicketlinkBrowser() {
  const device = devices['Pixel 7'];
  const context = await chromium.launchPersistentContext(
    process.env.SPORTS_PROFILE_DIR || path.join(__dirname, '../output/sports-chrome-profile'), {
      channel: 'chrome', headless: true, ...device,
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check', '--disable-popup-blocking', '--disable-dev-shm-usage'],
      locale: 'ko-KR', timezoneId: 'Asia/Seoul',
    });
  try {
    const version = context.browser().version();
    const major = version.split('.')[0];
    const userAgent = device.userAgent.replace(/Chrome\/[\d.]+/, `Chrome/${version}`);
    await installHardwareLeakMask(context);
    const page = context.pages()[0] || await context.newPage();
    const cdp = await context.newCDPSession(page);
    const apply = async () => {
      await cdp.send('Emulation.setUserAgentOverride', {
        userAgent, acceptLanguage: 'ko-KR,ko', platform: 'Linux armv8l',
        userAgentMetadata: {
          brands: [{ brand: 'Not_A Brand', version: '24' }, { brand: 'Chromium', version: major }, { brand: 'Google Chrome', version: major }],
          fullVersionList: [{ brand: 'Not_A Brand', version: '24.0.0.0' }, { brand: 'Chromium', version }, { brand: 'Google Chrome', version }],
          fullVersion: version, platform: 'Android', platformVersion: '14.0.0',
          architecture: '', model: 'Pixel 7', mobile: true, bitness: '', wow64: false,
        },
      });
      await Promise.all([
        cdp.send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' }),
        cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }),
        cdp.send('Emulation.setDeviceMetricsOverride', {
          ...device.viewport, deviceScaleFactor: device.deviceScaleFactor, mobile: true,
          screenWidth: device.screen.width, screenHeight: device.screen.height,
          screenOrientation: { type: 'portraitPrimary', angle: 0 },
        }),
      ]);
    };
    await apply();
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) apply().catch(() => {});
    });
    return { context, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function installHardwareLeakMask(context) {
  await context.addInitScript(() => {
    const sources = new WeakMap();
    const original = Function.prototype.toString;
    const wrapped = new Proxy(original, {
      apply(target, self, args) {
        return sources.has(self) ? `function ${sources.get(self)}() { [native code] }` : Reflect.apply(target, self, args);
      },
    });
    sources.set(wrapped, 'toString');
    Object.defineProperty(Function.prototype, 'toString', { value: wrapped, configurable: true, writable: true });
    const define = (name, value) => {
      const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, name);
      if (!descriptor?.configurable) return;
      const get = function () { return value; };
      sources.set(get, `get ${name}`);
      Object.defineProperty(Navigator.prototype, name, { ...descriptor, get });
    };
    define('platform', 'Linux armv8l');
    define('hardwareConcurrency', 8);
    define('deviceMemory', 8);
    define('maxTouchPoints', 5);
    for (const [name, proto] of [['plugins', PluginArray.prototype], ['mimeTypes', MimeTypeArray.prototype]]) {
      const empty = Object.create(proto);
      Object.defineProperty(empty, 'length', { get: () => 0 });
      define(name, empty);
    }
    for (const proto of [window.WebGLRenderingContext?.prototype, window.WebGL2RenderingContext?.prototype]) {
      if (!proto) continue;
      const getParameter = proto.getParameter;
      proto.getParameter = function getParameterMobile(value) {
        if (value === 37445) return 'Qualcomm';
        if (value === 37446) return 'Adreno (TM) 730';
        return getParameter.call(this, value);
      };
      sources.set(proto.getParameter, 'getParameter');
    }
  });
}

module.exports = { launchTicketlinkBrowser };
