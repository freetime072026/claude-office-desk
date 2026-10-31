# Thiết kế giảm tiêu thụ token — Office Desk

Trạng thái: GD đã chốt ngày 2026-10-31. Bàn giao cho Lead Dev lập task.

## Bối cảnh

App tốn quá nhiều token. Kết quả đánh giá mã nguồn:

| ID | Nguyên nhân | Vị trí |
|---|---|---|
| F1 | Không ghi `usage`/`total_cost_usd` từ event `result`, nên không đo được | `chat.cjs` `consume()` |
| F2 | Mọi role mặc định chạy `claude-opus-5-5` | `workers.cjs` `worker()`, `main.cjs` chat-send |
| F3 | Task lặp 3–4 lần trong prompt: content, "Task của khối", roster (task đầy đủ của mọi Dev) và tin "Điều phối" trong lịch sử | `prompt.cjs` `roleLines`/`rosterOf`, `main.cjs` `pumpThread` + chat-send |
| F4 | Lịch sử gửi nguyên văn (20 tin / 20.000 ký tự), gồm cả tin hệ thống | `prompt.cjs` `sessionContext` |
| F5 | Phiên `--resume` của role phình không giới hạn | `chat.cjs` `launch()` |
| F6 | Không có `--max-turns` | `chat.cjs` `launch()` |
| F7 | stderr CLIXML của PowerShell lọt vào tin; tin lỗi vẫn được chọn làm "bàn giao gần nhất" | `chat.cjs` `finish`, `prompt.cjs` `latestHandoffs` |
| F8 | Mọi role nạp toàn bộ MCP server | `chat.cjs`, `modes.cjs` `allowedFor` |

## Quyết định đã chốt

- D1: Model mặc định: GD và Lead Dev dùng `claude-opus-5-5`; Dev, QA, UI/UX và role tùy chỉnh dùng `claude-sonnet-5-5`. Người dùng vẫn đổi được theo từng khối.
- D2: Xoay phiên resume khi lượt trước có `input + cacheRead + cacheWrite` > 120.000 token, hoặc khi phiên đã có 6 lượt. Phần ngữ cảnh mất đi được bù bằng **file ghi chú thay đổi** (US-05), không dựa vào lịch sử chat.
- D3: `--max-turns` là GD 30, Lead Dev 30, Dev 60, QA 40, role khác 30. Khi chạm giới hạn, lượt chuyển sang blocked, báo người dùng và không retry tự động.
- D4: Làm luôn MCP theo role (US-07).

## User Stories và Acceptance Criteria

### US-01 Đo token
Là người dùng, tôi muốn thấy token và chi phí theo lượt, theo role để biết chỗ nào tốn.
- AC-01.1: `consume()` lưu `message.usage = { input, output, cacheRead, cacheWrite, costUsd, turns }` từ event `result` (các trường `usage.input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `total_cost_usd`, `num_turns`). Thiếu trường thì để 0, không lỗi. Test: `tests/chat.test.cjs` với event mẫu đủ trường và thiếu trường.
- AC-01.2: UI hiển thị dưới mỗi tin của role: tổng input (gồm cache), output, chi phí. Header session hiển thị tổng theo role. Test: `tests/ui-smoke.cjs`.
- AC-01.3: QA ghi baseline của một session mẫu GD→Lead→Dev→QA **trước** khi áp các US còn lại, sau đó đo lại cùng kịch bản. Kết quả ghi vào `docs/TOKEN-OPTIMIZATION.md` mục Kết quả đo. Không có số đo thật thì ghi "chưa đo", không được ghi pass.

### US-02 Model mặc định theo role
- AC-02.1: `worker()` tạo khối mới theo bảng D1, dựa vào type của khối. Model trong `roleTemplates`/`roleConfig` (nếu có) được ưu tiên. Test: `tests/workers.test.cjs` cho từng type.
- AC-02.2: Khối đã tồn tại giữ nguyên model đã lưu (không migrate ngầm). Đổi model ở UI vẫn có hiệu lực. Test: unit test với worker có sẵn model.
- AC-02.3: `/status` và `/model` hiển thị model của khối, không hard-code Opus.

### US-03 Bỏ lặp task trong prompt
- AC-03.1: Mỗi dòng roster có dạng `label: <trạng thái> · <dòng đầu task, ≤120 ký tự>`. Test: `tests/prompt.test.cjs` với task 11.000 ký tự thì mỗi dòng roster ≤ 160 ký tự.
- AC-03.2: Task của chính khối xuất hiện đúng 1 lần trong prompt, cả khi đi qua dispatch ("Thực hiện task Lead giao") lẫn `/role X start`. Test: đếm số lần chuỗi task xuất hiện bằng 1.
- AC-03.3: Tin "Điều phối" lưu vào `thread.messages` chỉ là nhãn ngắn (ví dụ "Giao task cho Dev #2"), không chứa toàn văn task. Test: unit test hoặc ui-smoke.

### US-04 Ngữ cảnh session gọn
- AC-04.1: `sessionContext` và `deltaContext` bỏ các tin có role thuộc `Hệ thống`, `Tự động`, `Điều phối` và các tin `error: true`. Test: unit test.
- AC-04.2: "Bàn giao gần nhất" của mỗi role ưu tiên `summary` của khối handoff hợp lệ (`parseHandoff`). Không có handoff thì lấy 1.500 ký tự cuối của tin. Tin lỗi không bao giờ được chọn. Test: unit test.
- AC-04.3: `PROMPT_LIMITS` đổi thành `{ recent: 8, total: 8000, handoff: 1500, resumeDelta: 8 }`. Test: prompt sinh ra từ 50 tin dài có phần lịch sử ≤ 8.000 ký tự.

### US-05 Xoay phiên resume và file ghi chú thay đổi
Là người dùng, tôi muốn các role không kéo theo hội thoại dài vô hạn mà vẫn biết những gì đã sửa nhờ một file ghi chú.
- AC-05.1 (file ghi chú): App, không phải agent, ghi tự động vào `<thư mục làm việc>/.office-desk/notes-<threadId>.md`. Mỗi handoff hợp lệ (done/pass/issue/reject/blocked) và mỗi task Lead giao được append một mục `## <ISO time> · <role> · <status>` cùng summary (≤1.500 ký tự). Chỉ append, không sửa mục cũ. Test: unit test hàm append với thư mục tạm.
- AC-05.2: Hướng dẫn handoff của Dev yêu cầu `summary` liệt kê file đã sửa và lý do. Đây là nguồn chính cho file ghi chú. Test: kiểm tra chuỗi `HANDOFF_GUIDES.Dev`.
- AC-05.3: Mỗi prompt của role có một dòng "Ghi chú thay đổi của session: <đường dẫn>. Đọc bằng Read khi cần chi tiết." Nội dung file không được chèn vào prompt. Test: unit test.
- AC-05.4 (xoay phiên): Trước khi launch, nếu lượt trước của khóa resume có `input + cacheRead + cacheWrite > 120000` hoặc phiên đã đạt 6 lượt thì xóa `cliSessions[key]` và chạy phiên mới với `sessionContext` gọn cùng dòng trỏ file ghi chú. Sau đó ghi tin ngắn "Đã mở phiên mới cho <role> (lý do)". Test: unit test với usage giả, gồm trường hợp ngay dưới và ngay trên ngưỡng.
- AC-05.5: Ngưỡng là hằng số đặt tên (`SESSION_TOKEN_LIMIT`, `SESSION_TURN_LIMIT`), không dùng magic value.
- AC-05.6: `.office-desk/` được thêm vào `.gitignore` của **app**. App không sửa `.gitignore` của project người dùng; README ghi chú để người dùng tự quyết.

### US-06 Giới hạn số turn
- AC-06.1: `launch()` thêm `--max-turns` theo bảng D3 (hằng số theo type). Test: kiểm tra args trong `tests/chat-process.test.cjs`/fake-cli.
- AC-06.2: Khi event `result` có `subtype: "error_max_turns"`, message được đánh dấu blocked với lý do "Chạm giới hạn N lượt tool". Bộ tự động dừng tại khối đó và báo người dùng, không retry. Test: fake-cli trả `error_max_turns`.

### US-07 Sửa rác CLIXML
- AC-07.1: Script PowerShell đặt `$ProgressPreference='SilentlyContinue'`. Text stderr gắn vào message được lọc bỏ `#< CLIXML` và các khối `<Objs …>…</Objs>`; nếu sau khi lọc còn rỗng thì dùng thông báo lỗi chuẩn. Test: `tests/chat-process.test.cjs` với stderr CLIXML mẫu.

### US-08 MCP theo role
- AC-08.1: Cấu hình role (`roleConfig`/`roleTemplates`) có trường `mcp: string[]`. Mặc định là rỗng, nghĩa là role không nạp MCP server nào.
- AC-08.2: `launch()` sinh file mcp-config tạm chỉ chứa các server được phép của role, và `--allowedTools` chỉ gồm `mcp__<server>` thuộc danh sách đó. Test: args/file config không chứa server ngoài danh sách.
- AC-08.3: Role editor cho chọn server MCP từ danh sách `/mcp`. `/mcp` hiển thị server được nạp cho khối hiện tại. Test: ui-smoke.

## Thứ tự triển khai đề xuất
US-01 (đo baseline) → US-07, US-03 → US-04 → US-05, US-06 → US-02 → US-08 → QA đo lại theo AC-01.3.

## Giả định
- A1: Các hồ sơ đăng nhập dùng được Sonnet 5.5.
- A2: CLI đã cài hỗ trợ `--max-turns` và trả `usage`, `total_cost_usd`, `num_turns`, `subtype` trong event `result`. Dev xác minh trên bản CLI thật; nếu không hỗ trợ thì báo blocked.
- A3: Ghi `.office-desk/` vào thư mục làm việc của người dùng là chấp nhận được, vì người dùng đã yêu cầu dùng file ghi chú.

## Ngoài phạm vi
Tự động tóm tắt lịch sử bằng LLM; thay đổi quy trình GD→QA; đổi tài khoản để né quota.

## Kết quả đo
(QA điền: kịch bản, revision, tổng token/chi phí trước và sau theo role.)

### Baseline kích thước prompt (ký tự)
Đo ngày 2026-10-31 bằng `node tests/prompt-size.cjs` trên `prompt.cjs` **chưa sửa** (đợt 1, `PROMPT_LIMITS = {recent 20, total 20000, handoff 2000, resumeDelta 20}`). Repo chưa có commit nên chưa có revision; khi so sánh, đối chiếu với `prompt.cjs` trước đợt 2.

Thread mẫu cố định gồm 30 tin, 6 khối (GD, Lead Dev, Dev, Dev #2, Dev #3, QA):
- GD bàn giao 6.000 ký tự kèm handoff, Lead Dev trả lời 14.000 ký tự kèm khối tasks, mỗi Dev có task 11.000 ký tự.
- Có tin Hệ thống, Tự động, Điều phối (chứa toàn văn task), một tin lỗi `#< CLIXML` và 1 Issue đang mở.
- `content` mô phỏng `main.cjs`: Dev nhận "Thực hiện task Lead giao:\n" + task; các role khác nhận câu lệnh bước tự động.

| Role | resumed=false | resumed=true |
|---|---:|---:|
| GD | 46633 | 19551 |
| Lead Dev | 47032 | 19893 |
| Dev | 68521 | 41454 |
| Dev #2 | 68524 | 41457 |
| Dev #3 | 68524 | 27283 |
| QA | 47336 | 1130 |
| **Tổng** | **346570** | **150768** |

Đây là số ký tự prompt app gửi vào, không phải token thực tế. Số token và chi phí thật (AC-01.3) QA đo sau khi restart app, dựa trên dòng Token mà US-01 hiển thị.
