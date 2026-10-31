# Office Desk — Windows 11

## Sơ đồ luồng chạy

Tab **🗺 Sơ đồ luồng** (cạnh tab Hội thoại) cho xem và sửa thứ tự chạy của session. Bộ chạy tự động đi theo sơ đồ này thay cho thứ tự cố định.

- **Nút** = khối của session; Lead Dev có 3 nút theo pha (lập kế hoạch, triage, review); thêm nút **Hoàn tất**. Kéo nút để sắp xếp; thu phóng bằng −/+ hoặc **Vừa khung**.
- **Cạnh** = "khi nút nguồn kết thúc với kết quả X thì chạy nút đích". Kéo từ chấm ● bên phải nút sang nút khác để nối (mặc định "xong"); bấm vào cạnh hoặc nhãn để đổi điều kiện hoặc xoá. Điều kiện: **xong** (xong/pass/bỏ qua), **pass**, **issue**, **reject**, **luôn**.
- **Luật chạy:** một khối chạy khi có cạnh khớp dẫn tới nó **và** không còn khối nào nối vào nó đang chờ/đang chạy. Ví dụ Lead nối vào 3 Dev, 3 Dev nối vào QA: Lead chỉ giao task cho 2 Dev thì 2 Dev chạy song song, Dev thứ 3 **bỏ qua**, QA bắt đầu khi cả hai Dev xong. Dev có nhiều nguồn thay thế nhau (lập kế hoạch, triage, review) chỉ cần nguồn vừa kích hoạt.
- **Trạng thái** hiện ngay trên nút: chờ (vàng), đang chạy (viền xanh), xong, bỏ qua (mờ), bị chặn (đỏ).
- **Sơ đồ mặc định** (session cũ tự dựng): GD → UI/UX → Lead lập kế hoạch → các Dev/VFX song song → QA → (role tùy chỉnh) → Lead review → Hoàn tất; QA `issue` → Lead triage → Dev; review `reject` → Dev. Lưu/Huỷ thay đổi/Đặt lại mặc định trên thanh công cụ. Chưa sửa sơ đồ thì thêm/xoá role sẽ dựng lại mặc định; đã lưu sơ đồ riêng thì Dev/VFX mới được nối giống các Dev đang có, khối loại khác thêm vào chưa nối.
- Giữ nguyên: Lead pha triage/review, QA hai pha (chức năng → performance), review chỉ lặp 1 lần, giới hạn vòng QA và quyết định của bạn, GD chốt vấn đề mới mở vòng mới. Task Lead giao ở trạng thái "chờ tới lượt theo sơ đồ" cho tới khi nút Dev tới lượt.

## Tự phát hiện project Unity

Khi thư mục chính của session là project Unity (có `ProjectSettings/ProjectVersion.txt`), trước mỗi lượt của Lead Dev, Dev, VFX, QA app kiểm và chèn vào prompt một đoạn ngắn: phiên bản Unity, đường dẫn `Unity.exe` đúng phiên bản trong Unity Hub, Editor có đang mở project không (`Temp/UnityLockfile`), và cách gọi Unity phù hợp:

- **Editor đang mở + có Unity-Skills** (`com.besty.unity-skills`, API trả lời ở `127.0.0.1:8090–8092` với đúng tên project): điều khiển Editor đang mở bằng `curl` (`/health`, `/skills/recommend`, `POST /skill/<tên>?expectProject=<tên project>`), không chạy `-batchmode` vì project đang bị khoá; sau khi sửa C# phải refresh/compile và đọc lỗi console qua API trước khi báo done.
- **Editor đang mở nhưng API không trả lời / chưa cài Unity-Skills**: báo rõ là bị khoá; không điều khiển được thì báo blocked và ghi bước cần làm trong Editor.
- **Editor đóng**: lệnh `Unity.exe -batchmode -projectPath … -executeMethod/-runTests -logFile …`, timeout Bash tới 10 phút.

**Script `.office-desk/unity.sh`** (app tạo/ghi đè khi project có Unity-Skills; chạy bằng Git Bash, chỉ cần curl): Dev/QA gọi `bash .office-desk/unity.sh GET /health` hoặc `… POST /skill/<tên> '<json>'` thay vì `curl` thẳng vào cổng. Mỗi lần gọi, script lấy cổng hiện tại từ sổ đăng ký `~/.unity_skills/registry.json` (dò 8090–8100 nếu không có), kiểm `/health` đúng tên project, **chờ tới 3 phút** khi Unity đang compile/nạp lại domain (vào/ra Play Mode), tự thêm `expectProject` và luôn có timeout (mặc định 120 s, `UNITY_TIMEOUT=600` cho việc lâu). Lý do: mỗi lần nạp lại domain Unity-Skills khởi động lại server và có thể đổi cổng (lượt QA BaseTD treo vì chờ ở 8090 trong khi server đã sang 8091). Lưới an toàn: lệnh `curl` tự gõ tới `127.0.0.1/localhost:8090–8100` thiếu timeout được app thêm `--max-time 120`. Khối nào quá 5 phút không có bước mới thì tiến độ hiện "⚠ … không có tiến độ, có thể treo · bấm Dừng nếu cần". Tắt Reload Domain khi vào Play Mode (Project Settings → Editor → Enter Play Mode Settings → Reload Scene only) giúp ít bị nạp lại hơn.

Unity-Skills đang ở chế độ bypass thì API làm ngay mọi thao tác trong Editor; mỗi lệnh `curl` vẫn qua hộp duyệt shell của Office Desk (trừ khi chạy tự động hoặc Bypass). Đã thử với BaseTD thật: Dev gọi `/health`, tìm và dùng skill `debug_get_errors`, báo 0 lỗi console.

## Subagent đọc code và tiếp tục phiên của task

**Subagent đọc code.** Lead Dev, Dev, VFX và QA có tool `Agent` với một subagent duy nhất `code-reader`: chỉ Read/Grep/Glob, chạy model **Haiku** trong ngữ cảnh riêng và trả bản tóm tắt ngắn (đường dẫn, số dòng, hàm/lớp). Nhờ vậy việc dò code không làm phình ngữ cảnh chính, vốn được gửi lại ở mỗi lần gọi model. Mọi lời gọi Agent đi qua app (quy tắc `ask` trong settings) và bị ép về đúng `code-reader`, model Haiku, chạy chờ kết quả, kể cả khi model xin loại agent hay model khác. GD, UI/UX và chat thường không có subagent. Đã thử với Claude Code thật: model xin `general-purpose` + `opus`, app đổi thành `code-reader` + Haiku, transcript xác nhận subagent chạy `claude-haiku-5-5`. Lưu ý: settings không còn chặn `Task` vì đó là tên cũ của `Agent`.

**Phiên không bao giờ bị bỏ, compact như Claude Desktop.** Mỗi khối (GD, UI/UX, Lead, Dev, VFX, QA, chat thường) luôn **tiếp tục phiên CLI của mình**, kể cả khi chạy lại task, nhận task mới hay sang vòng mới, nên giữ được các tệp đã đọc và việc đã làm. Phiên chỉ mới hoàn toàn khi tạo **session mới** trong app (hoặc đổi hồ sơ/thư mục của khối). CLI chạy với `--autocompact 100k`: khi ngữ cảnh chạm ~100k token, Claude Code tự tóm tắt (compact) phần cũ, kể cả giữa một lượt dài; thẻ tin hiện "Đã compact ngữ cảnh: A → B token", lúc đang compact tiến độ hiện "đang compact ngữ cảnh". Gõ **`/compact [điều cần giữ]`** để compact ngay phiên của khối đang chọn (không chạy bộ tự động). Task chạy lại (bị chặn, lỗi, chạm giới hạn lượt, tạm dừng) nhận lời nhắc làm tiếp phần còn thiếu, không đọc lại tệp đã đọc. Khi GD mở vòng mới, CHANGES.md và TASKS.md được đánh dấu "Vòng N", lịch sử vòng trước giữ nguyên. Đã thử với Claude Code thật: `/compact` giảm 7.885 → 2.476 token, cùng phiên, lượt sau vẫn nhớ nội dung đã đọc mà không đọc lại.

## Giữ chi phí token thấp

Rút ra từ một session BaseTD tốn $8: một task Dev 17 tệp chạy hết 60 lượt gọi, ngữ cảnh ~150k token mỗi lần gọi; chi phí tăng nhanh hơn số lượt vì toàn bộ ngữ cảnh được gửi lại ở mỗi lần gọi.

- Mỗi task của Lead tối đa **8 mục** trong `files`; Lead được dặn mỗi task nên xong trong ~20 lượt tool, việc lớn chia cho Dev #2, #3 hoặc nhiều vòng. Kế hoạch bị từ chối thì app ghi **lý do cụ thể** và chèn lý do vào prompt lượt Lead kế tiếp.
- Mọi role làm việc theo tệp được dặn: tìm bằng Grep/Glob trước, tệp lớn đọc theo đoạn (`offset/limit`), không đọc lại tệp đã đọc, không Read ảnh trừ khi task cần, sửa bằng Edit (Write chỉ để tạo tệp mới).
- GDD mục tiêu tối đa ~8.000 ký tự; GD không đọc code.
- Dev/VFX giới hạn 40 lượt gọi mỗi lượt chat (trước là 60).
- Thẻ tin hiện cảnh báo khi một lượt xử lý quá 2 triệu token ngữ cảnh hoặc trung bình quá 80k mỗi lượt.

## Role VFX

Thêm bằng **＋ Role → + VFX** (thêm nhiều lần thành VFX #2…). VFX là Dev chuyên hiệu ứng: đứng sau Dev, trước QA; Lead Dev giao task cho VFX trong cùng khối tasks với `files` riêng (ví dụ `Assets/VFX/`, `Assets/Shaders/`), không chồng tệp với Dev nên chạy song song với Dev; QA chỉ bắt đầu khi cả Dev và VFX của vòng đã xong. VFX chỉ đọc mục **VFX** trong GDD (GD ghi: hiệu ứng nào, cho sự kiện nào, cảm giác mong muốn, ảnh tham chiếu) và chỉ sửa tệp được giao. Prompt yêu cầu ưu tiên shader viết bằng code, tạo/sửa prefab, material, VFX Graph bằng script Editor thay vì sửa YAML/GUID tay. Claude không nhìn thấy hiệu ứng chạy: handoff của VFX ghi cách xem và cần kiểm tra trực quan gì; gửi kèm ảnh chụp (dán/kéo vào chat) để VFX chỉnh tiếp. QA pha performance đo thêm số particle, overdraw, draw call. Model mặc định Sonnet, giới hạn 60 lượt tool mỗi lượt chat.

## Ảnh tham chiếu trong chat

Dán ảnh (Ctrl+V, ví dụ ảnh chụp màn hình) vào ô chat hoặc kéo thả ảnh vào cửa sổ: ảnh hiện thành thumbnail phía trên ô nhập, bấm × để bỏ, bấm ảnh để xem lớn. Nhận PNG, JPEG, WebP, GIF, tối đa 20 MB mỗi ảnh và 8 ảnh mỗi tin; định dạng kiểm bằng nội dung tệp, không theo đuôi. Clipboard có cả chữ (ví dụ copy từ Word) thì chữ vẫn được dán vào ô nhập.

Ảnh đi kèm **đúng tin bạn gửi**: sau khi gửi, ảnh hiện trong thẻ tin đó và không được gửi lại ở các lượt sau hay ở lượt chạy tự động (trước đây ảnh của session được liệt kê trong mọi prompt). Thư mục ảnh của session được cấp cho CLI qua `--add-dir` nên Claude đọc ảnh không phải hỏi quyền. Ảnh lưu trong `%APPDATA%/office-desk/attachments/<session>` và bị xoá khi xoá hẳn session. Đã thử với Claude Code thật: Claude đọc đúng ảnh đính kèm.

## Quy trình theo tệp .md (giảm token)

Trạng thái chung nằm trong tệp, không nằm trong lịch sử chat. App tạo trong thư mục chính của session:

| Tệp | Ai ghi | Ai đọc |
|---|---|---|
| `.office-desk/PROJECT.md` (dùng chung mọi session của project) | Lead Dev | Lead Dev, Dev |
| `.office-desk/<session>/GDD.md` | GD | Lead Dev (phần Dev), QA |
| `.office-desk/<session>/UIUX.md` (mỗi màn hình một mục SCR-…) | UI/UX | Lead Dev (chép phần cần làm vào task Dev), QA |
| `.office-desk/<session>/TASKS.md` | App, từ khối tasks của Lead | Người dùng, Lead |
| `.office-desk/<session>/ISSUES.md` | QA | Lead Dev |
| `.office-desk/<session>/PERF.md` | QA (pha performance) | Lead Dev |
| `.office-desk/<session>/CHANGES.md` | App, từ handoff của Dev | QA, Lead review |

**Quy tắc app thực thi** (không chỉ dặn trong prompt): GD chỉ ghi GDD.md và không chạy shell; UI/UX chỉ ghi UIUX.md và không chạy shell (Dev không đọc UIUX.md, chỉ nhận phần màn hình Lead chép vào task); Lead Dev chỉ ghi PROJECT.md; QA chỉ ghi ISSUES.md/PERF.md; Dev chỉ sửa các tệp Lead giao trong `files` của khối tasks. Ghi ngoài phạm vi bị app từ chối kèm lý do; ghi trong phạm vi không hỏi. Role có phạm vi luôn chạy CLI ở permission mode `default` để mọi lần ghi đi qua app. **Lead Dev, Dev, VFX, QA luôn được chạy lệnh shell** (build, test, script kiểm tra) ở mọi mode: hỏi từng lần, Bypass thì không hỏi, lượt tự động đã duyệt thì tự cho phép. GD và UI/UX không bao giờ chạy shell. Khối Dev/VFX/QA mới mặc định mode Đọc & sửa; model mặc định Sonnet. Mô tả trách nhiệm/đầu ra mặc định của từng role viết ngắn kèm tiêu chí xong; session cũ giữ mô tả đã chép lúc chọn role.

**Báo vấn đề mới giữa chừng.** Chat vấn đề rồi chạy GD: khi GD chốt (`done`) trong lúc luồng đã đi qua GD hoặc đã hoàn tất, app mở **vòng mới** từ bước sau GD (UI/UX → Lead planning → Dev → QA → review), xoá trạng thái vòng trước (pha QA, số lần review, task Dev đã xong). Còn task Dev đang chạy thì app chờ và báo dùng `/chot` sau. GD còn câu hỏi (`blocked`) thì không mở vòng mới.

**Luồng.** GD làm rõ yêu cầu với bạn và ghi GDD (US/AC, phân việc theo khối, ngân sách performance) → Lead Dev chia task, mỗi task có `files` không chồng nhau → các Dev **sửa song song** khi tệp không trùng (app kiểm theo tệp thay vì theo thư mục) → khi mọi Dev xong, QA kiểm theo GDD/AC, ghi ISSUES.md → Lead lập lại kế hoạch sửa → khi hết Issue và không có Issue mới, QA chuyển sang **pha performance** (GC Alloc, CPU, GPU theo ngân sách trong GDD; GDD ghi "Không áp dụng" thì bỏ qua) → Lead review (clean, gộp code trùng). Review không đạt thì Dev sửa thêm **đúng 1 lần**; lần sau vẫn không đạt thì dừng chờ bạn.

**Token.** Lead/Dev/QA không nhận lịch sử chat (đọc trạng thái từ tệp) và tiếp tục phiên CLI của mình, CLI tự compact khi ngữ cảnh lớn (xem mục "Phiên không bao giờ bị bỏ"); Dev không nhận GDD và danh sách đội. GD vẫn nhận hội thoại vì cần trao đổi với bạn. Lịch sử gửi cho GD bỏ tin hệ thống, tin điều phối và tin lỗi. Khối mới: GD và Lead dùng Opus 5.5, Dev/QA/UI/UX dùng Sonnet (khối cũ giữ model đã lưu). Giới hạn lượt tool mỗi lượt chat: GD 30, Lead 30, Dev 60, QA 40; chạm giới hạn thì task bị chặn để bạn kiểm tra. Panel phải có nút mở từng tệp .md và danh sách tệp Dev được sửa.

Thư mục `.office-desk/` nằm trong project của bạn; tự quyết có thêm vào `.gitignore` của project hay không. Đã thử với Claude Code thật: Dev bị chặn ghi tệp ngoài danh sách, GD ở mode Plan ghi được GDD.md và không có shell. Chưa chạy trọn một vòng GD → Lead → Dev → QA → review bằng tài khoản thật.

## Duyệt từng thao tác, thêm web/notebook/danh sách việc

**Duyệt từng thao tác.** Lượt chat chạy Claude Code ở chế độ stream-json hai chiều (`--input-format stream-json --permission-prompt-tool stdio`): khi Claude muốn ghi/sửa tệp, chạy lệnh shell hoặc đọc web, CLI hỏi app và app hiện hộp **Duyệt thao tác** với nội dung cụ thể: lệnh shell, diff `-`/`+` của Edit, nội dung Write, URL/từ khoá web. Chọn Từ chối thì Claude nhận lý do và đổi hướng; tick **Luôn cho phép <tool> tới hết lượt này** để không bị hỏi lại tool đó trong lượt. Khối đang chờ hiển thị "chờ bạn duyệt …"; thẻ tin ghi các thao tác bạn đã từ chối.

| Mode | Tool có | Hỏi |
|---|---|---|
| Plan | Read, Glob, Grep, TodoWrite, WebFetch, WebSearch | Web hỏi từng lần |
| Đọc & sửa | + Write, Edit, NotebookEdit, Bash | Mọi ghi/sửa/shell/web hỏi từng lần (không còn hỏi trước cả lượt) |
| Auto | như Đọc & sửa | CLI tự xét trước, chỉ hỏi khi cần; web hỏi từng lần |
| Bypass | như Đọc & sửa, **không có web** | Không duyệt từng thao tác; chỉ hỏi trước lượt khi thư mục ở ổ được bảo vệ |

Lượt do bộ chạy tự động gửi (đã duyệt một lần khi bật) tự cho phép từng thao tác, **trừ web vẫn hỏi**. Trình duyệt, hooks và plugin vẫn tắt; subagent chỉ có loại đọc code (xem mục "Subagent đọc code"). Web luôn hỏi nhờ quy tắc `ask` trong settings do app tạo (thiếu quy tắc này, mode plan của CLI tự cho chạy WebSearch). Đã chạy thử với Claude Code 2.1.316 và tài khoản thật (model haiku) qua `chat.cjs`: Write/Bash/WebFetch hỏi và chạy được, từ chối thì không tạo tệp và Claude báo lại, Plan không ghi được, web ở Plan/Auto hỏi, Bypass không có web, resume phiên cũ giữ ngữ cảnh. Hộp thoại Electron (bấm tay) chưa được chạy cùng CLI thật trong kiểm thử tự động.

## Bố cục mới, lưu trữ/xoá/chuyển session

**Bố cục 3 cột.** Sidebar session · hội thoại · panel khối bên phải. Bấm một khối trên sơ đồ để chọn: panel hiển thị tiến độ, tài khoản, mode, model, task và (mục thu gọn) trách nhiệm/yêu cầu riêng, tự lưu khi rời ô. Không có role thì panel là cấu hình chat thường. Nút **▣ Khối** ẩn/hiện panel (nhớ theo máy). Header chỉ còn tiêu đề, token, **📁 Thư mục** và menu **⋯** (Ghim, Chuyển tới dự án, Sửa yêu cầu, Thử lại task bị chặn, Lưu trữ). **＋ Role** nằm cuối sơ đồ khối. Các nút bàn giao thủ công (Bắt đầu bước, Bàn giao, Issue → Lead, Review không đạt) gom vào menu **Thủ công** dưới ô nhập.

**Session.** Rê chuột vào session ở sidebar rồi bấm **⋯** (hoặc chuột phải) để ghim, chuyển tới dự án, lưu trữ; hoặc kéo session thả vào tên nhóm/dự án. Session lưu trữ nằm trong nhóm **🗄 Đã lưu trữ**, chỉ xem, không chạy được; từ đó có thể **Khôi phục** hoặc **Xoá hẳn** (xoá hội thoại và ảnh đính kèm trong app, không khôi phục được; lịch sử CLI của Claude Code không bị đụng tới). Không lưu trữ/xoá được khi khối hoặc terminal của session đang chạy.

## Bản 0.10.0 — Shell/MCP, chạy tự động, tiến độ và lệnh /role

**Shell và MCP.** Mode Đọc & sửa, Auto và Bypass có thêm Bash (shell). Plan vẫn chỉ đọc. MCP server khai báo trong `%APPDATA%/office-desk/mcp-servers.json` (`/mcp open` để mở, `/mcp` để xem danh sách); chỉ nạp các server trong tệp này (`--strict-mcp-config`). Ở mode Đọc & sửa, tool `mcp__<tên>` được cho phép sẵn; Auto để CLI xét; Bypass bỏ duyệt. Tên server chỉ gồm chữ, số, `_`, `-`; tệp sai cú pháp thì lượt chat báo lỗi, không bỏ qua ngầm. Tool Read/Grep/Glob vẫn bị chặn đọc `.env`, `.pem`, khóa SSH, `.credentials.json`, nhưng **lệnh shell vẫn đọc được các tệp này** (ví dụ `type .env`): chỉ mode Plan thực sự không đọc được. Không đặt thư mục chứa bí mật vào session có Bash. Shell chạy với quyền tài khoản Windows của bạn — không phải sandbox.

**Xác nhận.** Đọc & sửa/Auto duyệt từng thao tác (xem mục trên; trước đây hỏi một lần mỗi lượt). **Bypass chỉ hỏi khi có thư mục của session nằm ở ổ C, ổ cài Windows, ổ chứa hồ sơ người dùng hoặc thư mục mạng** (kể cả ổ mạng đã map, ổ `subst` và junction trỏ vào các nơi đó); thư mục ở ổ khác chạy ngay. Duyệt chạy tự động một lần chỉ còn hiệu lực khi mode các khối và danh sách thư mục giữ nguyên; đổi một trong hai thì lượt tự động hỏi lại.

**Đường dẫn trong tin nhắn.** Thư mục được cấp/đổi từ tin nhắn được ghi lại trong hội thoại. Gốc ổ đĩa, thư mục Windows, Program Files và ProgramData không được tự cấp; dùng Thêm thư mục nếu thật sự cần.

**Chạy tự động.** Mỗi role kết thúc câu trả lời bằng khối ```` ```handoff ```` JSON (`done`/`blocked`/`issue`/`pass`/`reject`). Khi GD xuất `done` (đã chốt, không còn câu hỏi) hoặc bạn gõ `/chot`, app bật tự động và chạy lần lượt UI/UX → Lead Dev (khối `tasks`) → các Dev theo phụ thuộc → QA → role tùy chỉnh → Lead review → Hoàn tất, không cần bấm Bắt đầu/Bàn giao/Chạy. QA `issue` → Lead triage → Dev sửa → QA retest (giới hạn 3 vòng như cũ, sau đó chờ bạn quyết định). Lead review `reject` → Dev sửa theo khối `tasks` (hoặc giao lại Dev của lượt trước). Bật tự động hỏi một lần nếu có khối cần xác nhận (theo quy tắc trên); sau đó các lượt tự động không hỏi lại tới khi `/auto off`. Thiếu khối handoff/tasks hợp lệ, `blocked`, lỗi CLI hoặc Dev bị chặn thì dừng ở bước đó và ghi rõ trong hội thoại — không đoán từ văn bản tự do.

**Lệnh chat.** `/role <tên khối> start|pause` (ví dụ `/role Lead Dev pause`, `/role Dev #2 start`): pause dừng lượt đang chạy của khối, giữ task ở trạng thái Tạm dừng và bộ tự động chờ tại khối đó; start bỏ tạm dừng rồi chạy tiếp task/bước tự động hoặc chạy khối với task riêng. `/auto on|off`, `/chot`. Lệnh slash dùng được cả khi khối đang trả lời.

**Tiến độ.** Khối đang chạy hiển thị thời gian, công cụ đang dùng (ví dụ `Edit main.cjs`, `Bash npm.cmd test`) và số bước; dòng dưới sơ đồ cho biết tự động bật/tắt và số Dev đã xong/đang chạy/bị chặn. Thẻ tin nhắn đã xong ghi tổng thời gian.

**Sửa cuộn.** Hội thoại không còn nhảy lên đầu khi đang stream hoặc khi usage cập nhật mỗi 10 giây; chỉ thẻ thay đổi được dựng lại, giữ nguyên vị trí cuộn và vùng chữ đang chọn.

Đã viết test unit cho parser handoff/lệnh, chuỗi tự động GD → … → Hoàn tất bằng phụ thuộc giả lập, quy tắc xác nhận Bypass/ổ C và tiến độ công cụ. Chưa chạy end-to-end với tài khoản và Claude Code thật.

## Bản 0.8.0 — đường dẫn trong yêu cầu và Dev theo Lead

Đường dẫn Windows tuyệt đối hiện có trong tin nhắn của bạn được nhận trực tiếp: đặt đường dẫn trên một dòng riêng (như ảnh), hoặc bọc trong dấu nháy kép/backtick nếu có khoảng trắng. Đường dẫn đầu tiên trở thành thư mục chính, các thư mục được cấp trước vẫn là thư mục liên quan. Nếu gửi file, cwd là thư mục chứa file. Không cần bấm Thêm thư mục. Path không tồn tại không tự suy diễn thành thư mục cha. App chỉ nhận scope từ tin nhắn người dùng, không tự cấp đường dẫn mới do model/Lead ghi trong task. Gửi đường dẫn là cấp phạm vi đọc cho CLI; sửa tệp vẫn theo mode và xác nhận trước lượt.

Tạo Lead Dev và nhiều Dev, cấu hình tài khoản/model/mode riêng rồi chạy Lead. Lead nhận roster và phải xuất fenced block tasks với JSON tasks gồm worker, task và dependsOn tùy chọn. App kiểm tra tên Dev, trùng owner và chu kỳ phụ thuộc; phân công hợp lệ được áp dụng và tự xếp chạy Dev, không cần bấm từng Dev. Task độc lập có thể chạy song song, task phụ thuộc đợi các lượt tiền nhiệm trả kết quả. Không suy đoán task từ văn bản tự do khi JSON không hợp lệ; báo rõ trong hội thoại.

Các lượt đọc chạy song song tối đa 8 chat. Lượt ghi ở thư mục chồng lấn vẫn chờ để tránh ghi đè, không tự bỏ khóa để đạt số lượng song song. Một Dev chưa đăng nhập/lượt bị hủy/lỗi sẽ chặn dependency, không giả vờ hoàn tất. Dùng Thử lại task bị chặn sau khi xử lý; với xung đột từ session khác cũng có thể cần nút này. Đóng app không tự chạy lại việc có thể tính phí: các task đang chạy được đánh dấu cần kiểm tra khi mở lại. Dừng khối hủy lượt của khối đó và không tự khởi động lại nó. Trạng thái Đã trả kết quả không phải QA pass hoặc xác nhận code đúng.

Chưa có tự động merge worktree, chạy QA/Unity hoặc tự đánh giá AC. Chưa kiểm thử đa tài khoản thật; kiểm thử scheduler/parser dùng dữ liệu mô phỏng, không phải bằng chứng các Dev đã thực hiện task game thật.

## Bản 0.7.0 — nhập liệu, model, usage và xem file

Enter gửi, Shift+Enter xuống dòng; khi gợi ý lệnh đang mở, Enter chọn gợi ý trước, nhấn Enter lần nữa để gửi. Không gửi trong lúc IME đang ghép chữ. Session mới mặc định dùng model chính xác claude-opus-5-5 (Opus 5.5); session/role cũ giữ lựa chọn đã lưu và có thể đổi bằng dropdown. Model được xác nhận tại https://support.claude.com/en/articles/11940350-claude-code-model-configuration; quyền sử dụng vẫn phụ thuộc tài khoản.

Đường dẫn trong inline code có thể bấm để xem file, hỗ trợ :line hoặc :line:column. Chỉ đọc file text tối đa 2 MB trong thư mục đã cấp, kiểm tra realpath để chặn thoát qua ../ hoặc symlink; không tự mở tệp nhị phân, .git/.claude/.ssh hoặc tên bí mật phổ biến. Nội dung hiển thị plain text, không thực thi HTML/script, có nút copy. Code fence bắt đầu bằng ```text (hoặc nhãn ngôn ngữ khác) và kết thúc bằng ``` hiển thị thành khối có nút Copy riêng; không copy dấu fence. Copy chỉ ghi clipboard khi người dùng bấm.

Usage: bổ sung nhận rate_limit_event từ luồng chat. Nếu CLI chỉ báo allowed/reset mà không có utilization, hiển thị trạng thái và reset, không tự tạo %. /usage hoặc nút Xem usage chính thức mở terminal /usage trong một dialog ngay trên dashboard, không chuyển màn hình. Đây là giao diện tương tác chính thức; có thể cần hoàn tất onboarding trong dialog trước. Đóng dialog dừng tiến trình usage đó. Quota đầy đủ vẫn phụ thuộc dữ liệu CLI xuất; không có API quota riêng, không đọc token. Không tuyên bố đã kiểm thử quota bằng tài khoản thật.

## Bản 0.6.1 — Auto/Bypass, thêm role và đăng nhập

Mode có Plan, Đọc & sửa, Auto và Bypass cho session/khối. Auto dùng permission-mode auto của CLI, không phải tự bấm đồng ý. Bypass dùng bypassPermissions, bỏ duyệt thao tác tệp của CLI; app vẫn xác nhận trước lượt ghi và không cấp shell/MCP. Bypass có thể bỏ bảo vệ đường dẫn của CLI, nên chỉ dùng với dữ liệu thử/môi trường cô lập; chọn thư mục không tạo sandbox. Auto có thể không khả dụng với model/gói/managed policy của bạn; CLI báo lỗi thì app hiển thị lỗi, không tự hạ sang Bypass.

+Role mở dialog chuyên biệt không phụ thuộc form chỉnh tên. Chưa có session thì tự tạo session trống trước, rồi chọn để thêm GD/Lead/Dev/QA/UIUX. Không bắt buộc nhập tên hoặc yêu cầu để dùng nút này.

Khi chọn tài khoản sidebar hoặc gán tài khoản khác cho role, app chạy claude auth status --json với đúng CLAUDE_CONFIG_DIR. Đã đăng nhập thì tái sử dụng phiên đó. Chưa đăng nhập thì tự mở claude auth login trong terminal và để CLI mở trình duyệt; bạn vẫn phải tự xác thực/đồng ý. App không tự điền mật khẩu hoặc chuyển cookie. Sau khi CLI đăng nhập/đăng xuất kết thúc, app kiểm tra lại. Khi gửi chat mà hồ sơ chưa đăng nhập, yêu cầu đang soạn được lưu tạm để quay về gửi sau đăng nhập; không tự gửi prompt có phí. Kiểm tra status không đọc/ghi token. Nếu thiếu CLI hoặc status không đúng schema, app báo lỗi thay vì đoán. Việc chọn hồ sơ không xác minh người dùng đã đăng nhập đúng email họ đặt tên; hãy kiểm tra trong CLI.

Đã qua 17 test unit/process và UI smoke. Luồng OAuth/tài khoản thật, Auto classifier và Bypass trên dữ liệu thật chưa được chạy trong môi trường build.

## Bản 0.6.0 — nhiều worker theo role

Thêm role nhiều lần để tạo Dev, Dev #2, v.v. Có UI/UX theo GDD. Click khối để chọn tài khoản, mode, model và task riêng; lưu khi rời ô/chọn giá trị. Dropdown mode/model dưới chat áp dụng cho khối đang chọn. Nhấn Chạy tên khối hoặc Gửi để chạy khối đó, rồi chọn khối khác và gửi tiếp để chạy song song. Dừng khối chỉ hủy lượt của khối đang chọn. Tối đa 8 lượt chat. Nếu chưa gán tài khoản, lượt mới dùng tài khoản sidebar; lượt đã chạy giữ cấu hình chụp tại lúc bắt đầu. Đăng nhập/đăng xuất cùng profile đang chạy CLI tương tác vẫn cần đóng phiên đó; chọn profile khác cho role không cần đăng xuất.

Lịch sử text lưu chung theo session, không xóa khi đổi tài khoản. Native CLI resume tách theo hồ sơ/thư mục/khối. Khi sang tài khoản khác, app chuyển ngữ cảnh text đã lưu sang lượt mới, không sao chép token/cookie hoặc chuyển native session giữa tài khoản; không bảo đảm giữ mọi hidden state/tool context của CLI cũ. Mọi role trong cùng session có thể nhận ngữ cảnh dùng chung; không đặt dữ liệu bí mật vào session nếu không muốn chia sẻ sang tài khoản được gán. Đổi cấu hình chỉ áp dụng lượt tiếp theo, không sửa tiến trình đang chạy.

Lead được cung cấp danh sách các Dev và task hiện tại, yêu cầu chia task theo owner, phạm vi file, AC và dependencies. Nếu Lead xuất JSON hợp lệ trong fenced block tasks, app lưu đề xuất; nhấn Duyệt phân công Lead để xem và áp dụng vào task riêng từng Dev. Không tự chạy Dev hoặc tự cho QA pass. Nếu model không xuất đúng định dạng thì không có đề xuất tự áp dụng; có thể ghi task vào từng khối. Chưa có bộ điều phối hoàn toàn tự động.

Các lượt chỉ đọc có thể song song; lượt sửa tệp trong các thư mục chồng lấn bị chặn để tránh Dev ghi đè. Muốn các Dev sửa song song cần các session/worktree có thư mục không chồng lấn và quy trình hợp nhất riêng; app không tự tạo/merge worktree. Đây không phải sandbox hay khóa filesystem chống công cụ ngoài app.

## Bản 0.5.0 — chat trực tiếp

Gửi yêu cầu hoặc Chạy role giờ dùng Claude Code --print --output-format stream-json, phản hồi ngay trong session; không tự chuyển trang terminal. Có hiển thị Markdown cơ bản an toàn (heading, bold, inline code, code block, bullet); không chèn HTML từ model. Lưu lịch sử và resume theo session/hồ sơ/thư mục/role; chuyển tài khoản không dùng chung native conversation. Terminal cũ chỉ phục vụ đăng nhập và công cụ tương tác riêng.

Mode Plan chỉ có Read/Glob/Grep. Mode Đọc & sửa tệp xác nhận trước mỗi lượt và cho phép Read/Glob/Grep/Write/Edit cho lượt đó. Không có shell/MCP; đây không phải sandbox filesystem. Print mode không có prompt quyền tương tác: các thao tác ngoài danh sách bị chặn và được báo trong text. Không dùng bypassPermissions. Nếu CLI yêu cầu đăng nhập, lỗi sẽ hiển thị trong chat; vào quản lý tài khoản đăng nhập rồi thử lại. Chọn Sonnet/Opus/Haiku; model thực tế do CLI/gói tài khoản hỗ trợ, không bảo đảm model nào cũng truy cập được.

Gõ / hiện gợi ý, phím lên/xuống, Tab/Enter chọn và Escape đóng. /help, /model, /status, /mcp, /usage trong chat là xử lý cục bộ của app: /status chỉ báo cấu hình, /mcp báo MCP đang tắt, /usage chỉ hiện snapshot đã nhận, không giả vờ đã gọi CLI. Các lệnh tương tác khác cần terminal. Model thay bằng dropdown. Hạn mức sidebar vẫn phụ thuộc dữ liệu do CLI cung cấp; print mode có thể không gọi statusLine, không cam kết quota live. Xem usage chính thức trong menu tài khoản vẫn mở CLI tương tác.

Nút Role chỉ thêm role vào luồng. × trên khối xóa với xác nhận. Click khối mở phần trên là trách nhiệm/đầu ra mặc định, phần dưới là nhiệm vụ riêng session; thay đổi tự lưu khi rời ô. Sửa mặc định được tái sử dụng cho lần chạy sau và session khác; nhiệm vụ riêng không lan sang session khác. Hai stage Lead Planning/Lead Review dùng chung mặc định Lead Dev. Thay đổi khi agent đang chạy không sửa lượt đang thực thi, chỉ áp dụng lần chạy sau. Bàn giao/QA pass vẫn do người dùng xác nhận, chưa tự điều phối toàn bộ team.

Đã kiểm thử parser bằng event mô phỏng và UI; chưa gửi prompt thật hoặc xác minh ảnh/usage với tài khoản thuê bao trong môi trường build. Cần kiểm thử end-to-end trên tài khoản của bạn. Nếu CLI đổi định dạng hoặc quyền, lỗi sẽ được báo thay vì giả lập phản hồi.

## Bản 0.4.0 — cấu hình role và lệnh CLI

Role: bỏ tích và Lưu để xóa khỏi luồng. Mỗi role hiển thị trách nhiệm, đầu ra và yêu cầu riêng cho session, có nút lưu cấu hình. Tích Dùng làm mặc định để tái sử dụng trách nhiệm/đầu ra cho session sau; yêu cầu riêng không lan sang session khác. Khi đã chạy, đổi/xóa role hoặc sửa yêu cầu đòi hỏi xác nhận bắt đầu lại; lịch sử vẫn được giữ và Issue cần retest. Sửa yêu cầu chỉnh nội dung đầu vào, cập nhật tên session và ghi lại nội dung cũ. Thay đổi dashboard không sửa cuộc hội thoại CLI đang chạy, cần dừng phiên cũ trước khi chạy lại với cấu hình mới.

Chạy role trong CLI mở một phiên với trách nhiệm/đầu ra/yêu cầu riêng và nội dung bàn giao. Kết quả vẫn hiển thị ở terminal, không tự quyết định pass hoặc tự bàn giao. Không có bảo đảm output phù hợp nếu thiếu project/công cụ; cần kiểm tra thật.

Ô chat có menu /mcp, /model, /status, /usage, /help. Gửi lệnh slash mở phiên CLI để chạy lệnh tương tác; có thể dùng trực tiếp các lệnh trong terminal đang chạy. App không tự chèn lệnh/phím vào terminal đang chờ quyền; đang có phiên của cùng session thì vào Tài khoản & terminal để tiếp tục. /mcp mở giao diện CLI, nhưng MCP vẫn strict/empty theo chính sách hiện tại: không tự nhập cấu hình user, bật server, shell hoặc Unity. Gỡ cờ disable-slash-commands để CLI xử lý các lệnh/skills; cần đánh giá kỹ năng tự cấu hình trước khi sử dụng, các quyền tool hạn chế vẫn giữ nguyên.

Trong menu tài khoản có Xem usage chính thức (/usage), mở đúng hồ sơ bằng CLI (không cần chọn thư mục dự án). Đăng nhập riêng không tạo rate_limits. Snapshot sidebar chỉ có khi statusLine nhận dữ liệu hợp lệ; /usage có thể hiện quota chính thức trong terminal dù CLI không xuất các trường tương ứng. Cần mở phiên mới sau nâng cấp, chấp nhận workspace trust phù hợp và CLI hỗ trợ statusLine. App không đọc token/endpoint nội bộ và không giả định quota 0% khi không có dữ liệu. Chưa kiểm thử usage tài khoản thật trong môi trường build.

## Bản 0.3.2 — chọn role

Nút Role mở danh sách checkbox GD, Lead Dev, Dev, QA, cho phép chọn nhiều. Từ 0.9, Lead Dev là **một khối duy nhất** làm ba pha planning → triage → review (session cũ có hai bước Lead tách rời được tự gộp khi mở app); thứ tự luồng chuẩn hóa theo GD → UI/UX → Lead Dev → Dev → QA, role tùy chỉnh đứng cuối. Bỏ chọn tất cả dùng Claude Code thường. Role tùy chỉnh đã tồn tại vẫn hiển thị để chọn; chỉ đổi cấu hình trước khi bắt đầu quy trình để tránh làm sai trạng thái bàn giao.

## Bản 0.3.1 — nhiều thư mục và usage

Thêm thư mục cho phép chọn nhiều lần hoặc nhiều thư mục trong hộp chọn. Thư mục đầu là cwd chính, các thư mục liên quan được truyền bằng --add-dir khi mở phiên mới. Nhấn × để bỏ khỏi cấu hình, không xóa thư mục trên đĩa; bỏ thư mục chính sẽ lấy thư mục kế tiếp làm chính. Phiên đang chạy giữ nguyên quyền/thư mục ban đầu. Tối đa 16 thư mục mỗi session.

Usage dưới tên hồ sơ và trong menu lấy từ rate_limits của status line chính thức Claude Code: https://code.claude.com/docs/en/statusline. Chỉ chạy script PowerShell cố định do app cung cấp, ghi phần trăm và thời điểm reset; không đọc token, không gọi API hạn mức nội bộ. Đây là ngoại lệ có kiểm soát cho cấu hình statusLine, không bật hooks hoặc shell tool cho agent. App đọc snapshot cục bộ mỗi 10 giây; dữ liệu chỉ có sau khi CLI cung cấp (thường sau phản hồi đầu), phụ thuộc gói tài khoản/phiên bản CLI. Không tự gửi prompt để lấy usage. Hiển thị đã dùng 5 giờ/7 ngày, reset và thời điểm cập nhật; trên 15 phút ghi dữ liệu cũ, hết thời điểm reset thì ẩn cửa sổ đó. Không có dữ liệu không đồng nghĩa còn 100%. Chưa kiểm thử usage bằng tài khoản thật; dữ liệu mock chỉ dùng trong test. Đăng nhập/đăng xuất từ app xóa snapshot cũ của hồ sơ. Nếu đăng nhập tài khoản khác ngoài app vào cùng hồ sơ, cần khởi động phiên mới và đợi cập nhật.

## Bản 0.3.0 — session nhanh, thư mục và ảnh

Nhấn Session mới để mở ngay một session trống, không nhập tên. Tên lấy từ 70 ký tự đầu của yêu cầu đầu tiên (chuẩn hóa khoảng trắng), không phải tiêu đề được model tự tóm tắt. Mỗi session mới mặc định không có role, chạy Claude Code thường. Chọn hồ sơ đã đăng nhập và Chọn thư mục ở phía trên, nhập yêu cầu rồi Gửi: CLI chính thức mở trong terminal với yêu cầu đó. Các câu tiếp theo trao đổi trong terminal; vùng text dashboard không tự stream phản hồi Claude. Nếu terminal đang chạy, tiếp tục tại Tài khoản & terminal; không tự gửi phím vào prompt cấp quyền. Khi terminal đã đóng, Gửi từ dashboard sẽ tạo cuộc hội thoại CLI mới.

Có thể kéo thả tối đa 8 ảnh PNG/JPEG/WebP, mỗi ảnh tối đa 20 MB, vào cửa sổ. App sao chép ảnh vào attachments trong userData và chuyển đường dẫn cho Claude Code đọc khi gửi yêu cầu. Việc đọc có thể cần xác nhận quyền từ CLI. Hiện hiển thị tên ảnh đính kèm, chưa có thumbnail hoặc nút xóa. Chỉ gửi ảnh bạn có quyền chia sẻ. Chưa có chứng minh nhận diện ảnh bằng tài khoản thật trong kiểm thử tự động.

Nút Role thêm role vào session hiện tại, không còn ép sẵn quy trình GD/Lead/Dev/QA. Session cũ giữ nguyên flow. Chế độ có role vẫn quản lý và bàn giao thủ công, chưa tự chạy agent. Folder là phạm vi bắt đầu của CLI, không phải sandbox hệ điều hành.

## Bản 0.2.1 — chọn tài khoản

Nút dưới cùng sidebar hiển thị tên hồ sơ đang chọn. Bấm để mở danh sách, chọn hồ sơ khác hoặc vào Thêm/quản lý tài khoản & terminal. Lựa chọn lưu trong workspace.json và dùng chung với màn hình terminal. Chuyển hồ sơ chỉ áp dụng khi mở phiên mới, không đổi tài khoản của terminal đang chạy. Tên hiển thị là nhãn hồ sơ người dùng đặt, không phải trạng thái đăng nhập đã được xác minh hoặc email lấy từ Claude. Escape/nhấp ngoài đóng menu, phím mũi tên chọn mục.

## Bản 0.2.0 — giao diện team

Màn hình mặc định là Sessions: tạo session bằng tên/yêu cầu đầu vào, ghim, tìm kiếm, nhóm theo dự án và chuyển dự án. Session không chọn dự án nằm trong Không thuộc dự án. Sơ đồ GD → Lead Dev → Dev → QA nằm phía trên (0.9: QA báo Issue thì về Lead Dev triage → Dev sửa → QA retest, tối đa 3 vòng rồi chờ người dùng quyết định; QA pass thì về Lead Dev review → Hoàn tất); nội dung text và nhật ký bên dưới. Metadata, tin nhắn, Issue và trạng thái được lưu trong workspace.json cùng hồ sơ cũ; không cần xóa dữ liệu bản 0.1.0.

Đây là quản lý quy trình thủ công, chưa có agent tự nhận việc hay trả lời trong hội thoại. Nhấn Bắt đầu bước; nhập kết quả/bằng chứng vào ô text rồi Bàn giao. Gửi chỉ lưu ghi chú. Issue → Lead chuyển về Lead Planning, sau đó Dev và QA; QA phải đang làm và có ghi chú retest để đóng từng Issue trước khi bàn giao. Trạng thái hoàn tất là xác nhận thủ công, không phải chứng nhận code hoặc performance. Role mới thêm cuối quy trình của session tạo sau đó; chưa có chỉnh graph tùy ý hoặc gán tài khoản theo role. Tài khoản & terminal mở giao diện CLI cũ; nút Sessions & đội ngũ quay về. Terminal đang chạy vẫn giữ trong cùng app khi chuyển trang, không được tự gắn vào nội dung team.

App Electron độc lập, tham khảo kiến trúc nhiều hồ sơ của https://github.com/khanh020905/my-office. Viết mới phần chạy và giao diện; không đóng gói server hoặc script của repo gốc. Không cần Claude Desktop. Đây là giao diện terminal làm việc với Claude Code, không phải Cowork chính thức hoặc bản sao văn phòng 3D.

## Chạy

Cài Node.js LTS và Claude Code chính thức theo https://code.claude.com/docs/en/setup. Không tải binary từ nguồn lạ. Tại PowerShell:

```powershell
cd "E:\FreeTimes\claude-office-desk"
npm.cmd ci
npm.cmd start
```

Nếu chưa có package-lock.json, dùng npm.cmd install thay npm.cmd ci. Bản Windows x64 dùng native binary Node-API dựng sẵn của node-pty, không rebuild cho Electron. Người dùng bộ cài không cần Node hoặc Build Tools, nhưng cần cài Claude Code riêng. Cấu hình này chỉ được nhắm tới Windows x64.

## Sử dụng

1. Chọn Claude Code: tìm đường dẫn bằng `where.exe claude` tại PowerShell, chọn `claude.exe` chính thức hoặc `claude.cmd` nếu đã cài bằng npm. App không tự tìm rồi thực thi một binary tùy ý trong thư mục dự án.
2. Thêm hồ sơ. Nhấn Đăng nhập. Terminal trong app chạy `claude auth login`; trình duyệt do CLI mở, có thể chọn tài khoản hoặc dùng cửa sổ riêng tư theo hướng dẫn CLI. App không tự mở URL lấy từ output của tiến trình. Nếu CLI chỉ in liên kết, sao chép và mở thủ công.
3. Chọn thư mục làm việc. Thử trên bản sao dữ liệu trước. Nhấn Phiên làm việc, đọc xác nhận trust/quyền của CLI và nhập yêu cầu vào terminal.
4. Ví dụ: “Đọc các tệp Markdown, tạo summary.md tổng hợp nội dung. Hỏi tôi trước khi sửa tệp hiện có.” Ghi/sửa tuân theo cơ chế quyền mặc định của CLI. Không chọn cho phép vĩnh viễn nếu bạn muốn duyệt từng thao tác.
5. Chọn hồ sơ khác để đăng nhập và mở phiên khác. Tab giữ phiên cũ và chỉ rõ chủ tài khoản. Thay hồ sơ hoặc thư mục không đổi tài khoản/cwd của phiên đã mở. Tối đa 8 phiên chạy và 20 hồ sơ.
6. Đóng các phiên của một hồ sơ trước khi đăng nhập lại/đăng xuất. Đăng xuất qua CLI không xóa lịch sử trên máy. Dùng dấu × để dừng phiên; đóng app yêu cầu xác nhận nếu có phiên đang chạy.

## Những phần đã bỏ so với repo tham chiếu

- Không đọc .credentials.json/keychain/token, không lấy usage từ endpoint không công khai.
- Không tự đổi tài khoản khi hết hạn mức; không giả lập đăng nhập hoặc chuyển cookie.
- Không server HTTP/WebSocket, LAN, PIN điện thoại, cloudflared hoặc tunnel.
- Không hooks cài vào cấu hình hiện tại, startup service, sửa editor, liên kết/chia sẻ lịch sử giữa tài khoản, dọn process hoặc xóa dữ liệu hệ thống.
- Không tự tải/cài/chạy công cụ từ internet; không telemetry riêng của app.

Từ 0.10, phiên làm việc cung cấp Read, Glob, Grep, Write, Edit và Bash (mode Plan chỉ Read/Glob/Grep); MCP chỉ gồm các server trong mcp-servers.json của app. Vẫn tắt trình duyệt, hooks và nguồn settings project/local trong lệnh khởi chạy (từ 0.12: web hỏi từng lần, subagent chỉ có loại đọc code); chỉ nạp nguồn user của hồ sơ riêng kèm cấu hình hạn chế do app tạo. Quyền quản trị tổ chức của CLI vẫn có thể áp dụng. Chỉ chặn đọc một số tên bí mật phổ biến, không thể nhận diện mọi tệp chứa bí mật. Để hỗ trợ tạo DOCX/XLSX bằng thư viện hoặc chạy lệnh sẽ cần thiết kế cơ chế cấp quyền bổ sung; bản này không hứa làm được mọi công việc Cowork.

## Ranh giới bảo mật

Không có phần mềm nào bảo đảm loại bỏ mọi nguy hiểm. Terminal chạy CLI chính thức với quyền tài khoản Windows hiện tại; đây KHÔNG phải sandbox filesystem hoặc VM. Thư mục làm việc là phạm vi bắt đầu, không phải hàng rào hệ điều hành. Claude có thể đọc nội dung bạn cấp quyền và gửi tới Anthropic. Chỉ chọn thư mục cần thiết, không chọn ổ đĩa hoặc thư mục chứa mật khẩu; dùng tài khoản Windows hạn chế/VM nếu dữ liệu nhạy cảm. Prompt injection trong tài liệu vẫn có thể ảnh hưởng hành vi; xem kỹ nội dung và đường dẫn trước khi đồng ý. Bộ chạy tự động chuyển bước theo khối handoff/tasks do chính model xuất ra: một tệp chứa chỉ thị độc hại mà model đọc được có thể khiến nó báo `pass`/`done` hoặc giao task tùy ý cho Dev, và các lượt tự động đã duyệt sẽ chạy tiếp mà không hỏi. Chỉ bật tự động trên mã nguồn bạn tin cậy và xem lại kết quả trước khi dùng.

CLAUDE_CONFIG_DIR được tạo riêng bằng UUID dưới `%APPDATA%/office-desk/profiles`. CLI sở hữu việc lưu/xử lý phiên đăng nhập và lịch sử; app chỉ giữ metadata tên/đường dẫn. Terminal có thể hiển thị URL đăng nhập hoặc nội dung nhạy cảm trong RAM, buffer giới hạn và không ghi log riêng; lịch sử của CLI vẫn nằm trên đĩa. UUID và partition không cô lập các người dùng cùng tài khoản Windows. App loại các biến môi trường Anthropic/Claude/cloud credential phổ biến khỏi tiến trình để tránh lấy nhầm tài khoản; không thể kiểm soát mọi kho credential cấp hệ điều hành của phần mềm ngoài.

Không có nút cho phép tất cả, không dùng dangerously-skip-permissions. CLI hoặc chính bạn vẫn có thể thay đổi lựa chọn cấp quyền trong phiên; không coi các mặc định là bảo đảm cưỡng chế trước người dùng máy. Bảo vệ thư mục app và profile khỏi phần mềm khác. Claude Code phải được giữ nguyên bản, cập nhật và xác minh nguồn cài đặt; tên claude.exe không chứng minh binary an toàn.

## Kiểm tra và build

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build:win
```

Bộ cài NSIS x64 xuất ở dist. Chưa ký số; Windows có thể cảnh báo SmartScreen. Ký mã và kiểm thử trên máy sạch trước khi phân phối. Dùng lockfile và npm ci để tái lập phiên bản. npm audit kiểm tra dependency, không chứng minh toàn bộ app an toàn.

Kiểm thử bằng tài khoản thật: đăng nhập A/B; kiểm tra `/status` đúng tài khoản; thử thao tác trên thư mục mẫu; từ chối Edit và xác nhận tệp không đổi; chấp nhận ghi tệp mẫu; thử yêu cầu chạy shell phải không có Bash; chuyển tab khi đang chạy; đóng app dừng phiên; khởi động lại đăng nhập còn riêng. Không tự động thực hiện đăng nhập hoặc gửi prompt tính phí trong kiểm thử build.

## Điều khoản

Tham chiếu https://code.claude.com/docs/en/legal-and-compliance và https://code.claude.com/docs/en/cli-reference, kiểm tra 31/10/2026. Claude Code hỗ trợ đăng nhập thuê bao, không mặc định yêu cầu API key; tài khoản phải có quyền sử dụng phù hợp. Tài liệu pháp lý nêu điều kiện tích hợp Claude Code vào sản phẩm: giữ nguyên binary và cơ chế xác thực, mỗi người dùng tự đăng nhập và chịu phí; việc đưa vào sản phẩm/dịch vụ cần tuân thủ Commercial Terms như tài liệu quy định. Có nhiều hồ sơ không có nghĩa được dùng để né hạn mức hoặc chia sẻ tài khoản. App không tuyên bố được Anthropic chứng nhận.
