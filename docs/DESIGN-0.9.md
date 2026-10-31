# Office Desk 0.9 — Thiết kế bản sửa (GD)

- Trạng thái: **v4 — Q1/Q2/Q3/Q8/Q9, A2/A3 đã được người dùng chốt; bàn giao Lead Dev**
- Ngày: 2026-10-31
- Nguồn: báo cáo QA (ISSUE-01 → ISSUE-08) trong session; GD đã đối chiếu bằng cách đọc code.
- Chưa chạy test nào. Mọi kết luận dưới đây suy ra từ code, chưa xác minh khi chạy.

## 0. Quyết định của người dùng (2026-10-31)

| ID | Quyết định |
|---|---|
| **D-Q2** | Lead chỉ có **một khối `Lead Dev`**, bỏ tách `Lead Planning`/`Lead Review`. Vòng lặp lỗi: **QA → Lead Dev / Dev**. |
| **D-Q3** | Role đang làm việc thì **không được xóa**. Chỉ xóa khi role đã pass. |
| **D-A2** | Lead Dev **review lại code** sau QA pass. Tiêu chí bắt buộc: **code clean, không duplicate code logic**. |
| **D-A3** | Dev chỉ xóa được khi **task của Dev đã pass và QA xác nhận không còn Issue**. |
| **D-Q8** | Cho phép xóa role **nếu GDD không có việc cho role đó**. |
| **D-Q1** | **Bỏ hẳn** việc nhét lịch sử vào prompt khi đã có `--resume`. Không có resume thì chỉ gửi **tóm tắt hoặc N tin gần nhất**, kèm **giới hạn tổng độ dài**. |
| **D-Q9** | QA fail **tối đa 3 vòng**. Vòng thứ 3 vẫn lỗi thì **viết report và chờ người dùng quyết định**. |

## 1. Bối cảnh

Lịch sử session ghi "Đã xóa UI/UX / Dev / Lead Dev", nhưng danh sách đội vẫn còn đủ ba role. Nguyên nhân: các role được thêm lại qua `add-worker` mà không có dòng log nào. Khi thêm lại, role nhận lại cấu hình cũ (mode, tài khoản, task) và cả phiên CLI cũ (GD-F6). Prompt của mọi role chứa hướng dẫn Lead và toàn bộ lịch sử session, kể cả khi CLI đã `--resume`. Mô hình Issue/QA chưa đáp ứng `TEAM-WORKFLOW.md`.

Mục tiêu bản 0.9:
1. Vòng đời role an toàn: chỉ xóa khi đã pass hoặc không có việc; thêm lại sạch; có log.
2. Một khối Lead Dev; vòng QA → Lead Dev/Dev có giới hạn 3 vòng.
3. Prompt đúng role, không lặp lịch sử khi đã resume.
4. Issue/TestRun đủ dữ liệu để QA pass và Lead review dựa trên bằng chứng.

## 2. Đối chiếu kết quả QA với code

| QA | Kết luận | Bằng chứng |
|---|---|---|
| ISSUE-01 | Đúng | `team.cjs:18` (`remove-role`) chỉ gọi `flow.splice`. `workers.cjs:2` dùng `\|\|=` nên dùng lại bản ghi cũ. `team.cjs:13` (`add-worker`) không ghi log. |
| ISSUE-02 | Đúng; **cách sửa theo D-Q3**: chặn xóa thay vì dọn dẹp | `remove-role` không kiểm tra run/dispatch. |
| ISSUE-03 | Đúng | `main.cjs:124` chèn hướng dẫn Lead cho mọi role. |
| ISSUE-04 | Đúng; **cách sửa theo D-Q1** | `main.cjs:124` gắn toàn bộ `thread.messages`, kể cả khi `chat.cjs:34` đã thêm `--resume`. |
| ISSUE-05 | Đúng | `main.cjs:124` in cả trường rỗng. |
| ISSUE-06 | Đúng | Issue chỉ có `{id, text, closed}`. Gate QA (`team.cjs:51`) chỉ kiểm tra Issue đã đóng. |
| ISSUE-07 | Đúng | Policy (`main.cjs:78`) chặn `Bash`; mode read không có shell. |
| ISSUE-08 | Đúng | `VALIDATION.md` không tách theo phiên bản. |

GD tìm thêm:
- **GD-F1:** Lead có hai cách đặt tên (`team.cjs:38` và `team.cjs:13`). → Sửa theo D-Q2.
- **GD-F2:** `remove-role`/`add-worker` không kiểm tra trạng thái ở backend; chỉ UI có `confirm()` (`team-ui.js:181`).
- **GD-F3:** `run-thread` (`main.cjs:163`) dựng prompt riêng, lấy `roleConfig` khác `chat-send` (`main.cjs:122`).
- **GD-F4:** Báo Issue (`team.cjs:54`) tìm `Lead Planning`; flow chỉ có `Lead Dev` thì Issue quay về GD.
- **GD-F5:** `addWorker` (`workers.cjs:3`) nối role vào cuối flow. `tests/workers.test.cjs:3` kiểm thứ tự này, phải sửa test.
- **GD-F6 (mới):** Khóa resume là `profileId:folder:label` (`chat.cjs:33`). `remove-role` không xóa `thread.cliSessions`, nên role thêm lại cùng tên sẽ **resume đúng phiên CLI cũ** — mang theo toàn bộ hội thoại cũ. Đây là một phần của ISSUE-01.

## 3. Luồng quy trình (D-Q2, D-A2, D-Q9)

Thứ tự khối trong `flow`: `GD → UI/UX → Lead Dev → Dev, Dev #2… → QA → <role tùy chỉnh>`. Lead Dev xuất hiện **một lần** trong `flow` nhưng làm ở ba pha, lưu ở `thread.leadPhase`.

```
GD → UI/UX → Lead Dev[planning] → Dev* → QA ──pass──▶ Lead Dev[review] ──duyệt──▶ Done
                                   ▲      │                   │
                                   │   fail (Issue)     không đạt clean/duplicate
                                   │      ▼                   │
                                   │  Lead Dev[triage]        │
                                   │      │                   │
                                   └── Dev fix ◀──────────────┘
                                          └──▶ QA retest (vòng +1)

QA fail lần thứ 3 ──▶ status = 'awaiting-decision' + Report ──▶ người dùng quyết định
```

| Chuyển | Điều kiện | Kết quả |
|---|---|---|
| QA pass | Không còn Issue mở; có TestRun cho revision hiện tại | `stage = Lead Dev`, `leadPhase = 'review'`, `qaFailRounds = 0` |
| QA fail, vòng 1–2 | Tạo Issue | `qaFailRounds++`, `stage = Lead Dev`, `leadPhase = 'triage'` |
| QA fail, vòng 3 | `qaFailRounds` đạt 3 | `status = 'awaiting-decision'`, QA viết Report (§8.5), dừng tự động |
| Lead triage bàn giao | Có fix plan, Issue có owner Dev | Sang Dev owner; Dev bàn giao → QA |
| Lead review duyệt | Checklist review đạt (US-REVIEW-01) | `status = 'done'` |
| Lead review không đạt | Ghi mục không đạt | Về Dev → QA retest. TestRun cũ `invalidated`. **Không** tăng `qaFailRounds` |

Không có Dev trong flow thì triage/review-không-đạt quay về Lead Dev và log `Không có Dev để sửa`.

## 4. User Stories và Acceptance Criteria

### Nhóm A — Vòng đời role (P0)

**US-ROLE-01** — Thêm lại role thì role bắt đầu sạch.
| AC | Tiêu chí | Kiểm thử |
|---|---|---|
| AC-ROLE-01.1 | Sau `remove-role` thành công, `thread.workers[label]` không còn | Unit test `team.test.cjs` |
| AC-ROLE-01.2 | `add-worker` cùng loại: `mode = thread.mode \|\| 'read'`, `profileId = ''`, `task = ''` | TC-ROLE-01 |
| AC-ROLE-01.3 | `add-worker` ghi log `Hệ thống: Đã thêm <label>` | Unit test |
| AC-ROLE-01.4 | Sau `remove-role`, mọi khóa `thread.cliSessions` kết thúc bằng `:<label>` bị xóa; role thêm lại **không** `--resume` phiên cũ (GD-F6) | Unit test + TC-ROLE-01 |

**US-ROLE-02 (D-Q3, D-A3, D-Q8)** — Chỉ xóa role khi đã pass hoặc không có việc.
| AC | Tiêu chí | Kiểm thử |
|---|---|---|
| AC-ROLE-02.1 | `remove-role` bị từ chối nếu role **đang làm việc** (§8.1). Thông báo nêu lý do, ví dụ `Dev đang chạy; chỉ xóa được khi đã pass` | TC-ROLE-02 |
| AC-ROLE-02.2 | `remove-role` bị từ chối nếu role **có việc mà chưa pass** (§8.1) | TC-ROLE-02b |
| AC-ROLE-02.3 | Dev: chỉ xóa khi task đã `finished`, QA đã pass sau task đó và không còn Issue mở (D-A3) | TC-ROLE-04 |
| AC-ROLE-02.4 | Role **không có việc** (§8.1) xóa được ở mọi thời điểm (D-Q8) | TC-ROLE-05 |
| AC-ROLE-02.5 | Từ chối thì không thay đổi dữ liệu nào | Unit test so sánh trước/sau |
| AC-ROLE-02.6 | Xóa thành công **không** reset `stage`/`status`, **không** mở lại Issue; log `Đã xóa <label> (<đã pass \| không có việc>)` | Unit test |
| AC-ROLE-02.7 | Không xóa được nếu còn Dev khác trong dispatch chưa xong có `dependsOn` chứa role đó | TC-ROLE-03 |
| AC-ROLE-02.8 | Nút × chỉ hiện khi xóa được; ngược lại vô hiệu hóa, tooltip nêu lý do | `tests/ui-smoke.cjs` |
| AC-ROLE-02.9 | Kiểm tra nằm ở backend qua hàm thuần `removable()`; UI dùng lại, không tự tính | Unit test gọi trực tiếp `update` |

**US-ROLE-03** — Thêm role giữa quy trình không phá luồng đang chạy.
| AC | Tiêu chí | Kiểm thử |
|---|---|---|
| AC-ROLE-03.1 | `add-worker` chèn role đúng vị trí pipeline (§3); role tùy chỉnh ở cuối | Unit test (sửa `workers.test.cjs:3`) |
| AC-ROLE-03.2 | Sau khi chèn, `flow[stage]` vẫn là role đang hoạt động trước đó | Unit test |
| AC-ROLE-03.3 | Role chèn **trước** stage hiện tại được log `bỏ qua ở vòng này`, quy trình không lùi | Unit test |

**US-ROLE-04 (D-Q2)** — Lead Dev là một khối duy nhất.
| AC | Tiêu chí | Kiểm thử |
|---|---|---|
| AC-ROLE-04.1 | `select-roles`, `assign-role`, `add-worker` đều tạo nhãn `Lead Dev`; không còn tạo `Lead Planning`/`Lead Review` | Unit test |
| AC-ROLE-04.2 | Thêm `Lead Dev` lần hai bị từ chối | Unit test |
| AC-ROLE-04.3 | Migration khi load: `Lead Planning`/`Lead Review` → một `Lead Dev`; giữ worker config và `cliSessions` của `Lead Planning`; `leadPhase = 'review'` nếu stage cũ là `Lead Review`, ngược lại `'planning'` | TC-MIG-01 |
| AC-ROLE-04.4 | `roleKey` vẫn đọc được nhãn cũ nhưng không sinh nhãn cũ | Unit test |

**US-LOOP-01 (D-Q2, D-Q9)** — Vòng lặp QA → Lead Dev/Dev, tối đa 3 vòng.
| AC | Tiêu chí | Kiểm thử |
|---|---|---|
| AC-LOOP-01.1 | QA báo Issue → `qaFailRounds++`, `stage = Lead Dev`, `leadPhase = 'triage'` (sửa GD-F4) | TC-LOOP-01 |
| AC-LOOP-01.2 | Lead triage bàn giao → Dev owner của Issue; Dev bàn giao → QA | TC-LOOP-01 |
| AC-LOOP-01.3 | QA pass → `qaFailRounds = 0`, `stage = Lead Dev`, `leadPhase = 'review'` | TC-LOOP-02 |
| AC-LOOP-01.4 | QA fail lần thứ 3 → `status = 'awaiting-decision'`; không tự chuyển sang Lead/Dev; dispatch không tự chạy | TC-LOOP-04 |
| AC-LOOP-01.5 | Ở `awaiting-decision`, QA bàn giao phải kèm Report đủ mục §8.5; thiếu mục thì bị từ chối | Unit test |
| AC-LOOP-01.6 | Người dùng chọn một trong: **Tiếp tục thêm 1 vòng** / **Chấp nhận với lỗi đã biết** (→ Lead review, Issue giữ `open` có nhãn `accepted`) / **Dừng** (`status = 'cancelled'`). Mỗi lựa chọn ghi log | TC-LOOP-04 |
| AC-LOOP-01.7 | Prompt của Lead Dev ghi rõ pha hiện tại và số vòng `n/3` | Unit test `prompt.test.cjs` |

**US-REVIEW-01 (D-A2)** — Lead Dev review code sau QA pass.
| AC | Tiêu chí | Kiểm thử |
|---|---|---|
| AC-REVIEW-01.1 | Prompt pha review có checklist bắt buộc: (1) code clean — tên rõ, hàm ngắn, không code chết, không magic value; (2) **không duplicate code logic** — logic giống nhau ở ≥2 nơi phải gộp thành hàm dùng chung; (3) phạm vi diff khớp task/AC | Unit test `prompt.test.cjs` |
| AC-REVIEW-01.2 | Lead bàn giao review phải nêu kết quả `đạt/không đạt` cho **từng** mục checklist, kèm vị trí `file:line` cho mục không đạt | Unit test (gate handoff) |
| AC-REVIEW-01.3 | Có mục không đạt → về Dev → QA retest; chỉ tất cả đạt mới `done` | TC-LOOP-03 |
| AC-REVIEW-01.4 | Review gắn với revision; revision đổi sau review thì review cũ `invalidated` | Unit test |

### Nhóm B — Prompt theo role (P0)

**US-PROMPT-01** — Role chỉ nhận hướng dẫn của đúng vai trò mình.
| AC | Tiêu chí | Kiểm thử |
|---|---|---|
| AC-PROMPT-01.1 | Hướng dẫn Lead + mẫu khối `tasks` chỉ có khi `roleKey(type) === 'Lead Dev'` và pha planning/triage | TC-PROMPT-01, TC-PROMPT-02 |
| AC-PROMPT-01.2 | Trường rỗng bị bỏ hẳn dòng | Unit test |
| AC-PROMPT-01.3 | Module thuần `prompt.cjs`, dùng chung cho `chat-send` và `run-thread` | Unit test `prompt.test.cjs` |

**US-PROMPT-02 (D-Q1)** — Không gửi lại lịch sử khi đã resume; có giới hạn khi không resume.
| AC | Tiêu chí | Kiểm thử |
|---|---|---|
| AC-PROMPT-02.1 | Khi có `--resume` (khóa resume tồn tại trong `cliSessions`): prompt **không có** khối lịch sử session | TC-PROMPT-04 |
| AC-PROMPT-02.2 | Khi resume: chỉ gửi phần đầu gọn (vai trò, pha, task nếu có) + nội dung mới; không lặp trách nhiệm/đầu ra/roster nếu không đổi so với lượt trước | Unit test |
| AC-PROMPT-02.3 | Khi không resume: gửi **yêu cầu gốc + bàn giao gần nhất của mỗi role (làm tóm tắt) + N tin gần nhất**; tổng khối lịch sử ≤ giới hạn | TC-PROMPT-03 |
| AC-PROMPT-02.4 | Khi phải lược tin: có dòng `[Đã lược K tin cũ]` | TC-PROMPT-03 |
| AC-PROMPT-02.5 | Tính "có resume hay không" bằng **cùng một hàm** `resumeKey()` mà `chat.cjs:33` dùng; không tính lại khóa ở nơi khác | Review + unit test |
| AC-PROMPT-02.6 | N và giới hạn tổng là hằng số đặt ở một chỗ (giá trị đề xuất: Q10) | Review |

### Nhóm C — Issue, TestRun, Report (P1)

**US-QA-01** — Issue đủ thông tin; mọi lần mở lại có lý do.
| AC | Tiêu chí | Kiểm thử |
|---|---|---|
| AC-QA-01.1 | Issue có `severity`, `status` (open/ready-for-retest/closed/reopened), `owner`, `round`, `repro`, `expected`, `actual`, `revision`, `history[] {time, actor, from, to, reason}` | Unit test |
| AC-QA-01.2 | `edit-request`/`select-roles` mở lại Issue thì ghi `history` có lý do | TC-ISSUE-01 |
| AC-QA-01.3 | Dev chỉ chuyển sang `ready-for-retest`; chỉ QA được `closed`/`reopened` | Unit test |
| AC-QA-01.4 | Migration `{id, text, closed}` không mất Issue | TC-MIG-01 |

**US-QA-02** — QA pass dựa trên bằng chứng.
| AC | Tiêu chí | Kiểm thử |
|---|---|---|
| AC-QA-02.1 | TestRun `{id, testCase, revision, status: pass\|fail\|not-run\|blocked, evidence, env, time}` | Unit test |
| AC-QA-02.2 | Handoff QA pass bị từ chối nếu chưa có TestRun cho revision hiện tại | Unit test |
| AC-QA-02.3 | Revision đổi → TestRun cũ `invalidated` | Unit test + UI smoke |

**US-QA-03** — Người dùng thấy QA có công cụ gì.
| AC | Tiêu chí | Kiểm thử |
|---|---|---|
| AC-QA-03.1 | Thanh role hiển thị công cụ thực tế theo mode | UI smoke |
| AC-QA-03.2 | TestRun performance không được `pass` khi thiếu evidence đo | Unit test |

**US-QA-04 (D-Q9)** — Report khi QA fail 3 vòng.
| AC | Tiêu chí | Kiểm thử |
|---|---|---|
| AC-QA-04.1 | Report lưu ở `thread.reports[]` với các mục §8.5; hiển thị trên UI cùng 3 nút quyết định | UI smoke |
| AC-QA-04.2 | Report có thể copy/xuất ra Markdown | UI smoke |

### Nhóm D — Tài liệu (P2)

| AC | Tiêu chí | Kiểm thử |
|---|---|---|
| AC-DOC-01 | `VALIDATION.md` tách theo phiên bản; mỗi mục ghi ngày, lệnh, kết quả thực tế | Review |
| AC-DOC-02 | `TEAM-WORKFLOW.md` cập nhật luồng §3, quy tắc xóa role §8.1, giới hạn 3 vòng | Review |

## 5. Test case (cập nhật cho QA)

| TC | Kịch bản | Mong đợi | AC |
|---|---|---|---|
| TC-ROLE-01 | Dev đã pass → xóa → thêm lại → gửi chat | Worker mặc định, log "Đã thêm Dev", CLI **không** có `--resume` | AC-ROLE-01.* |
| TC-ROLE-02 | Xóa Dev khi đang chạy / trong hàng chờ | **Bị từ chối**, dữ liệu không đổi | AC-ROLE-02.1, 02.5 |
| TC-ROLE-02b | Xóa QA khi QA có việc nhưng chưa pass | **Bị từ chối** | AC-ROLE-02.2 |
| TC-ROLE-03 | Xóa Dev A (đã xong) khi Dev B phụ thuộc A và B chưa xong | **Bị từ chối** | AC-ROLE-02.7 |
| TC-ROLE-04 | Dev xong task, QA chưa pass / QA pass nhưng còn Issue / QA pass sạch | Từ chối / từ chối / **cho xóa** | AC-ROLE-02.3 |
| TC-ROLE-05 | UI/UX không có task, không dispatch, không Issue, chưa từng chạy, quy trình đang ở QA | **Cho xóa** | AC-ROLE-02.4 |
| TC-LOOP-01 | QA báo Issue → Lead triage → Dev → QA | Đúng thứ tự, `leadPhase`, `qaFailRounds = 1` | AC-LOOP-01.1–01.2 |
| TC-LOOP-02 | QA pass → Lead review → duyệt | `done`, `qaFailRounds = 0` | AC-LOOP-01.3 |
| TC-LOOP-03 | Lead review đánh "duplicate logic: không đạt" | Về Dev → QA; TestRun cũ `invalidated`; `qaFailRounds` không đổi | AC-REVIEW-01.3 |
| TC-LOOP-04 | QA fail 3 lần liên tiếp | `awaiting-decision`, có Report; thử từng lựa chọn của người dùng | AC-LOOP-01.4–01.6 |
| TC-PROMPT-01/02 | Chat với QA, GD, Dev / với Lead Dev | Chỉ Lead (planning/triage) có hướng dẫn tasks; Lead có pha và `n/3` | AC-PROMPT-01.1, AC-LOOP-01.7 |
| TC-PROMPT-03 | Không resume, session > 200 tin | Chỉ có yêu cầu gốc + bàn giao gần nhất + N tin; tổng ≤ giới hạn; có `[Đã lược K tin cũ]` | AC-PROMPT-02.3–02.4 |
| TC-PROMPT-04 | Lượt thứ 2 của cùng role, cùng tài khoản, cùng thư mục | Có `--resume`, prompt **không** có khối lịch sử | AC-PROMPT-02.1–02.2 |
| TC-REVIEW-01 | Lead bàn giao review thiếu kết quả một mục checklist | Bị từ chối | AC-REVIEW-01.2 |
| TC-ISSUE-01 | Sửa yêu cầu khi có Issue đã đóng | `reopened`, có `history` | AC-QA-01.2 |
| TC-MIG-01 | Load workspace cũ có `Lead Planning`/`Lead Review` và Issue `{closed}` | Chuyển đúng, không mất dữ liệu | AC-ROLE-04.3, AC-QA-01.4 |

## 6. Giả định và câu hỏi còn mở

| ID | Nội dung | Đề xuất GD | Trạng thái |
|---|---|---|---|
| A1 | "Revision" = git HEAD của thư mục làm việc; không có git thì dùng mã snapshot do Dev ghi | Lead xác nhận | Giả định |
| A4 | "GDD có việc cho role" được đo bằng dữ liệu app (task, dispatch, Issue owner, đã từng chạy), không phân tích file GDD | — | Giả định — vì GDD là văn bản tự do, app không đọc được |
| Q4 | Xóa role có xóa `roleConfig[key]` không? | Giữ lại | Đề xuất |
| Q5 | Có cho hoàn tác cấu hình worker sau khi xóa không? | Không | Đề xuất |
| Q7 | Vị trí UI/UX trong pipeline | Sau GD, trước Lead Dev | Đề xuất |
| **Q10** | N tin gần nhất và giới hạn tổng khi không resume | N = 20 tin, tổng ≤ 20 000 ký tự; mỗi bàn giao dùng làm tóm tắt ≤ 2 000 ký tự | **Cần người dùng chốt số** |
| **R1** | Rủi ro của D-Q1: khi resume, role **không thấy** những gì role khác viết kể từ lượt trước của nó (ví dụ Lead resume sẽ không thấy báo cáo mới của QA) | Khi resume, chỉ gửi **các bàn giao/Issue mới kể từ lượt trước của role đó** (không gửi lại tin cũ), vẫn theo giới hạn Q10 | **Cần người dùng chốt**: giữ "bỏ hẳn" hay cho gửi phần mới này |

## 7. Thứ tự triển khai đề xuất

1. **A (vòng đời role)** và **B (prompt)** chạy song song.
   - A: `team.cjs` (`remove-role`, `add-worker`), `workers.cjs` (`removable()`, sắp thứ tự), xóa `cliSessions` khi xóa role, `team-ui.js:181,189`.
   - B: tạo `prompt.cjs`; tách `resumeKey()` khỏi `chat.cjs:33` để dùng chung; thay `main.cjs:122-125` và `main.cjs:162-164`.
2. **US-ROLE-04 + US-LOOP-01 + US-REVIEW-01** làm sau A và B: cùng sửa `team.cjs` (`select-roles`, `assign-role`, `handoff`, `issue`), cần migration và `prompt.cjs`.
3. **C (Issue/TestRun/Report)** làm sau US-LOOP-01, vì dùng chung gate `handoff` và `qaFailRounds`.
4. **D (tài liệu)** cuối cùng; QA cần quyền shell để chạy `npm.cmd run check`, `npm.cmd test`, `tests/ui-smoke.cjs`.

Lưu ý merge: A, LOOP và C đều sửa `team.cjs`; nên giao một Dev hoặc làm tuần tự.

## 8. Đặc tả chi tiết

### 8.1 Quy tắc xóa role (D-Q3, D-A3, D-Q8)

Hàm thuần `removable(thread, label, { busy })` → `{ ok, reason }`. `busy` do `main.cjs` truyền vào (có run đang chạy cho `runKey(thread.id, label)`), vì `chats` nằm ở `main.cjs`.

Thứ tự kiểm tra, dừng ở bước đầu tiên thất bại:

1. **Tồn tại:** `label` có trong `flow`.
2. **Đang làm việc → từ chối:**
   - `busy === true`; hoặc
   - có dispatch của `label` ở `queued/starting/running`; hoặc
   - `flow[stage] === label` và `status === 'working'`; hoặc
   - có Issue `owner === label` chưa `closed`.
3. **Không có việc → cho xóa (D-Q8, A4):** đồng thời
   - `worker.task` rỗng;
   - không có mục dispatch hay `taskDrafts` nào của `label`;
   - không là owner của Issue nào;
   - chưa từng chạy (không có tin nhắn nào có `role === label`, không có khóa `cliSessions` của `label`);
   - không phải `Lead Dev` khi flow còn Dev hoặc QA (Lead là bắt buộc cho triage/review).
4. **Đã pass → cho xóa:**

| Loại | Đã pass khi |
|---|---|
| GD, UI/UX, role tùy chỉnh | Đã bàn giao: `indexOf(label) < stage`, hoặc `status === 'done'` |
| Dev, Dev #n (D-A3) | Dispatch của Dev `finished` **và** có QA pass sau lần bàn giao cuối của Dev **và** không còn Issue mở |
| QA | Đã pass sang Lead review, hoặc `status === 'done'` |
| Lead Dev | Chỉ khi `status === 'done'` |

5. **Còn Dev phụ thuộc → từ chối:** có dispatch chưa `finished` mà `dependsOn` chứa `label`.
6. Còn lại → từ chối với lý do `<label> có việc nhưng chưa pass`.

Khi xóa thành công:
- `flow.splice`; `delete workers[label]`; xóa mọi khóa `cliSessions` kết thúc bằng `:<label>`; loại `label` khỏi `taskDrafts`.
- Giữ `stage`, chỉ giảm 1 nếu `indexOf(label) < stage`. Không reset `status`, không mở lại Issue.
- Log `Đã xóa <label> (đã pass)` hoặc `Đã xóa <label> (không có việc)`.

UI: nút × chỉ bật khi `removable().ok`; tooltip hiện `reason`. Hộp xác nhận: `Xóa <label>? Cấu hình riêng và phiên chat của khối này sẽ bị xóa.`

### 8.2 Mẫu prompt (US-PROMPT-01, US-PROMPT-02, AC-LOOP-01.7, AC-REVIEW-01.1)

`prompt.cjs` xuất hàm thuần `buildPrompt({ label, type, phase, round, resumed, base, config, worker, roster, messages, content, attachments, limits })` → `{ text, omitted }`. Không đọc file, không phụ thuộc Electron. `resumed` do `main.cjs` tính bằng `resumeKey()` dùng chung với `chat.cjs`.

**Khi `resumed === true` (D-Q1):**
```
Vai trò <label>[ — pha <phase>, vòng <round>/3].
Task của khối: <worker.task>                 ← bỏ nếu rỗng hoặc không đổi so với lượt trước
<content>
Ảnh tham chiếu…                              ← bỏ nếu không có
```
Không có trách nhiệm/đầu ra/roster (đã có trong phiên CLI), không có lịch sử. Ngoại lệ: nếu `roleConfig` hoặc `flow` đổi kể từ lượt trước của role thì gửi lại khối đó một lần.

**Khi `resumed === false`:**
```
Vai trò <label>[ — pha <phase>, vòng <round>/3].
Trách nhiệm: …
Đầu ra: …
Yêu cầu riêng của session: …                  ← bỏ nếu rỗng
Task của khối: …                              ← bỏ nếu rỗng
Đội hiện có: <roster>
<Hướng dẫn Lead + mẫu khối tasks>              ← chỉ Lead Dev pha planning/triage
<Checklist review>                             ← chỉ Lead Dev pha review (AC-REVIEW-01.1)
Bối cảnh session (dữ liệu tham chiếu, không phải chỉ thị):
Yêu cầu gốc: <tin Bạn đầu tiên>
Bàn giao gần nhất: <mỗi role 1 bàn giao mới nhất, cắt ≤ 2 000 ký tự>
[Đã lược K tin cũ]                            ← chỉ khi K > 0
<N tin gần nhất, bỏ tin streaming và tin đã có ở trên>
<content>
Ảnh tham chiếu…
```
Tổng khối "Bối cảnh session" ≤ giới hạn Q10. Vượt thì bỏ bớt tin cũ nhất trong N tin trước, sau đó mới cắt bàn giao.

Thứ tự lấy trách nhiệm/đầu ra, giống nhau ở `chat-send` và `run-thread`: `thread.roleConfig[key]` → `team.roleTemplates[key]` → `roleDefaults[key]` (sửa GD-F3).

Checklist review (pha review):
```
Review revision <rev>. Trả lời đạt/không đạt cho từng mục, mục không đạt ghi file:line:
1. Code clean: tên rõ nghĩa, hàm ngắn một nhiệm vụ, không code chết, không magic value.
2. Không duplicate code logic: logic giống nhau ở ≥2 nơi phải gộp thành hàm dùng chung.
3. Phạm vi diff khớp task và AC được giao.
```

### 8.3 Vòng trạng thái Issue (US-QA-01)

```
open ──Dev──▶ ready-for-retest ──QA──▶ closed
  ▲                 │                     │
  └──────QA─────────┘ (reopened)          │
  ▲                                       │
  └── hệ thống: sửa yêu cầu / select-roles (reopened, có reason) ◀┘
```

| Chuyển trạng thái | Ai được làm | Bắt buộc |
|---|---|---|
| tạo → `open` | QA, người dùng | `text`; `severity` mặc định `Medium`; `owner = 'Lead Dev'`; `round = qaFailRounds` |
| Lead triage gán owner | Lead Dev | `owner` = một khối Dev |
| `open`/`reopened` → `ready-for-retest` | Dev owner, người dùng | ghi chú sửa + revision |
| `ready-for-retest` → `closed` | QA (stage QA đang `working`) | evidence |
| `ready-for-retest`/`closed` → `reopened` | QA, hệ thống | reason |

Migration: `{closed: true}` → `closed`; `{closed: false}` → `open`; `history = []`; `severity = 'Medium'`; `owner = ''`; `round = 0`.

### 8.4 Ghi chú cho UI/UX

- Nút × trên khối role: chỉ bật khi xóa được; tooltip nêu lý do (§8.1).
- Khối Lead Dev: nhãn pha `Planning` / `Triage` / `Review` và bộ đếm vòng QA `n/3`.
- Trạng thái `awaiting-decision`: banner nổi bật, hiển thị Report và 3 nút quyết định (AC-LOOP-01.6).
- Thanh role: huy hiệu công cụ theo mode (AC-QA-03.1).
- Issue: severity, status, owner, vòng, lịch sử dạng dòng thời gian.
- Danh sách "+ role" ẩn "+ Lead Dev" khi đã có Lead Dev.

### 8.5 Report khi QA fail vòng 3 (D-Q9)

QA viết, lưu ở `thread.reports[]`. Bắt buộc đủ các mục; thiếu thì handoff bị từ chối (AC-LOOP-01.5).

| Mục | Nội dung |
|---|---|
| Tóm tắt | 1–3 câu: cái gì vẫn lỗi sau 3 vòng |
| Issue còn mở | ID, severity, owner, vòng xuất hiện đầu tiên |
| Diễn biến từng vòng | Vòng 1/2/3: fix plan của Lead, thay đổi của Dev (revision), kết quả retest |
| Nguyên nhân nghi ngờ | Vì sao sửa chưa được (thiết kế sai, thiếu công cụ, thiếu thông tin, phạm vi quá lớn…) |
| Ảnh hưởng nếu chấp nhận | Rủi ro khi ra bản với lỗi này |
| Đề xuất | Một trong: tiếp tục 1 vòng (kèm hướng sửa khác), chấp nhận với lỗi đã biết, dừng/đổi thiết kế |

## 9. Ngoài phạm vi 0.9

Unity adapter, performance runner, CodeReview entity riêng (0.9 chỉ lưu kết quả review trong handoff), graph role mở rộng (xem `TEAM-WORKFLOW.md`).
