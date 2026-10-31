# Kiểm tra bản 0.8.0

- 22 test đạt: thêm đường dẫn Windows từ tin nhắn, không tự lùi về parent không được chỉ định; scheduler khởi động các task độc lập, đợi dependency, giữ blocker khi cần auth.
- Cần phân công tasks hợp lệ từ Lead; không tự hiểu văn bản tự do thành hành động. Chưa kiểm thử phân công/chạy Dev bằng tài khoản thật.

- 19 test unit/process đạt, gồm đọc file chỉ trong root được cấp, line suffix, từ chối thoát root/tệp không hỗ trợ và usage event thiếu % không biến thành 0.
- UI smoke đạt: Enter gửi /status không gọi model, Shift+Enter không bị chặn, Opus 5.5 trong selector, inline file reference và nút copy code fence được render.
- Chưa kiểm thử usage dialog/OAuth và trả lời model bằng tài khoản thật; không tuyên bố sidebar luôn có quota đầy đủ. Model ID đối chiếu tài liệu chính thức; khả năng sử dụng phụ thuộc tài khoản.

- 15 unit/process tests đạt: có kiểm tra nhiều Dev, tài khoản/mode/model/task riêng, transcript giữ khi đổi profile và task draft Lead chỉ áp dụng khi duyệt.
- UI smoke của chat/role editor đạt. Chưa chạy song song bằng nhiều tài khoản thật; chưa xác minh hiệu quả phân công của Lead trên project game thật.
- Native context tách tài khoản; chuyển profile dùng text context lưu tại app, không hứa di chuyển hidden state của CLI.

- Parser stream-json: kiểm tra text delta, không lặp toàn bộ assistant text, báo lỗi/quyền bị từ chối và lưu session ID.
- Bridge thực thi PowerShell với CLI giả lập: prompt tiếng Việt, dấu nháy và metacharacter qua stdin không bị hiểu thành lệnh; text stream và resume ID đạt.
- UI smoke: thêm role bằng picker, click khối, lưu nhiệm vụ riêng, gợi ý /model và phản hồi slash ngay trong chat, selector mode/model, sửa yêu cầu đạt.
- Tổng cộng 13 test unit/process; mock process không gọi Anthropic, không dùng credential. Chưa kiểm thử trả lời thật, quyền sửa tệp thật hoặc quota thuê bao bằng tài khoản của người dùng.

- Thêm 2 kiểm thử luồng team: bàn giao, QA fail, quay về Lead/Dev, chặn QA pass khi còn Issue, retest và review; role mới không thay đổi luồng của session cũ, từ chối dự án không hợp lệ. Tổng cộng 6 test đạt.
- Smoke giao diện dashboard mới đạt: tạo dự án/session, ghim, bắt đầu và bàn giao GD, kiểm tra các khối role được render. Đã chụp và xem `docs/preview.png` bằng dữ liệu thử, không phải agent thật.
- Luồng role và chat hiện là quản lý thủ công. Chưa có bộ điều phối agent hoặc Unity adapter; sơ đồ phản ánh trạng thái do người dùng xác nhận.

- Kiểm tra cú pháp main/core/renderer: đạt.
- Bốn kiểm thử chính sách hồ sơ, biến môi trường, tham số quyền và chống chèn lệnh PowerShell: đạt.
- Terminal node-pty chạy PowerShell qua Electron 45.2.0 và thoát: đạt với binary dựng sẵn Node-API, không cần rebuild C++.
- Giao diện được kiểm tra bằng Electron với userData thử riêng: tải xterm, thêm/đổi tên hồ sơ, từ chối ID giả và dựng terminal. Chụp ảnh tùy thuộc display surface của môi trường chạy.
- npm audit --omit=dev: không phát hiện lỗ hổng tại thời điểm kiểm tra. Full audit có 15 cảnh báo moderate trong chuỗi công cụ electron-builder; chúng không nằm trong dependency runtime của app. Chưa xử lý bằng downgrade tự động vì đề xuất audit là thay đổi lớn và có thể đưa công cụ cũ vào build. Cần đánh giá lại trước phát hành công khai.
- Bộ cài Windows x64 NSIS được build, chưa ký số. Chưa cài thử/gỡ thử trên máy Windows sạch.
- Không đăng nhập tài khoản thật, không gửi prompt có phí, chưa chứng minh hai tài khoản thuê bao chạy đồng thời trên máy người dùng. Cơ chế tách CLAUDE_CONFIG_DIR đã được triển khai nhưng cần kiểm thử đăng nhập A/B thật.
- Đây là rà soát có phạm vi, không phải chứng nhận an toàn. Không bật shell/MCP/hook để mở rộng tính năng trước khi có thiết kế quyền và kiểm thử tương ứng.
