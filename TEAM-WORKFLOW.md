# Đặc tả hệ thống phối hợp phát triển game

Trạng thái: thiết kế cho phiên bản tiếp theo, chưa tích hợp vào Office Desk 0.1.0.

## Mục tiêu

Tiếp nhận yêu cầu, chuyển qua GD, Lead Dev, Dev, QA và Lead review; lưu toàn bộ tài liệu, bàn giao, Issue, bằng chứng và vòng sửa lỗi. GD tạm hiểu là Game Designer. Vai trò độc lập với tài khoản: nhiều role có thể dùng một tài khoản hoặc được gán các hồ sơ khác nhau; không tự chuyển tài khoản để né giới hạn.

## Trách nhiệm

- GD: làm rõ yêu cầu, ghi giả định và câu hỏi chưa giải quyết, lập design/plan, User Story (US), Acceptance Criteria (AC) có ID và cách xác minh. Định nghĩa platform, thiết bị mục tiêu, điều kiện đo và ngân sách hiệu năng; thiếu thông tin thì đánh dấu blocked thay vì tự chốt.
- Lead Dev ở giai đoạn planning: brainstorm phương án, so sánh đánh đổi, chọn kiến trúc, chia task có phụ thuộc và phạm vi file, ánh xạ task tới US/AC, nêu rủi ro, chiến lược test và kế hoạch test hook/cheat cho QA.
- Dev: thực hiện task đã được nhận, cập nhật test và tài liệu, mô tả diff, liên kết commit hoặc mã revision/snapshot. Không tự thay AC hoặc tự xác nhận Done.
- QA: viết test theo design/AC; tạo hoặc đề nghị cheat/test hook chỉ trong Editor/Development Build và phải qua kiểm tra code; chạy functional/regression và đo CPU/GPU/frame time/memory bằng công cụ thật. Ghi môi trường, build/revision, dữ liệu đầu vào, bước tái hiện, expected/actual và evidence. Không có Editor/thiết bị/profiler thì trạng thái blocked/not run, không pass.
- Lead Dev ở giai đoạn review: sau QA pass, kiểm tra correctness, clean code, duplicate code, dependency, lifecycle và việc loại trừ cheat khỏi release. Sửa code sau QA pass làm mất hiệu lực kết quả tương ứng và phải quay về QA trước khi Done.

## Luồng

Request -> GD Design -> Lead Planning -> Dev Implementation -> QA Verification -> Lead Code Review -> Done.

QA fail -> Issue -> Lead Triage/Fix Plan -> Dev Fix -> QA Retest -> Lead Code Review.

Lead review yêu cầu sửa -> Dev Fix -> QA Retest -> Lead Code Review.

Mọi stage có thể Blocked, Paused hoặc Cancelled. Có giới hạn số vòng retry; lỗi lặp lại, quá ngân sách hoặc thiếu quyền phải dừng và báo người dùng. Không tự lặp vô hạn, approve hoặc gửi phím xác nhận hộ người dùng.

## Điều kiện chuyển stage

GD bàn giao khi có US/AC kiểm thử được; vấn đề quan trọng chưa chốt phải được người dùng giải quyết. Lead planning bàn giao khi task/dependency/owner/test plan đầy đủ. Dev bàn giao kèm revision và mô tả thay đổi. QA pass chỉ khi mọi AC bắt buộc có evidence hợp lệ cho revision đang kiểm tra, không còn Issue chặn chưa được xác nhận. Lead chỉ Done khi review chính revision đã QA pass. Nếu revision thay đổi, kết quả QA và review liên quan bị invalidated. Issue không tự đóng khi Dev nói đã sửa: Dev đánh dấu ready-for-retest, QA xác nhận closed/reopened.

## Dữ liệu và giao tiếp

Requirement, DesignRevision, UserStory, AcceptanceCriterion, Task, Run, Handoff, Issue, TestCase, TestRun, PerformanceCapture và CodeReview đều có ID ổn định. Handoff ghi sender/recipient, trạng thái, input/output references, project/revision, câu hỏi mở, timestamp và parent handoff. Lưu append-only audit events cho thay đổi stage; không để agent tự ghi trạng thái toàn cục qua nội dung chat. Bộ điều phối kiểm tra schema, role, gate và revision trước khi commit kết quả. Có thể xem conversation riêng của mỗi role và nhật ký bàn giao chung.

Issue gồm severity, status, owner, US/AC/task liên quan, build/revision, môi trường, repro steps, expected/actual, evidence, fix plan và lịch sử retest. Deduplicate theo nội dung và ngữ cảnh nhưng không tự bỏ Issue có biểu hiện giống mà nguyên nhân khác.

## Role mở rộng

Định nghĩa role bằng ID, tên, system instructions, input/output schema, tool permissions, account assignment, routing và gate rules. Ví dụ Technical Artist giữa GD và Lead hoặc Security Reviewer trước Done. Thay graph cần kiểm tra node không có đường đến Done, stage không có người nhận và cycle không có giới hạn. Lưu phiên bản graph theo mỗi requirement; thay cấu hình không làm đổi ngầm run đang chạy. Chỉ thêm prompt role không đủ để tự cấp quyền hoặc tham gia routing.

## Unity và hiệu năng

Unity adapter phải được cấu hình riêng theo project với Unity Skills, không dùng MCP/shell toàn quyền. Role chỉ nhận tool allowlist theo nhiệm vụ. Ban đầu read-only; sửa scene, prefab, script, import asset, bake hoặc chạy test cần quyền tương ứng. Thao tác phá hủy và cài/chạy script ngoài yêu cầu phê duyệt. Lưu và kiểm tra trạng thái Editor trước/sau thao tác, tránh hai Dev cùng sửa scene/asset. Một project có một hàng đợi mutation; đo profiler phải độc quyền để dữ liệu không nhiễu từ các run khác.

QA không dùng FPS từ suy đoán code để xác nhận performance. Báo cáo phải nêu target hardware, graphics API, resolution, scene, số đối tượng, warm-up, khoảng đo, CPU/GPU frame time, allocations và evidence. GPU metric không hỗ trợ phải ghi unavailable. Chọn ngân sách theo yêu cầu sản phẩm thay vì áp chung một mốc cho mọi game.

Cheat/test hook phải qua quy trình task/diff/review như code khác, đặt trong assembly Editor hoặc guard UNITY_EDITOR/DEVELOPMENT_BUILD và kiểm tra không xuất hiện ở release. Không tự cấp account/admin, bypass thanh toán hoặc thay dữ liệu production.

## Giao diện

Thanh role hiển thị owner, trạng thái và tool permissions; có nút thêm role. Bảng requirement hiển thị pipeline và blocker. Tabs Design/US-AC, Tasks, Conversations/Handoffs, Issues, Test Results, Performance và Code Review. Terminal là phần chi tiết theo run, không là nguồn duy nhất để xác định trạng thái. Có pause/resume/cancel và phê duyệt quyền tại nơi cần. Không hiển thị dữ liệu demo như bằng chứng run thật.

## Phạm vi an toàn và triển khai

Giữ hồ sơ đăng nhập độc lập và dùng CLI chính thức. Không đọc token/credential, endpoint usage riêng, tunnel hoặc auto-rotate. Chưa có xác nhận tự động: Office Desk 0.1.0 vẫn chỉ là dashboard terminal, chưa có bộ điều phối role, structured agent output, Unity adapter hoặc performance runner. Cần triển khai và kiểm thử từng lớp trước khi bật tự động end-to-end. Không gỡ các hạn chế hiện tại chỉ bằng một nút “bật tất cả”.
