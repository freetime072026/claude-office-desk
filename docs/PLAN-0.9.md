# Office Desk 0.9 — Kế hoạch kỹ thuật (Lead Dev)

- Ngày: 2026-10-31
- Nguồn: `docs/DESIGN-0.9.md` v4 (GD). AC/TC tham chiếu theo ID trong tài liệu đó.
- Đội: 1 Dev → chia **2 đợt**. Đợt 2 chỉ giao sau khi QA retest đợt 1 và Lead review đạt.
- Chưa chạy test nào khi lập kế hoạch; mọi vị trí `file:line` lấy từ code 0.8.0.

## 0. Quyết định kỹ thuật của Lead

| ID | Quyết định | Lý do |
|---|---|---|
| L-1 | **Q10:** dùng đề xuất GD: `N = 20` tin, tổng khối bối cảnh ≤ `20 000` ký tự, mỗi bàn giao ≤ `2 000` ký tự. Đặt một chỗ: `PROMPT_LIMITS` trong `prompt.cjs` | Người dùng chưa chốt số; đổi được bằng một hằng số |
| L-2 | **R1:** khi resume, **không** gửi lại lịch sử; chỉ gửi **các tin mới kể từ lượt trước của chính role đó** (delta), vẫn chịu giới hạn L-1 | Đúng D-Q1 (không lặp lịch sử), đồng thời Lead triage vẫn thấy báo cáo mới của QA. Người dùng muốn bỏ hẳn delta thì đặt `PROMPT_LIMITS.resumeDelta = 0` |
| L-3 | **A1 (revision)** để sang đợt 2; đợt 1 dùng mốc thời gian `qaPassedAt` / `finishedAt` | Đợt 1 chưa cần TestRun |
| L-4 | Pipeline chuẩn: `GD → UI/UX → Lead Dev → Dev* → QA → <role tùy chỉnh>` (Q7) | Một nguồn thứ tự duy nhất `PIPELINE` trong `workers.cjs` |
| L-5 | `removable()` đặt trong `workers.cjs` (thuần). `busy` do `main.cjs` truyền vào. UI **không** tự tính: `snapshot()` trả kèm `removal[threadId][label] = {ok, reason}` | AC-ROLE-02.9; renderer sandbox không `require` được `.cjs` |
| L-6 | `resumeKey(profileId, folder, label)` đặt trong `workers.cjs` cạnh `runKey`; `chat.cjs:33` và `main.cjs` cùng gọi | AC-PROMPT-02.5, không tính khóa ở hai nơi |
| L-7 | Cấu hình role lấy theo **một** hàm `roleContext(team, thread, label)` trong `prompt.cjs`: `thread.roleConfig[key]` → `team.roleTemplates[key]` → `defaults[key]` | Sửa GD-F3; `chat-send` và `run-thread` dùng chung |
| L-8 | `run-thread` (terminal) luôn `resumed = false` vì mỗi lần dùng `--session-id` mới | Đúng hành vi hiện tại của `main.cjs:165` |

## 1. Đợt 1 (giao ngay) — Nhóm A, B, US-ROLE-04, US-LOOP-01 tối thiểu

### 1.1 Phạm vi file

| File | Thay đổi |
|---|---|
| `workers.cjs` | `PIPELINE`, `orderOf(label)`, `addWorker` chèn đúng vị trí và giữ `flow[stage]`; chặn Lead Dev thứ hai; `forgetWorker(thread, label)` xóa `workers[label]`, khóa `cliSessions` kết thúc bằng `:<label>`, mục `taskDrafts` của label; `resumeKey()`; `removable(thread, label, { busy })` theo DESIGN §8.1 |
| `roles.cjs` | `roleKey` vẫn đọc `Lead Planning`/`Lead Review` → `Lead Dev` (AC-ROLE-04.4), không nơi nào sinh nhãn cũ |
| `team.cjs` | `add-worker` ghi log `Đã thêm <label>`; `remove-role` gọi `removable()` → từ chối không đổi dữ liệu, hoặc `forgetWorker` + giữ stage (chỉ giảm 1 nếu xóa trước stage) + log `Đã xóa <label> (đã pass \| không có việc)`, **không** reset status, **không** mở lại Issue; `select-roles`/`assign-role` chỉ tạo `Lead Dev` và sắp theo `PIPELINE`; `migrateThread(thread)` (AC-ROLE-04.3); vòng lặp §1.2 |
| `prompt.cjs` (mới) | `PROMPT_LIMITS`, `roleContext()`, `buildPrompt({...}) → { text, omitted }` theo DESIGN §8.2; thuần, không Electron, không đọc file |
| `chat.cjs` | Dùng `resumeKey()` thay cho chuỗi tự ghép ở dòng 33 |
| `main.cjs` | Gọi `migrateThread` lúc load (cạnh dòng 76); `chat-send` và `run-thread` gọi `roleContext` + `buildPrompt` (thay dòng 122–125, 162–164); truyền `busy` cho `remove-role`; `snapshot()` thêm `removal`; gộp kiểm tra chồng thư mục bị lặp ở dòng 116 và 118 thành một hàm `editOverlap(thread)` |
| `team-ui.js` | Nút × theo `removal` (disabled + tooltip lý do), hộp xác nhận theo DESIGN §8.1; ẩn `+ Lead Dev` khi đã có; nhãn pha Lead + `n/3`; banner `awaiting-decision` + 3 nút quyết định; bỏ các tham chiếu `Lead Planning`/`Lead Review` ở dòng 104, 107, 171 |
| `tests/workers.test.cjs` | Sửa kỳ vọng dòng 3 thành thứ tự pipeline; thêm test `removable`, `forgetWorker`, `resumeKey`, chèn giữ stage |
| `tests/team.test.cjs` | Sửa test dòng 6–14 sang flow `GD, Lead Dev, Dev, QA`; thêm test vòng lặp, migration, add/remove |
| `tests/prompt.test.cjs` (mới) | TC-PROMPT-01..04 dạng unit |
| `tests/ui-smoke.cjs` | Dòng 15 dùng `Lead Dev` thay hai nhãn cũ |
| `package.json` | `check` thêm `workers.cjs`, `prompt.cjs`, `chat.cjs`, `roles.cjs` |
| `README.md` | Dòng 65, 87: mô tả một khối Lead Dev và vòng QA → Lead Dev/Dev |

### 1.2 Vòng lặp tối thiểu (US-LOOP-01, phần không cần Report)

Trường mới trên thread: `leadPhase` (`planning` / `triage` / `review`), `qaFailRounds` (số), `qaPassedAt` (ISO). Trường mới trên dispatch: `finishedAt` (ghi khi chuyển `finished`, `main.cjs:132`).

| Hành động | Hiệu ứng |
|---|---|
| `issue` | `qaFailRounds++`. Nếu `< 3`: `stage = indexOf('Lead Dev')` (không có Lead thì giữ ở Dev đầu tiên, log `Không có Lead Dev`), `leadPhase = 'triage'`, `status = 'waiting'`. Nếu `= 3`: `status = 'awaiting-decision'`, không đổi stage, dispatch không pump |
| `handoff` tại QA | Gate cũ giữ nguyên. Thành công: `qaPassedAt = now`, `qaFailRounds = 0`, về Lead Dev với `leadPhase = 'review'` (không có Lead → `done`) |
| `handoff` tại Lead Dev, `leadPhase = 'review'` | `status = 'done'` |
| `handoff` tại Lead Dev, pha khác | Sang stage kế tiếp như cũ |
| `review-reject` (mới) | Chỉ khi Lead Dev đang `working` pha review; bắt buộc `text`; về Dev đầu tiên, `leadPhase = 'planning'`, **không** tăng `qaFailRounds` |
| `decision` (mới) | Chỉ khi `awaiting-decision`. `continue` → như `issue` vòng thường (cho thêm đúng 1 vòng: hạ `qaFailRounds` về 2); `accept` → Lead review, Issue giữ mở có `accepted: true`, gate QA bỏ qua Issue `accepted`; `stop` → `status = 'cancelled'`. Mỗi lựa chọn ghi log |

`pumpThread` (`main.cjs:87`) không chạy khi `status` là `awaiting-decision` hoặc `cancelled`.

### 1.3 Quy tắc "Dev đã pass" (D-A3) cho `removable`

Dev đã pass khi: dispatch của Dev ở `finished` **và** `qaPassedAt > finishedAt` **và** không còn Issue chưa đóng (trừ `accepted`). Các loại khác theo bảng DESIGN §8.1.

### 1.4 AC đợt 1

AC-ROLE-01.1–01.4, AC-ROLE-02.1–02.9, AC-ROLE-03.1–03.3, AC-ROLE-04.1–04.4, AC-LOOP-01.1–01.4, 01.6 (trừ phần Report), 01.7, AC-PROMPT-01.1–01.3, AC-PROMPT-02.1–02.6, AC-REVIEW-01.1 (checklist trong prompt).

Điều kiện xong:
- `npm.cmd run check` và `npm.cmd test` đạt; dán output thật vào mô tả bàn giao.
- Không còn chuỗi `Lead Planning`/`Lead Review` ngoài `roleKey` (đọc dữ liệu cũ), `migrateThread` và test migration.
- Không còn logic lặp giữa `chat-send` và `run-thread` khi dựng prompt; không còn chỗ thứ hai tự ghép khóa resume.
- Mỗi AC ở trên có ít nhất một test, hoặc ghi rõ "kiểm bằng UI smoke / thủ công".

## 2. Đợt 2 (giao sau khi đợt 1 qua QA và review)

Nhóm C và phần còn lại của LOOP/REVIEW: Issue đầy đủ + migration (US-QA-01), TestRun + revision + invalidated (US-QA-02, cần chốt A1), nhãn công cụ theo mode (US-QA-03), Report §8.5 + gate (AC-LOOP-01.5, US-QA-04), gate checklist review (AC-REVIEW-01.2, 01.4), Q3 chỉ mở lại Issue theo owner. Sau đó nhóm D (`VALIDATION.md`, `TEAM-WORKFLOW.md`).

## 2b. Review đợt 1 (Lead, 2026-10-31, đọc code, chưa chạy test)

Kết luận: **chưa đạt**, trả về Dev sửa R1–R5 trước khi QA chạy.

| ID | Mức | Vị trí | Vấn đề | Yêu cầu sửa |
|---|---|---|---|---|
| R1 | High | `team.cjs:58-65` | `select-roles` bỏ role khỏi flow mà không qua `removable()` và không `forgetWorker` → vẫn xóa được role đang chạy (trái D-Q3) và thêm lại qua `select-roles` nhận worker/phiên CLI cũ (ISSUE-01, GD-F6) | Role bị bỏ = flow cũ − flow mới; mỗi role phải `removable().ok`, nếu không thì từ chối toàn bộ, dữ liệu không đổi; thành công thì `forgetWorker` từng role |
| R2 | Medium | `main.cjs:17`, `main.cjs:173` | Tính `busy` lặp hai nơi; `select-roles` không nhận được `busy` | Một hàm `busyLabels(thread)` trong `main.cjs`; `payload.busy` là mảng nhãn cho cả `remove-role` và `select-roles`; `removable(thread, label, { busy: boolean })` giữ nguyên chữ ký |
| R3 | Medium | `workers.cjs:37` vs `prompt.cjs:37`; `workers.cjs:14` vs `team.cjs:67` | Duplicate logic: (a) nhận diện tin của một role; (b) so khớp khóa `cliSessions` theo nhãn | Export `authoredBy(message, label)` và `ownsSession(key, label)` từ `workers.cjs`, dùng lại ở `prompt.cjs` và `migrateThread` |
| R4 | Low | `main.cjs:96`, `main.cjs:137` | Lặp mảng trạng thái dispatch đang hoạt động, đã có `ACTIVE_TASK` | Export `ACTIVE_TASK`, dùng ở `main.cjs` |
| R5 | Medium | `team.cjs:20` (`handoff`), `workers.cjs:52` (`passed`) | Role tùy chỉnh sau QA không bao giờ chạy (Dev lệch #1) | **Quyết định:** QA cuối pass → ghi `qaPassedAt`, chạy lần lượt các role sau QA, role cuối bàn giao thì về Lead review (không có Lead → `done`). `passed()` của role tùy chỉnh: `done` hoặc `indexOf < stage` hoặc (`qaPassedAt` và `leadPhase === 'review'`) |
| R6 | Low | `team.cjs:78` | Migrate session đang ở `Lead Review` không có `qaPassedAt` → QA không xóa được tới khi `done` | Khi `active === 'Lead Review'` thì đặt `qaPassedAt` nếu chưa có |

Quyết định cho các điểm lệch Dev nêu:
- #2 (chèn role khi chưa bắt đầu), #3 (Dev pass khi `done`), #5 (chữ ký `buildPrompt` + `rolePrompt`), #6, #7: **chấp nhận**.
- #4 (resume không gửi lại roleConfig/flow khi đổi): **chuyển đợt 2**, ghi là khoảng trống đã biết của AC-PROMPT-02.2.
- #8 (README:89, `TEAM-WORKFLOW.md:19`): đợt 2, nhóm D.
- Ghi nhận cho đợt 2: `team-ui.js:106` gán `#role.onclick` rồi bị `team-ui.js:201` ghi đè, nên hộp chọn role `select-roles` là code chết trên UI (có từ 0.8). Đợt 2 cần quyết định xóa hay nối lại.

## 2c. Review vòng 2 — R1–R6 (Lead, 2026-10-31, đọc code, chưa chạy test)

Kết luận code review: **đạt** cho R1–R6. **Chưa** chuyển Done, **chưa** giao đợt 2: QA bàn giao ("Tiếp") không kèm TestRun hay output; chưa ai chạy `npm.cmd run check` / `npm.cmd test` / ui-smoke cho đợt 1.

| ID | Kết quả | Bằng chứng (đọc code) |
|---|---|---|
| R1 | Đạt | `team.cjs:57-80`: `dropRole` dùng chung cho `remove-role` và `select-roles`; `dropRoles` chạy thử trên bản sao trước |
| R2 | Đạt | `main.cjs:18` `busyLabels` là chỗ duy nhất gọi `chats.has(runKey(...))`; dùng ở `main.cjs:19` và `main.cjs:175` |
| R3 | Đạt | `workers.cjs:15-16`; dùng lại ở `prompt.cjs:37`, `team.cjs:82`, `workers.cjs:20,39` |
| R4 | Đạt | `ACTIVE_TASK` dùng ở `main.cjs:98,139`, `workers.cjs:34` |
| R5 | Đạt | `team.cjs:17-26` |
| R6 | Đạt | `team.cjs:94` |

Điểm lệch Dev nêu (thứ tự bỏ role ngược pipeline; QA chưa tính pass khi role sau QA đang chạy; `select-roles` bị từ chối thì không reset): **chấp nhận**.

Ghi nhận thêm cho đợt 2 (không chặn):
- R7 (Low): `selectRoles` không `forgetWorker` cho role **được thêm lại** qua chính nó. Dữ liệu cũ từ 0.8 (role bị xóa bằng code cũ, ví dụ UI/UX của session này) vẫn còn `workers`/`cliSessions` cũ, nên chọn lại qua `select-roles` sẽ nhận cấu hình cũ. `add-worker` không bị lỗi này.

## 3. Rủi ro

| Rủi ro | Xử lý |
|---|---|
| Session đang chạy (session này) vẫn có dữ liệu cũ | `migrateThread` chạy lúc load; TC-MIG-01 |
| `main.cjs` gọi `update` hai lần (bản clone rồi bản thật, dòng 172) | `busy` phải đưa vào `payload` trước cả hai lần gọi |
| Chưa có quyền shell cho QA | QA cần mode có shell, hoặc người dùng tự chạy lệnh và dán output; không có thì kết quả là **chưa chạy** |
