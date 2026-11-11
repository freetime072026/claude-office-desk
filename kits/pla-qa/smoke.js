'use strict';

// Office Desk PLA QA kit: smoke check. Run: node .office-desk/qa/smoke.js [--file dist/.../x.html]
// Without --file it checks the dev server; with --file it checks one built HTML the way a network loads it.
// Per viewport: time until the game started, canvas covers the screen, CTA fully on screen, screenshot.
// Then: CTA opens the store (Android + iOS), console errors, requests other than the tracking collector.
// Report: .office-desk/qa/out/smoke.md (+ .json). Copy this file to start a project scenario.
const { run } = require('./lib/harness');

const fileArg = process.argv.indexOf('--file');
const file = fileArg >= 0 ? process.argv[fileArg + 1] : null;

run(
  file ? 'smoke-build' : 'smoke',
  async ({ open, report, shot, viewports, tapCta, ctaRect, trackingLog, extra }) => {
    const errors = new Set(), external = new Set(), collector = [];
    const keep = (ctx) => {
      ctx.errors.forEach((e) => errors.add(e));
      ctx.external.forEach((e) => external.add(e));
      collector.push(...ctx.collector);
    };

    for (const name of Object.keys(viewports)) {
      const ctx = await open({ viewport: name });
      await ctx.page.waitForTimeout(800);
      const layout = await ctx.page.evaluate(() => {
        const c = document.querySelector('canvas').getBoundingClientRect();
        return { w: innerWidth, h: innerHeight, c: { x: c.left, y: c.top, w: c.width, h: c.height }, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight };
      });
      const cta = await ctaRect(ctx.page);
      // window.__playable exists only on the dev server (template-pla strips it from builds), so a build cannot report its CTA.
      const devHooks = await ctx.page.evaluate(() => Boolean(window.__playable));
      const problems = [], notes = [];
      if (Math.abs(layout.c.x) > 1 || Math.abs(layout.c.y) > 1 || Math.abs(layout.c.w - layout.w) > 1 || Math.abs(layout.c.h - layout.h) > 1) problems.push('canvas không phủ màn');
      if (layout.sw > layout.w + 1 || layout.sh > layout.h + 1) problems.push('trang bị cuộn');
      if (!cta) (devHooks ? problems : notes).push(devHooks ? 'không có vị trí CTA (Game.ctaBounds)' : 'bản build không có window.__playable, kiểm CTA trên dev server');
      else if (cta.x < 0 || cta.y < 0 || cta.x + cta.width > layout.w || cta.y + cta.height > layout.h) problems.push('CTA bị cắt');
      const image = await shot(ctx.page, `smoke-${name}`);
      const detail = `${ctx.size.join('x')}: ${[...problems, ...notes].join('; ') || 'canvas phủ màn, CTA nằm trọn'} · vào game ${ctx.startMs} ms · ảnh ${image}`;
      if (problems.length) report.fail(`Màn ${name}`, detail);
      else if (notes.length) report.warn(`Màn ${name}`, detail);
      else report.pass(`Màn ${name}`, detail);
      extra[`startMs_${name}`] = ctx.startMs;
      keep(ctx);
      await ctx.context.close();
    }

    for (const ua of ['android', 'ios']) {
      const ctx = await open({ viewport: 'portrait', ua });
      await ctx.page.waitForTimeout(800);
      if (!(await ctaRect(ctx.page))) report.warn(`CTA ${ua}`, 'game không báo vị trí CTA (bản build hoặc thiếu Game.ctaBounds), bỏ qua');
      else {
        const opened = await tapCta(ctx.page);
        report.check(`CTA ${ua}`, Boolean(opened), opened ? `mở ${opened}` : 'bấm CTA không mở store');
      }
      const log = await trackingLog(ctx.page);
      if (ua === 'android') extra.tracking = log.length ? log : ctx.collector;
      keep(ctx);
      await ctx.context.close();
    }

    report.check('Console', errors.size === 0, errors.size ? [...errors].slice(0, 10).join('\n') : 'không có lỗi console');
    report.check('Request ngoài', external.size === 0, external.size ? [...external].join(', ') : 'chỉ có collector tracking');
    report.pass('Collector', `${collector.length} lần gửi: ${[...new Set(collector.map((c) => c.name || c.event))].join(', ') || '(không có)'}`);
  },
  file ? { file } : {}
);
