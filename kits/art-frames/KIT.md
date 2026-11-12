# Kit art-frames (Office Desk)

Dựng animation từng frame từ sheet **key pose** do model ảnh vẽ (ChatGPT, Codex): tách nền, cắt key, canh frame, bù frame giữa, đo và xuất. Một lệnh, cùng tham số cho mọi frame của clip, nên viền không nhấp nháy và chân không rung giữa các frame.

## Dùng để làm gì
- `frames.py`: khối **Art** dùng khi project chưa có script nội suy riêng (luật "quy trình frame" trong prompt của Art).
- `scene.py`: khối **Art** và **Art Director** đo cảnh so với ref khi đổi skin, convert, thay asset (xem mục cuối).
- Model ảnh chỉ vẽ ổn vài key pose, thường sai nền (nền màu, ô caro vẽ giả). Kit tách nền, canh mọi key về một canvas theo đường chân, rồi bù frame giữa những cặp key đủ gần.
- Cặp key quá xa thì kit **không** cố nội suy (ra bóng ma, viền đôi): giữ frame và báo "nên sinh thêm key giữa X và Y".

## Office Desk chép vào project thế nào
- Trước lượt của khối Art (mọi chế độ sinh ảnh) và Art Director, Office Desk chép `frames.py`, `comfy.py`, `scene.py`, `KIT.md` vào `<project>/.office-desk/art/` và ghi `kit.json` (version đã chép). Tệp đã có không bị ghi đè.
- Bản trong project thuộc về project: cần sửa cho đặc thù project thì sửa ở đó. Bản gốc `kits/art-frames/` của Office Desk chỉ sửa khi có lỗi hoặc nâng cấp; kit nâng version thì Office Desk báo trong prompt của Art.

## Yêu cầu
- Python 3.8+ với `numpy` và `Pillow` (bắt buộc): `python -m pip install numpy pillow`.
- `opencv-python` (tuỳ chọn) để nội suy bằng optical flow: `python -m pip install opencv-python`.
- **RIFE** (tuỳ chọn, `rife-ncnn-vulkan`, AI chạy GPU qua Vulkan, không cần Python):
  - Cài ở Office Desk: **Settings > Plugins** (nút ⚙ cạnh menu tài khoản), hoặc trả lời "Cài RIFE" khi Office Desk hỏi. App hỏi một lần mỗi lần mở; chọn "Không lúc này" thì không hỏi lại tới khi mở lại app.
  - App tải khoảng 430 MB từ GitHub (nihui/rife-ncnn-vulkan) vào `<thư mục dữ liệu Office Desk>/tools/rife/`. Cài một lần cho cả máy, chỉ giữ model `rife-v4.6` và `rife-v4`.
  - Office Desk ghi đường dẫn vào `kit.json` của project, nên kit tự dùng.
  - Dùng RIFE ngoài Office Desk: truyền `--rife <exe>` (và `--rife-model <thư mục model>`), hoặc đặt biến `RIFE_NCNN_VULKAN`.
- Không có cả RIFE lẫn cv2 thì mọi cặp key chỉ được giữ frame (chỉnh nhịp), report ghi rõ.

## Chạy
```bash
# Sheet lưới 4 cột x 1 hàng, clip lặp, 1 frame bù giữa mỗi cặp key, 8 fps
python .office-desk/art/frames.py run --sheet "<ảnh sheet>" --grid 4x1 --loop --between 1 --fps 8 --out .office-desk/tmp/anim-idle

# Không có lưới đều: bỏ --grid, kit tự dò từng pose (xếp theo hàng rồi cột); --count lấy N pose đầu
python .office-desk/art/frames.py run --sheet "<ảnh sheet>" --count 6 --out .office-desk/tmp/anim-attack

# Key đã tách sẵn thành từng tệp (key_01.png, key_02.png… xếp theo tên)
python .office-desk/art/frames.py run --keys-dir .office-desk/tmp/keys --out .office-desk/tmp/anim-run
```
`<ảnh sheet>` có thể là ảnh ngay trong thư mục ảnh của Codex (`~/.codex/generated_images/…`): kit chỉ đọc ảnh đó, kết quả ghi vào `--out`.

## Kết quả (`--out`)
- `frames/frame_###.png`: từng frame trong suốt, cùng canvas, cùng đường chân.
- `sheet.png`: sprite sheet trong suốt (`--cols`, mặc định tối đa 8 cột).
- `contact.png`: các frame trên nền caro, đánh số, `K` là key. Read ảnh này để tự xem.
- `preview.gif`: xem chuyển động (nền caro, chỉ để xem, không dùng trong game).
- `report.md`, `report.json`: kết luận **ĐẠT / CẦN XEM**, cách tách nền, canvas, cách bù từng cặp key, các điểm cần xem.

## Các bước và tham số
1. **Tách nền** (cả sheet một lần):
   - Ảnh đã trong suốt thật (>5% điểm ảnh có alpha thấp) thì chỉ dọn alpha.
   - Ngược lại, kit dò màu nền từ viền ảnh, gồm cả ô caro hai màu vẽ giả, rồi xoá vùng nền nối với mép ảnh.
   - Tham số: `--tolerance` (mặc định 40) là ngưỡng khác màu. Hình có màu gần nền (kim loại xám trên ô caro xám) bị ăn mất thì giảm ngưỡng.
   - `--bg #RRGGBB` chỉ định màu nền, lặp được nhiều lần.
   - `--erode` (mặc định 1 px) co viền để bỏ quầng nền.
   - `--holes` xoá cả vùng kín cùng màu nền, ví dụ khe giữa tay và thân.
2. **Cắt key:** `--grid CỘTxHÀNG` chia đều theo lưới, ô trống bị bỏ. Không có `--grid` thì kit tự dò từng pose. `--count N` lấy N key đầu.
3. **Canh frame:** đặt mọi key lên một canvas cố định, đường chân (đáy hình) cùng một hàng, tâm chân cùng một cột, không scale.
   - `--anchor feet` (mặc định) neo theo tâm chân; `bbox` neo theo tâm khung; `mass` neo theo trọng tâm.
   - `--canvas RỘNGxCAO` đặt canvas tối thiểu.
4. **Bù frame:** `--between N` là số frame bù giữa mỗi cặp key. `--loop` bù cả cặp key cuối → key đầu. `--easing inout` (mặc định) hoặc `linear`.
   - `--method auto` (mặc định): kit đo **quãng dịch của phần chuyển động** (p90, px, so với chiều cao nhân vật).
     - Có RIFE và dịch ≤ `--max-move-rife` (mặc định 8%): RIFE.
     - Không có RIFE, có cv2 và dịch ≤ `--max-move` (mặc định 3%): optical flow.
     - Còn lại: giữ frame và báo nên sinh thêm key giữa hai key đó.
     - RIFE lỗi (GPU, Vulkan): kit thử lại bằng CPU, vẫn lỗi thì lùi về flow hoặc giữ frame và ghi lỗi vào report.
   - `--method rife` / `flow` ép một cách. `--method hold` chỉ chỉnh nhịp.
5. **Đo:** độ đổi giữa frame kề nhau (`--jump`, mặc định 0.15), lệch chân > 2 px, frame cao lệch > 8% so với trung vị (đổi cỡ, hoặc pose cúi/nhảy cần tự xem).

## Giới hạn đã biết
- **Flow chỉ hợp chuyển động nhỏ:** thở, nhún, áo choàng, tóc, tay chân nhích ít.
  - Vật mảnh xoay xa (kiếm, cung, roi) ra viền đôi hoặc bóng ma. Kit tự chuyển sang giữ frame theo ngưỡng `--max-move`, nhưng vẫn phải xem `contact.png`.
  - Frame nội suy hơi mềm hơn key.
- **RIFE chỉ nhận ảnh RGB.** Kit chạy hai lượt cho mỗi frame giữa: màu ghép trên nền xám 128 và alpha dạng ảnh xám, rồi tách màu khỏi nền. Viền bán trong suốt có thể hơi ám xám.
- **Ngưỡng 8% của RIFE chưa được hiệu chỉnh trên RIFE thật.** Kit mới kiểm phần gọi RIFE bằng chương trình giả. Lần đầu dùng RIFE, phải xem `contact.png` và chỉnh `--max-move-rife` nếu cần.
- **RIFE và FILM học từ video quay thật**, chưa chắc giữ nét viền của tranh hoạt hình. Pose đổi hẳn thì nên sinh thêm key.
- **Tách nền theo màu**, không phải tách nền bằng AI. Nền nhiều màu hoặc có cảnh vật cần `--bg` và `--tolerance`, hoặc dùng script tách nền của project.

## ComfyUI: sinh ảnh trên máy (`comfy.py`)
Dùng khi khối Art ở chế độ sinh ảnh **ComfyUI**. Office Desk ghi `comfy.json` cạnh `comfy.py` trước mỗi lượt Art, gồm URL server ComfyUI, GPU và preset của các model đã cài (cài ở Settings > Plugins). `comfy.py` chỉ dùng thư viện chuẩn của Python.

```bash
# Server, GPU, model đã cài và tham số mặc định
python .office-desk/art/comfy.py status

# Sinh một ảnh; prompt để trong tệp (tránh lỗi nháy của shell)
python .office-desk/art/comfy.py gen --model dreamshaper-xl-lightning --prompt-file .office-desk/tmp/ART-1.txt --out .office-desk/tmp/comfy/ART-1.png

# 4 biến thể (seed tăng dần) để chọn; giữ seed đã in ra để sinh lại đúng ảnh
python .office-desk/art/comfy.py gen --model z-image-turbo --prompt-file p.txt --count 4 --out .office-desk/tmp/comfy/ART-2.png

# Pixel art (model SDXL + LoRA), anime nhanh (Lightning LoRA), phóng to
python .office-desk/art/comfy.py gen --model dreamshaper-xl-lightning --lora pixel-art-xl --prompt "pixel art, ..." --out x.png
python .office-desk/art/comfy.py gen --model animagine-xl-4 --fast --prompt-file p.txt --out y.png
python .office-desk/art/comfy.py upscale --image x.png --scale 2 --out x2.png
```

- **Prompt theo model:** model SDXL (DreamShaper, Animagine) hiểu prompt kiểu tag ngắn, ý chính đặt đầu (khoảng 75 token đầu có tác dụng nhất), có negative mặc định. Z-Image và Qwen-Image hiểu câu tự nhiên dài; Qwen-Image vẽ được chữ ngắn.
- **Tham số:** `--width/--height` (bội số của 64), `--seed`, `--steps`, `--cfg`, `--negative-file`, `--timeout` (giây). `--dry-run` chỉ in workflow JSON.
- **Chưa hỗ trợ ảnh tham chiếu** (img2img, sửa ảnh). Muốn đồng nhất nhân vật thì giữ nguyên đoạn mô tả nhân vật và style, cố định seed, chỉ đổi phần tư thế.
- **Nền:** model không ra nền trong suốt thật. Ghi "plain flat #FF00FF background" trong prompt rồi tách nền bằng `frames.py` hoặc script của project.
- Card yếu (6 GB) thì dùng model SDXL ở 1024px trở xuống. Z-Image và Qwen-Image trên card yếu chạy rất chậm.

## Đo cảnh so với ref (`scene.py`)
Sinh ra sau lỗi của PA0008 (Game-13), khi convert game bắn súng PA0015 sang theme Roadside:
- Nền mới vẽ lại làm mất các object vốn vẽ sẵn trong `BG.png` cũ: rào gỗ cạnh sau-trái, tôn, kẽm gai, bao cát, thùng phuy.
- Ảnh rào thay thế lệch 63 px so với ảnh cũ, nên rào gãy khúc và sai lớp.
- Art Director chỉ Read từng ảnh nên vẫn duyệt đạt.

Chỉ cần `numpy` + `Pillow`. Lệnh kiểm trả mã thoát 1 khi TRƯỢT.

```bash
# Liệt kê object vẽ sẵn trong ảnh nền (vùng có nét viền đậm), đánh số B1… trên ảnh --out
python .office-desk/art/scene.py baked --img <nền cũ> --out .office-desk/tmp/baked.png

# Ảnh thay thế có "thả vào là khớp" không: canvas, khung alpha, điểm cực, độ phủ, độ dốc cạnh đáy
python .office-desk/art/scene.py swap --old <ảnh cũ> --new <ảnh mới> [--tol 8]

# Các điểm đặt rào/tường/băng (world px) có thẳng hàng, đúng trục iso, không gãy
python .office-desk/art/scene.py line --points 380,760 720,595 1060,420 --slope 0.5 [--tol 4]

# Ảnh ref | game | chồng 50% | khác, có lưới toạ độ của ref
python .office-desk/art/scene.py compare --ref <ảnh chụp ref> --shot <ảnh chụp game> --out .office-desk/tmp/compare.png [--grid 100] [--crop x,y,w,h]
```

- **Bảng kiểm kê ref:** Art Director ghi ở đầu `ART.md`. Mỗi object của ảnh chụp ref và mỗi `B#` của `baked` là một dòng, ghi vị trí, tệp, lớp và thứ thay (hoặc "bỏ", kèm ai chốt).
  - Art đối chiếu `baked` của nền cũ với nền mới.
  - Art Director đi từng dòng trên ảnh `compare` khi review.
- `baked` dò theo nét viền đậm của art cartoon (`--dark`, mặc định độ sáng 90), nên vết đất và bóng không có viền sẽ không bị tính. Art không viền thì hạ `--dark` hoặc tự kiểm kê bằng mắt.
- `swap` TRƯỢT nghĩa là sửa ảnh. Không chỉnh toạ độ trong code để chữa: chỗ đặt đã khớp với ảnh cũ, các ảnh khác cũng canh theo đó.
- `line` đo **điểm đặt** (đọc từ code hoặc đo trên ảnh chụp), không đo viền sprite: cọc rào và chân bàn làm viền răng cưa nên đo viền ra số sai.
  - Độ dốc so theo trị tuyệt đối: cạnh ↗ có dy/dx âm, iso 2:1 là 0,5.
- `compare` co ảnh game về cỡ ref nếu hai ảnh khác cỡ. Muốn so toạ độ thì chụp cùng camera, cùng khung hình. % khác chỉ để tham khảo, vì đổi skin thì khác là đúng.
