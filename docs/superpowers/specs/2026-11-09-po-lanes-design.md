# Nhánh song song do PO chia (lanes)

Ngày: 2026-11-09 · Trạng thái: chờ duyệt

## Mục tiêu

Một session bắt đầu bằng khối PO. PO chia mốc thành 2–4 **nhánh** theo mảng nội dung (vd. Hero, Enemy, UI, Map). Mỗi nhánh có chuỗi khối riêng (vd. Art → Anim → Dev), thư mục tệp riêng và page Penpot riêng. Các nhánh chạy song song, không đụng tệp hay board của nhau. Nhánh nào xong thì được QA và Art Director review ngay; lỗi chỉ quay về khối của nhánh đó. Lead review cuối chạy khi mọi nhánh đạt.

Mốc không khai báo nhánh chạy y như hiện tại.

## Ngoài phạm vi

- QA hoặc Art Director kiểm nhiều nhánh cùng lúc (cần nhiều khối QA/Art Director). Lượt kiểm của các nhánh xếp hàng trên một khối.
- Giao diện tạo/sửa nhánh bằng tay không qua PO.
- Khối dùng chung cho nhiều nhánh. Mỗi khối làm việc thuộc đúng một nhánh.
- Session con.

## 1. Kế hoạch PO và dữ liệu nhánh

### Định dạng

Mỗi mốc trong khối ```` ```team ```` của PO có thêm `lanes` (tuỳ chọn):

```json
"lanes": [
  { "name": "Hero",  "blocks": ["Art", "Anim", "Dev"],          "files": ["Assets/_Art/hero/", "Assets/Scripts/Hero/"],   "penpot": "Hero" },
  { "name": "Enemy", "blocks": ["Art #2", "Anim #2", "Dev #2"], "files": ["Assets/_Art/enemy/", "Assets/Scripts/Enemy/"], "penpot": "Enemy" }
]
```

- `name`: tên nhánh, 1–40 ký tự, không trùng trong mốc. Dùng trong id nút, nhãn sơ đồ và nhãn issue.
- `blocks`: nhãn khối theo thứ tự chạy trong nhánh, cùng cách đánh số với `blocks` của mốc (`po.labelsOf`: "Art", "Art #2"…).
- `files`: thư mục/tệp gốc của nhánh, cùng quy tắc đường dẫn với `files` của task (`workers.validFile`).
- `penpot`: tên page Penpot của nhánh (tuỳ chọn).

### Kiểm tra (`po.parsePlan`)

Kế hoạch bị từ chối, kèm lý do để PO sửa, khi:

1. `lanes` có mà không phải mảng 2–4 nhánh (`LANE_LIMIT = 4`).
2. Tên nhánh trống, quá dài hoặc trùng.
3. Khối trong `blocks` của nhánh không có trong `blocks` của mốc, hoặc không phải loại làm việc (`isDevType`: Dev, VFX, Art, Anim, Sound).
4. Một khối nằm ở hai nhánh, hoặc có khối làm việc của mốc không thuộc nhánh nào.
5. `files` của nhánh trống, hoặc chồng với `files` của nhánh khác (`permissions.scopesOverlap` trên đường dẫn đã resolve).
6. Hai nhánh cùng `penpot`.

Kiểm tra đường dẫn cần thư mục của session, mà `parsePlan` là hàm thuần. Vì vậy `parsePlan` chỉ kiểm cấu trúc (1–4, 6). Kiểm `files` (5) chạy lúc áp kế hoạch trong main.cjs với `thread.folder`, lỗi báo về PO như lỗi kế hoạch.

### Lưu trữ

- Kế hoạch đã duyệt giữ `lanes` trong từng mốc.
- Khi áp một mốc (`changesAt`/áp mốc trong main.cjs), app ghi `thread.lanes` = nhánh của mốc đó (hoặc xoá nếu mốc không có nhánh) rồi dựng lại sơ đồ mặc định.
- `planMarkdown` thêm bảng nhánh của mốc vào PO.md: tên, khối, thư mục, page Penpot.

## 2. Sơ đồ

### Nút theo nhánh

Nút có thêm thuộc tính `lane` (tên nhánh). Id: `<id thường>~<nhánh>`, vd. `QA~Hero`, `Lead Dev@triage~Hero`, `Art Director@review~Hero`. Các nút này là nhiều nút của cùng một khối QA, Lead, Art Director.

`flowgraph.validate` nhận nút có `lane` khi khối là QA, Lead Dev (pha triage) hoặc Art Director (pha review) và tên nhánh có trong `thread.lanes`. `nodeLabel` hiện "QA · Hero", "Lead Dev · triage · Hero".

### Sơ đồ mặc định khi có `thread.lanes`

```
PO → GD → UI/UX → Art Director·lập KH → Lead·lập KH ─┬→ [Hero]  Art → Anim → Dev ─────→ QA~Hero   + AD review~Hero  ─┐
                                                     ├→ [Enemy] Art #2 → Anim #2 → Dev #2 → QA~Enemy + AD review~Enemy ─┤→ Lead·review → Release → Hoàn tất
                                                     └→ …                                                                 ┘
```

Cạnh (điều kiện mặc định `done` trừ khi ghi khác):

- Lead·lập KH → khối đầu của mỗi nhánh. Không có Lead thì nút trước đó nối vào khối đầu.
- Trong nhánh: khối i → khối i+1.
- Khối cuối của nhánh k → QA~k và AD review~k.
- QA~k `issue` → Lead·triage~k (không có Lead: → mọi khối của nhánh k).
- Lead·triage~k → mọi khối của nhánh k.
- AD review~k `reject` → Art/Anim của nhánh k. AD review~k `issue` → Lead·triage~k.
- Khối dùng ảnh (`ART_CONSUMER_TYPES`) của nhánh k `reject` → AD review~k.
- Mọi QA~k và AD review~k `pass` → Lead·review. Engine chỉ chạy nút khi không còn nút nối vào đang chờ/chạy, nên Lead·review tự chờ đủ các nhánh.
- Lead·review `reject` → mọi khối của mọi nhánh.
- Release `issue` → Lead·triage (nút thường, không gắn nhánh) → mọi khối của mọi nhánh. Issue của Release và issue bạn tự báo không thuộc nhánh nào. Lúc này mọi nhánh đều đã dừng, nên nối tới mọi khối không đụng nhánh đang chạy; nhánh không được giao task thì tự đạt theo luật bỏ qua (mục 3).
- Khối không thuộc loại nào ở trên (khối tuỳ chỉnh) giữ cách nối hiện tại, đặt sau Lead·review.

Sơ đồ bạn đã sửa tay (`graph.custom`) không bị dựng lại khi đổi mốc, như hiện tại.

## 3. Chạy, kiểm và sửa theo nhánh

### Nút đang chạy của một khối

QA, Lead, Art Director có nhiều nút. Lúc `startNode` gửi lượt, pipeline ghi `thread.nodeRunning[label] = node.id`. Bàn giao của khối kết thúc đúng nút đó thay cho cách tìm theo nhãn/pha hiện tại, rồi xoá mục. Mở lại app (`recoverRunning`) thì xoá `nodeRunning`.

Một khối chỉ chạy một lượt mỗi lúc. QA~Enemy được kích hoạt khi QA đang chạy cho Hero thì nằm chờ (`startNode` gặp `isRunning` sẽ return) và chạy ở lần `advance` sau.

### Luật bỏ qua

- **QA~k, AD review~k:** khi được kích hoạt mà mọi khối của nhánh k kết thúc lần gần nhất với `skipped`, nút kết thúc `pass` mà không chạy, log "nhánh k không đổi · bỏ qua".
- **Lead·triage~k:** bỏ qua (`skipped`) khi ISSUES.md không có issue mở gắn nhánh k.

### Nhãn issue và phạm vi kiểm

- Prompt của QA~k và AD review~k ghi: chỉ kiểm nhánh k (khối, thư mục, mục CHANGES.md của các khối đó).
- Issue do app tạo từ bàn giao `issue` (`team.reportIssue`). Khi bàn giao đến từ nút có `lane`, app gắn `lane: <tên>` vào issue và thêm tiền tố `[Nhánh <tên>]` vào text. Không dựa vào model tự ghi nhãn.
- Đếm issue mở theo nhánh: `workers.openIssues(thread).filter(issue => issue.lane === k)`.
- Prompt Lead·triage~k chỉ đưa issue của nhánh k, và chỉ cho giao task cho khối của nhánh k. Kế hoạch giao khối nhánh khác bị từ chối.
- Lead·triage thường (không nhánh) nhận issue không gắn nhánh và được giao cho khối của mọi nhánh, vẫn theo luật thư mục của từng nhánh (mục 4).

### Giới hạn vòng sửa

`thread.qaFailRounds` và số lần Art Director trả về của vòng tính theo nhánh khi có nhánh (`thread.laneRounds[<tên>] = { qaFail, adRejects }`), cùng giới hạn hiện tại (`QA_ROUND_LIMIT`, tối đa 2 lần trả về mỗi vòng). Nhánh chạm giới hạn thì nút của nhánh đó bị chặn chờ bạn. Nhánh khác vẫn chạy; Lead·review chưa chạy vì còn nút nối vào bị chặn. `resetRound` xoá `laneRounds`.

## 4. Chặn đụng nhau

### Tệp

`workers.taskPlan` (Lead lập KH, Art Director lập KH, Lead triage): khi session có `thread.lanes`, task giao cho khối thuộc nhánh k phải có mọi `files` nằm trong `files` của nhánh k (`permissions.inScope`). Ngược lại kế hoạch bị từ chối: `"<khối> thuộc nhánh <k>: tệp <x> ngoài thư mục của nhánh (<danh sách>)"`. Kiểm chồng tệp giữa các task giữ nguyên.

### Penpot

- `penpot.guide` nhận thêm nhánh của khối: "Bạn thuộc nhánh <k>: chỉ tạo/sửa board ART-… trên page Penpot "<penpot>"; mở page đó trước khi tạo shape."
- Khoá theo chuỗi gọi Penpot và luật mở đúng page (thay đổi trên nhánh `penpot-per-call-lock`) lo phần tab dùng chung. Spec này dựa trên thay đổi đó.

### Prompt

- **PO (`po.guide`):** định dạng `lanes` và khi nào dùng (mảng nội dung tách rời; 2–4 nhánh; mỗi nhánh khối riêng, theo thứ tự chạy; thư mục không chồng; mỗi nhánh một page Penpot nếu dùng Penpot). Nhắc trần 8 phiên: mỗi nhánh chỉ một khối chạy mỗi lúc.
- **Art Director và Lead lập KH:** bảng nhánh; task của khối trong nhánh chỉ nằm trong thư mục nhánh; thứ tự trong nhánh do sơ đồ lo, không cần `dependsOn` giữa các khối của một nhánh.
- **Khối trong nhánh:** tên nhánh, thư mục, page Penpot của mình.
- **QA~k, AD review~k, Lead·triage~k:** như mục 3.
- **Lead·review:** xét mọi nhánh.

## 5. Test

- `po.test`: `lanes` hợp lệ được giữ và ghi vào PO.md; từng lỗi ở mục 1 bị từ chối kèm lý do.
- `flowgraph.test`:
  - sơ đồ mặc định có làn đúng như mục 2;
  - QA~Hero chạy khi nhánh Hero xong dù nhánh Enemy đang chạy;
  - Lead·review chỉ chạy khi mọi QA~k và AD review~k pass;
  - `validate` nhận và từ chối nút theo nhánh đúng luật.
- `pipeline.test`:
  - bàn giao của QA kết thúc đúng nút trong `nodeRunning`;
  - QA~k tự pass khi nhánh k bị bỏ qua;
  - issue nhánh Enemy chỉ chạy lại khối nhánh Enemy;
  - Lead·triage~k bỏ qua khi không có issue của nhánh;
  - issue từ QA~k được gắn `lane`; issue của Release không gắn và đi qua Lead·triage thường;
  - giới hạn vòng tính theo nhánh, nhánh chạm giới hạn không chặn nhánh khác.
- `workers.test`: task có tệp ngoài nhánh bị từ chối; task trong nhánh được nhận.
- `prompt.test` / `penpot.test`: các prompt ở mục 4 có thông tin nhánh.
- Toàn bộ test hiện có vẫn đạt (mốc không có nhánh không đổi hành vi).
