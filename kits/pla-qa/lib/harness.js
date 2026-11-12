'use strict';

// Office Desk PLA QA kit: Playwright harness for HTML5 playable projects.
//
// Office Desk copies this kit into <project>/.office-desk/qa/ the first time a QA block runs in
// a PLA session. The copy belongs to the project: edit it there for the project's needs. The
// original in Office Desk (kits/pla-qa/) only changes for bug fixes and upgrades.
//
// A scenario script is one file in .office-desk/qa/, run with `node <file>` from anywhere:
//
//   const { run } = require('./lib/harness');
//   run('lose', async ({ open, report, shot }) => {
//     const { page } = await open({ viewport: 'portrait' });
//     await page.waitForTimeout(42000);
//     await shot(page, 'lose');
//     report.pass('AC-2.1', 'màn TRY AGAIN hiện sau 40 s');
//   });
//
// run() starts the project's dev server (or uses QA_URL), launches a Chromium browser headless,
// gives the scenario helpers, writes out/<name>.json + out/<name>.md, and always closes the
// browser and the server, also on errors and on QA_TIMEOUT. Exit code 1 when a check failed.
const fs = require('fs');
const net = require('net');
const http = require('http');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const QA_DIR = path.resolve(__dirname, '..');
const OUT = path.join(QA_DIR, 'out');
const KIT = readJson(path.join(__dirname, 'kit.json')) || {};
const ROOT = process.env.QA_ROOT ? path.resolve(process.env.QA_ROOT) : projectRoot(QA_DIR);

const UA = {
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
};
// verify.json of template-pla when the project has one, else the same defaults.
const VIEWPORTS = Object.assign({ portrait: [390, 844], landscape: [844, 390] }, readJson(path.join(ROOT, 'verify.json'))?.viewports);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// <project>/.office-desk/qa -> <project>
function projectRoot(dir) {
  for (let current = dir; ; current = path.dirname(current)) {
    if (path.basename(current) === '.office-desk') return path.dirname(current);
    if (path.dirname(current) === current) return process.cwd();
  }
}

// The project's own playwright-core first (template-pla has it), then the one Office Desk ships.
function loadPlaywright() {
  const roots = [ROOT, process.env.OFFICE_DESK_DIR, KIT.officeDesk].filter(Boolean);
  for (const root of roots) {
    try {
      return require(require.resolve('playwright-core', { paths: [root] }));
    } catch {}
  }
  throw new Error(`không tìm thấy playwright-core trong ${roots.join(', ')}. Cài trong project (npm i -D playwright-core@1.63.0) hoặc mở Office Desk bản có kit QA.`);
}

// PLA_BROWSER wins; otherwise the default browser when it is Chromium-based, else Edge/Chrome/Cốc Cốc.
function findBrowser() {
  const candidates = [];
  if (process.env.PLA_BROWSER) candidates.push(process.env.PLA_BROWSER);
  if (process.platform === 'win32') {
    const fromDefault = windowsDefaultBrowser();
    if (fromDefault && !/firefox/i.test(fromDefault)) candidates.push(fromDefault);
    for (const root of [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']].filter(Boolean)) {
      candidates.push(
        path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(root, 'CocCoc', 'Browser', 'Application', 'browser.exe')
      );
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge');
  }
  const found = candidates.find((file) => file && fs.existsSync(file));
  if (!found) throw new Error('không tìm thấy Edge/Chrome/Cốc Cốc; đặt PLA_BROWSER=<đường dẫn exe>');
  return found;
}

function windowsDefaultBrowser() {
  try {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice';
    const progId = /ProgId\s+REG_SZ\s+(\S+)/.exec(execFileSync('reg', ['query', key, '/v', 'ProgId'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))?.[1];
    if (!progId) return null;
    const command = execFileSync('reg', ['query', `HKCR\\${progId}\\shell\\open\\command`, '/ve'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return /"([^"]+\.exe)"/i.exec(command)?.[1] || null;
  } catch {
    return null;
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function httpOk(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => (res.resume(), resolve(res.statusCode === 200))).on('error', () => resolve(false));
  });
}

// On Windows killing node only stops the wrapper; the whole tree must go so the port is freed.
function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
    } catch {}
  } else child.kill('SIGTERM');
}

// The command that serves the project on localhost: template-pla's scripts/dev.js, else playable-scripts dev.
function devCommand(port) {
  const devScript = path.join(ROOT, 'scripts', 'dev.js');
  if (fs.existsSync(devScript)) return [devScript, '--port', String(port)];
  try {
    const pkgFile = require.resolve('@smoud/playable-scripts/package.json', { paths: [ROOT] });
    const pkg = readJson(pkgFile);
    const bin = typeof pkg.bin === 'string' ? pkg.bin : Object.values(pkg.bin || {})[0];
    if (bin) return [path.join(path.dirname(pkgFile), bin), 'dev', '--port', String(port)];
  } catch {}
  throw new Error(`không biết cách chạy dev server của ${ROOT} (không có scripts/dev.js hay @smoud/playable-scripts). Tự bật server rồi đặt QA_URL=<url>.`);
}

/** Starts the dev server on a free port. Returns { url, stop, log() }. */
async function startDevServer({ timeoutMs = 180000 } = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, devCommand(port), { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = '';
  child.stdout.on('data', (chunk) => (log += chunk));
  child.stderr.on('data', (chunk) => (log += chunk));
  const url = `http://localhost:${port}/`;
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`dev server dừng (exit ${child.exitCode}):\n${log.slice(-2000)}`);
    if (/EADDRINUSE|Error:/i.test(log) && !(await httpOk(url))) break;
    if (await httpOk(url)) return { url, stop: () => killTree(child), log: () => log };
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  killTree(child);
  throw new Error(`dev server không lên ở ${url}:\n${log.slice(-2000)}`);
}

/** Serves one built HTML file (dist/...) at / on a free port, to check a build the way a network loads it. */
async function serveFile(file) {
  const html = fs.readFileSync(path.resolve(ROOT, file));
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url.startsWith('/?')) res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
    else res.writeHead(404).end();
  });
  const port = await freePort();
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { url: `http://localhost:${port}/`, stop: () => server.close(), bytes: html.length };
}

function decodeCollector(url) {
  const params = Object.fromEntries(url.searchParams);
  let detail = params.event_params;
  try {
    detail = JSON.parse(detail);
  } catch {}
  return { event: params.e, name: detail && detail.name, params: detail, url: url.href };
}

/**
 * Opens the game in a fresh context. viewport: 'portrait' | 'landscape' | [w, h]; ua: 'android' | 'ios' | string;
 * query: extra URL query (e.g. 'debug=1&hook=0'). Nothing leaves localhost: collector hits are answered 204 and
 * kept in `collector`, any other external request is aborted and kept in `external`.
 */
async function openPage(browser, baseUrl, { viewport = 'portrait', ua = 'android', query = '', waitStart = true, timeoutMs = 30000 } = {}) {
  const size = Array.isArray(viewport) ? viewport : VIEWPORTS[viewport];
  if (!size) throw new Error(`viewport "${viewport}" không có trong verify.json`);
  const context = await browser.newContext({ userAgent: UA[ua] || ua, viewport: { width: size[0], height: size[1] }, hasTouch: true });
  const errors = [], external = new Set(), collector = [];
  await context.route(/^https?:\/\//, (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue();
    if (url.pathname.endsWith('/p.gif')) {
      collector.push(decodeCollector(url));
      return route.fulfill({ status: 204 });
    }
    external.add(url.origin + url.pathname);
    return route.abort();
  });
  // The SDK opens the store with window.open outside an ad container; keep the URL instead.
  await context.addInitScript(() => {
    window.__opened = [];
    window.open = (url) => (window.__opened.push(String(url)), null);
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  const url = baseUrl + (query ? (baseUrl.includes('?') ? '&' : '?') + query : '');
  const startedAt = Date.now();
  await page.goto(url);
  let startMs = null;
  if (waitStart) {
    // template-pla contract: window.__playable (dev builds). Other projects: the first canvas.
    await page.waitForFunction(() => (window.__playable ? window.__playable.sdk.isStarted : !!document.querySelector('canvas')), null, { timeout: timeoutMs });
    startMs = Date.now() - startedAt;
  }
  return { page, context, errors, external, collector, startMs, size };
}

/** CTA rectangle in page pixels from Game.ctaBounds() (template-pla), or null. */
async function ctaRect(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const bounds = window.__playable && window.__playable.cta ? window.__playable.cta() : null;
    if (!canvas || !bounds) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: bounds.x + rect.left, y: bounds.y + rect.top, width: bounds.width, height: bounds.height };
  });
}

/** Taps a point given in canvas pixels (the game's own coordinates when the canvas is not scaled). */
async function tap(page, x, y) {
  const rect = await page.evaluate(() => {
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { left: r.left, top: r.top };
  });
  await page.mouse.click(rect.left + x, rect.top + y);
}

/** Taps the CTA and returns the store URL the game opened (or null within timeoutMs). */
async function tapCta(page, { timeoutMs = 3000 } = {}) {
  const cta = await ctaRect(page);
  if (!cta) throw new Error('game không báo vị trí CTA (window.__playable.cta / Game.ctaBounds)');
  await page.mouse.click(cta.x + cta.width / 2, cta.y + cta.height / 2);
  return page
    .waitForFunction(() => window.__opened.length > 0 && window.__opened.at(-1), null, { timeout: timeoutMs })
    .then((handle) => handle.jsonValue())
    .catch(() => null);
}

/** Tracking log the page keeps on localhost or with ?trackdebug=1 (template-pla), [] otherwise. */
function trackingLog(page) {
  return page.evaluate(() => (Array.isArray(window.__tracking) ? window.__tracking : []));
}

/** Pass/fail/warn list written as out/<name>.json and out/<name>.md. */
function createReport(name) {
  const results = [];
  const add = (ok) => (item, detail = '') => {
    results.push({ item, ok, detail: String(detail) });
    console.log(`${ok === true ? 'PASS' : ok === false ? 'FAIL' : 'WARN'} [${item}] ${detail}`);
  };
  return {
    results,
    pass: add(true),
    fail: add(false),
    warn: add(null),
    check: (item, ok, detail) => add(ok ? true : false)(item, detail),
    get failed() {
      return results.filter((r) => r.ok === false).length;
    },
    save(extra = {}) {
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ name, at: new Date().toISOString(), results, ...extra }, null, 2));
      const mark = (ok) => (ok === true ? '✅' : ok === false ? '❌' : '⚠️');
      const rows = results.map((r) => `| ${r.item} | ${mark(r.ok)} | ${r.detail.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')} |`);
      fs.writeFileSync(path.join(OUT, `${name}.md`), [`# QA ${name} – ${new Date().toISOString()}`, '', '| Mục | Kết quả | Chi tiết |', '| --- | --- | --- |', ...rows, ''].join('\n'));
      return path.join(OUT, `${name}.md`);
    }
  };
}

/**
 * Runs one scenario with a browser and a server, then cleans up. options: { url, file, timeoutMs }.
 * url (or QA_URL) skips the dev server; file serves a built HTML from the project (e.g. 'dist/.../x.html').
 */
async function run(name, scenario, options = {}) {
  const timeoutMs = Number(process.env.QA_TIMEOUT_MS) || options.timeoutMs || 240000;
  const report = createReport(name);
  let server = null, browser = null, timer = null;
  const cleanup = async () => {
    clearTimeout(timer);
    if (browser) await browser.close().catch(() => {});
    if (server) server.stop();
  };
  // A hung scenario must not leave a browser or a dev server holding the port.
  timer = setTimeout(async () => {
    report.fail('Timeout', `kịch bản quá ${Math.round(timeoutMs / 1000)} s, đã dừng`);
    console.log(`Báo cáo: ${path.relative(ROOT, report.save())}`);
    await cleanup();
    process.exit(1);
  }, timeoutMs);
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const url = options.url || process.env.QA_URL;
    server = url ? null : options.file ? await serveFile(options.file) : await startDevServer();
    const baseUrl = url || server.url;
    const { chromium } = loadPlaywright();
    browser = await chromium.launch({ executablePath: findBrowser(), headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    const extra = {};
    await scenario({
      root: ROOT,
      out: OUT,
      url: baseUrl,
      browser,
      report,
      extra,
      viewports: VIEWPORTS,
      open: (opts) => openPage(browser, baseUrl, opts),
      shot: async (page, file) => {
        const target = path.join(OUT, file.endsWith('.png') ? file : `${file}.png`);
        await page.screenshot({ path: target });
        return path.relative(ROOT, target);
      },
      tap,
      tapCta,
      ctaRect,
      trackingLog,
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    });
    console.log(`\n${report.failed ? 'FAILED' : 'PASSED'}: ${report.failed} lỗi. Báo cáo: ${path.relative(ROOT, report.save(extra))}`);
  } catch (error) {
    report.fail('Lỗi kịch bản', error.stack || error.message);
    console.log(`Báo cáo: ${path.relative(ROOT, report.save())}`);
  } finally {
    await cleanup();
  }
  process.exitCode = report.failed ? 1 : 0;
}

module.exports = { run, openPage, startDevServer, serveFile, tap, tapCta, ctaRect, trackingLog, createReport, findBrowser, loadPlaywright, ROOT, OUT, UA, VIEWPORTS, KIT };
