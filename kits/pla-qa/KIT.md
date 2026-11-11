# Kit QA PLA (Office Desk)

Bộ kiểm tự động cho playable ads HTML5 (PLA). Dùng Playwright điều khiển trình duyệt Chromium có sẵn trên máy (Edge, Chrome, Cốc Cốc) ở chế độ headless.

## Dùng để làm gì
- Khối **QA** của session preset PLA kiểm gameplay theo AC: mở game, chạm, chờ, chụp ảnh, đọc tracking, đo thời gian vào game.
- Kiểm cả dev server (localhost) lẫn bản build một tệp HTML trong `dist/`.
- Không thay `npm run verify` của template-pla: project có lệnh này thì chạy `npm run verify -- dev` trước, kit chỉ dùng cho kịch bản mà verify không kiểm (luồng chơi, thắng/thua, tracking theo GDD, thời gian vào game).

## Office Desk chép vào project thế nào
- Lần đầu khối QA chạy trong session PLA, Office Desk chép kit vào `<project>/.office-desk/qa/`:
  - `lib/harness.js`: harness;
  - `lib/kit.json`: version kit và đường dẫn Office Desk (để tìm `playwright-core` nếu project không cài);
  - `smoke.js`: kịch bản mẫu;
  - `KIT.md`: tệp này.
- Tệp đã có trong project thì **không bị ghi đè**. Bản trong project thuộc về project: sửa, thêm kịch bản ở đó.
- Bản gốc trong Office Desk (`kits/pla-qa/`) chỉ sửa khi có bug hoặc nâng cấp, không sửa theo đặc trưng của một project. Kit nâng version thì Office Desk báo trong prompt của QA; project tự quyết có chép bản mới hay không.

## Yêu cầu
- Node 18 trở lên.
- `playwright-core`: lấy từ `node_modules` của project (template-pla có sẵn). Không có thì dùng bản Office Desk cài kèm.
- Trình duyệt Chromium (Edge/Chrome/Cốc Cốc). Đặt `PLA_BROWSER=<đường dẫn exe>` để chọn trình duyệt khác.
- Dev server: `scripts/dev.js` (template-pla), hoặc `playable-scripts dev`. Project khác thì tự bật server rồi đặt `QA_URL=<url>`.
- Vị trí CTA: game báo qua `window.__playable = { sdk, game, cta }` ở bản dev (hợp đồng của template-pla, `Game.ctaBounds()`). Không có thì các bước CTA chỉ cảnh báo.

## Chạy
```bash
node .office-desk/qa/smoke.js                                   # dev server
node .office-desk/qa/smoke.js --file "dist/<app>/<id>/applovin/<tệp>.html"   # một bản build
```
- Kết quả: `.office-desk/qa/out/<tên>.md` và `.json`, ảnh trong `out/`. Exit code 1 khi có mục lỗi.
- Mỗi kịch bản tự bật và tắt dev server và trình duyệt, kể cả khi lỗi. Quá `QA_TIMEOUT_MS` (mặc định 240000) thì dừng và ghi lỗi Timeout. Mỗi lệnh chỉ chạy một kịch bản.

## Viết kịch bản mới
Mỗi việc một tệp trong `.office-desk/qa/`, đầu tệp ghi cách chạy:

```js
// node .office-desk/qa/lose.js — AC-2.1: hết giờ thì hiện TRY AGAIN
const { run } = require('./lib/harness');
run('lose', async ({ open, report, shot, tap, trackingLog }) => {
  const { page } = await open({ viewport: 'portrait', query: 'debug=1' });
  await page.waitForTimeout(42000);
  const image = await shot(page, 'lose');
  const events = await trackingLog(page);
  report.check('AC-2.1', events.some((e) => JSON.stringify(e).includes('lose_timeout')), `ảnh ${image}`);
});
```

Các hàm `run()` đưa cho kịch bản:

| Hàm | Việc |
| --- | --- |
| `open({ viewport, ua, query, waitStart })` | Mở game trong context mới. `viewport`: `'portrait'`, `'landscape'` (theo `verify.json`) hoặc `[w, h]`; `ua`: `'android'`, `'ios'`. Trả `{ page, context, errors, external, collector, startMs }`. |
| `tap(page, x, y)` | Chạm theo toạ độ canvas. |
| `tapCta(page)` | Chạm CTA, trả URL store được mở hoặc `null`. |
| `ctaRect(page)` | Vùng CTA trên trang. |
| `trackingLog(page)` | `window.__tracking` (localhost hoặc `?trackdebug=1`). |
| `shot(page, tên)` | Chụp vào `out/`, trả đường dẫn. |
| `report.pass / fail / warn / check(mục, ok, chi tiết)` | Ghi kết quả. |
| `extra` | Object ghi kèm vào `out/<tên>.json` (số đo). |

Trong page có `window.__playable.sdk` (pause, resume, volume, install) và `window.__playable.game` (Phaser.Game) để đọc trạng thái. Request ngoài bị chặn; collector tracking được trả 204 và ghi vào `collector`.
