# Kit asset-preview — trang xem trước asset, anim, VFX của project game

Một trang HTML tĩnh (mở thẳng bằng trình duyệt, không cần server) cho người làm game xem nhanh mọi thứ trong `assets/` và `input/`:

| Màn | Mở bằng | Nội dung |
|---|---|---|
| Gallery | trang chính | Mọi ảnh (PNG/JPG/WEBP/GIF, PSD/PSB qua ảnh ghép), lọc theo thư mục / tên, xem lớn, nền caro/sáng/tối |
| Anim Spine | thẻ ▶ Anim, `#anim=<id>` | Mỗi rig Spine (JSON + atlas) chạy MỌI clip trong một lưới, chọn skin, tốc độ, lật, Back/Next |
| Frame anim | thẻ ▶ Frames, `#frames=<id>` | Chuỗi ảnh đánh số (frame-by-frame) chạy như flipbook: FPS, lặp / tới-lui / 1 lần, nghỉ trước khi lặp, từng frame |
| VFX | nút ▶ VFX, `#vfx=<id>` | Hàm hiệu ứng THẬT của game (đóng gói từ `src/`) chạy lặp trong Phaser |

Bản mẫu: Game-13 (PA0008), 2026-11. v2: nghỉ trước khi lặp ở màn Frame anim. Layout theo `anim_preview.html` của Game-12.

## Tệp

| Tệp | Vai trò |
|---|---|
| `build_preview.py` | Quét, tạo thumbnail, tìm rig Spine / chuỗi frame, ghi `index.html`. Cần Pillow; `psd-tools` cho PSB |
| `template.html` | Giao diện cả 4 màn (một tệp, không thư viện ngoài) |
| `build_vfx.mjs` | Đóng gói `vfx_entry.ts` của project bằng esbuild của project |
| `vfx_entry.example.ts`, `vfx_effects.example.js` | Mẫu phần VFX riêng của game (Game-13) |
| `preview.config.json` (tuỳ chọn) | `{ "title", "scan": ["assets","input"], "out": "input/_preview", "src": "src", "vfx": { "entry", "effects" } }` |

## Dùng

- **Office Desk**: Settings > 🎞 Preview asset > chọn project > **Build preview**, rồi **Mở preview**. Lần đầu Office Desk chép kit vào `<project>/.office-desk/preview/` (chỉ chép tệp còn thiếu, không ghi đè bản project đã sửa).
- **Tay**: `python .office-desk/preview/build_preview.py` (gốc project = thư mục chứa `.office-desk/`, hoặc `--root <project>`).
- Kết quả: `<project>/input/_preview/index.html` (+ `thumbs/`, `rigs/`, `vfx/`). `input/` không lên git ở template-pla, nên preview không lên git; build lại khi cần.
- Bật màn VFX: chép hai tệp mẫu thành `vfx_entry.ts` và `vfx_effects.js` cạnh `build_preview.py`, sửa theo game (mục VFX bên dưới). Không có hai tệp đó thì nút ▶ VFX ẩn.
- Sửa kit cho nhu cầu riêng thì sửa bản trong project. Bản trong Office Desk chỉ sửa khi có bug hoặc nâng cấp dùng chung (tăng `version` trong `kit.json`).

## Quy ước khi xây preview anim / VFX

### 1. Preview phải giống game, không phải "gần giống"
- Dùng **runtime của chính project**, đúng version game đang dùng: Spine = `node_modules/@esotericsoftware/spine-webgl` (cùng version với `spine-phaser` của game), Phaser = `node_modules/phaser/dist/phaser.min.js`. Không lấy runtime từ CDN hay version khác.
- VFX chạy **hàm hiệu ứng của game** (import từ `src/`), không viết lại hiệu ứng trong preview. Tham số gọi lấy theo chỗ game gọi (ví dụ `speedText(s, x, y - 150)` như `upgrades.ts`). Ảnh/Spine lấy từ `src/assets.ts` qua bundle, không nạp lại bằng đường khác.
- Đối tượng làm nền cho hiệu ứng dựng **như game dựng**: cùng skin (`setSkinByName('Staff')` như `addStaff`), cùng `setData`/`preFX` (như rào trong `world.ts`).
- Thứ không phát được trong lưới (rung camera, hiệu ứng toàn màn hình, hàm kéo theo gameplay) thì **ghi rõ** trong `VFX_NOTE`, không bỏ im lặng.
- Clip/ô nào game đang dùng thì đánh dấu (viền xanh "game dùng"): `build_preview.py` dò tên clip trong chuỗi của `src/`.

### 2. Không request ra ngoài, không side-effect
- Mọi thứ nằm trong project: không CDN, không font web. Trang mở bằng `file://` vẫn chạy (dữ liệu rig là `rigs/<id>.js`, không `fetch`).
- SDK quảng cáo và tracking bị thay bằng stub rỗng khi đóng gói VFX (`build_vfx.mjs`): preview không bao giờ gửi `store_trigger`/`start`/`end` lên collector.

### 3. Spine
- Mỗi rig = một ô lớn chứa **mọi clip**, ô có tên clip + thời gian; bấm ô để xem riêng. Rig của `assets/` (game dùng) là nút ở hàng đầu; rig nguồn của `input/` nằm trong danh sách chia theo thư mục, có **◀ Back / Next ▶ + `n / tổng`**, phím ← →.
- Bản xuất **Spine 4.3** chạy bằng runtime 4.2 nhờ đổi JSON lúc build, mỗi thay đổi được ghi vào dòng ghi chú của rig:
  - linked mesh `source` → `parent`; path constraint `slot` → `target`; `constraints` 4.3 tách thành `ik` / `path` / `transform` (giữ thứ tự bằng `order`);
  - transform constraint 4.3 dạng đơn giản (mỗi thuộc tính → chính nó, không offset/scale) đổi sang dạng 4.2 (bỏ `max`);
  - transform constraint 4.3 phức tạp, slider, physics 4.3: **bỏ**, và xoá tên khỏi **skin** và **timeline** (nếu không runtime 4.2 báo "Couldn't find … constraint").
  Rig có constraint bị bỏ thì ghi chú "chuyển động có thể lệch"; muốn đúng 100% cần runtime 4.3.
- JSON chỉ có `animations` nằm cạnh rig (vd `zombie_death.json`) được gộp clip vào rig, như game làm.
- **Skin**:
  - skin chia thư mục (`gun/…`, `hat/…`, `shirt/…`) là phần **ghép**: mỗi thư mục một ô chọn, mặc định skin có chữ `default`, có "(không)";
  - skin rất nhỏ (≤ 1/4 số slot của skin lớn nhất, vd `Mix_Stock_Bag` 1 slot) là **phụ kiện**: ô "Phụ kiện" riêng, mặc định "(không)";
  - còn lại: một ô Skin, chọn một.
- Dữ liệu mỗi rig nằm trong `rigs/<id>.js?v=<crc>` và chỉ nạp khi mở; `index.html` giữ nhẹ (dưới ~2 MB) dù `input/` có hàng chục MB Spine.

### 4. Frame anim (frame-by-frame)
- Chuỗi = ảnh cùng thư mục, cùng tên, khác số cuối, từ 3 ảnh: `Comp 1_00001.png … Comp 1_00007.png`, `muzzle/0.png … 5.png`.
- Được coi là **anim/VFX** (có thẻ ▶ Frames ở Gallery) khi số có số 0 đệm hoặc thư mục/tên có `fx, vfx, anim, effect, muzzle, explo, smoke, spark, fire, flash, hit, frame, seq`. Ảnh đánh số khác (tier đồ, tile, screenshot) vẫn xem được ở bộ lọc Frame anim, gắn nhãn "ảnh đánh số".
- Frame khác cỡ (đã cắt viền) được căn giữa, có thể lệch so với lúc dựng → trang ghi chú.
- **Nghỉ trước khi lặp** (mặc định 1 s, chọn 0 / 0.5 / 1 / 2 s hoặc nhập số): fx ghép từ list sprite chạy hết một lượt, sân khấu trống trong lúc nghỉ (như fx đã tắt trong game) rồi mới chạy lại; Tới-lui nghỉ sau mỗi vòng đi-về. Giá trị nhớ theo trình duyệt (localStorage).
- **Gửi Art/VFX**: xuất frame `ten_0001.png`, `ten_0002.png`… (số đệm), **cùng cỡ canvas, không trim**, một thư mục một anim, để preview và game khớp vị trí.

### 5. VFX (`vfx_entry.ts` + `vfx_effects.js` của project)
- `vfx_entry.ts`: import hàm hiệu ứng + hằng số game cần, `IMAGES`/`SPINES` của `src/assets.ts`, `SpinePlugin` nếu game dùng Spine, gán `window.GAME_FX = {…}`. Trang tự gọi `makeTextures(s)` và `registerSpineData(s)` nếu có.
- `vfx_effects.js`: đặt `VFX_SOURCE`, `VFX_NOTE`, `VFX_IMAGES` (khoá của `FX.IMAGES` cần nạp), `EFFECTS = [{ id, name, src, note, every, setup?, moved?, play }]`. Mỗi ô gọi `play(s, c)` mỗi `every` ms tại tâm ô `c.x, c.y` (px world); `setup` dựng đối tượng nền một lần, trả mảng để trang dời theo ô.
- Game thêm / đổi tên hàm hiệu ứng → sửa hai tệp này trong project. Build mà bundle hỏng thì nút VFX vẫn có, màn VFX báo "Không đóng gói được" và log build ghi lỗi esbuild.
- Hàm game đọc thứ chỉ scene thật có (vd `s.moneyIcon`) thì giả lập tối thiểu trong `play` (xem ô `coinFly` của mẫu), không sửa code game.

### 6. Layout (theo Game-12)
- Nền tím đậm `#15102a`, panel `#241a44`, nút đang chọn hồng `#ff4fd8`, "game dùng" xanh `#4fe3a0`.
- Hàng 1: tiêu đề + nút rig/mục đang dùng + `✕ Về gallery` (Esc). Hàng 2: danh sách nguồn + Back/Next + `n / tổng`. Hàng 3: điều khiển (skin, lọc, tốc độ/FPS, lật, dừng, chạy lại, cỡ, nền). Dưới: dòng ghi chú (đường dẫn, version, dung lượng, những gì preview đã đổi). Còn lại: sân khấu.
- Link sâu bằng hash (`#anim=`, `#frames=`, `#vfx=`) để gửi đúng chỗ cho người khác.

### 7. Kiểm trước khi báo xong
1. Log build: `0 unreadable`, `game VFX ok` (nếu project có VFX), không có dòng `!`.
2. Mở trang với `?raf=timer` (tab ẩn vẫn chạy). Kiểm **mọi rig × mọi skin/tổ hợp × mọi clip**: tua vài thời điểm và tính đỉnh mọi attachment (`window.__ap.datas` có dữ liệu đã nạp). Vòng lặp kiểm phải **chờ đúng rig vừa mở** (ghi chú hiện đúng đường dẫn) — đọc lưới của rig trước là báo đạt sai.
3. Dò "thiếu phần": slot có attachment setup mà skin mặc định không có → phân biệt phụ kiện của biến thể khác / attachment không có trong file xuất / lỗi chọn skin của preview.
4. Màn VFX: mọi ô chạy, không có dòng "Lỗi:" dưới ô, console không lỗi.
5. Chụp màn hình từng màn đã sửa gửi người dùng.
