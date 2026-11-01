// Mô tả ngắn (2–3 câu): gửi lại ở mọi lượt của Lead/Dev/VFX/QA. Không lặp phần app tự chèn (tệp .md, phạm vi ghi, handoff).
const defaults = {
  'UI/UX': { responsibility: 'Thiết kế luồng màn hình và trạng thái theo AC. Không đổi gameplay, không viết code.', output: 'Mỗi màn hình có luồng vào/ra, các trạng thái (bình thường, trống, lỗi, đang tải) và thông số layout cho Dev. Xong khi mỗi AC liên quan UI có màn hình và trạng thái tương ứng.' },
  'Art Director': { responsibility: 'Giữ style và chất lượng hình ảnh của game. Duyệt mockup UI/UX (vị trí, kích thước, phân cấp thị giác), viết đặc tả chi tiết từng ảnh, giao Art làm mới hoặc làm lại với yêu cầu rõ ràng, review ảnh và UI trong game (lệch style, lỗi visual, tối ưu texture). Quản lý tài nguyên dùng chung và theo feature. Không viết code gameplay.', output: 'STYLE.md (style guide, ngân sách texture), ASSETS.md (tài nguyên common và quy ước thư mục theo feature), ART.md (đặc tả từng ảnh ART-…), task Art chi tiết; review ghi đạt/không đạt kèm ảnh chụp và tiêu chí lệch. Xong khi mọi ảnh của vòng đạt STYLE.md và ART.md.' },
  GD: { responsibility: 'Làm rõ yêu cầu với người dùng tới khi không còn câu hỏi mở. Chốt phạm vi và chia việc cho UI/UX, Dev, VFX, QA. Không viết code, không chọn giải pháp kỹ thuật.', output: 'US/AC có ID và kiểm được (có số, có điều kiện; tránh "mượt", "đẹp"), mục VFX, ngân sách performance, câu hỏi mở. Xong khi mọi AC đều kiểm được và không còn câu hỏi mở.' },
  'Lead Dev': { responsibility: 'Chỉ nhận phần kỹ thuật. Chọn phương án, chia task tự hoàn thành và kiểm được, tệp của các task không chồng nhau. Triage Issue thành kế hoạch sửa; review sau khi QA xác nhận. Không tự sửa code của Dev.', output: 'PROJECT.md ngắn và đúng hiện trạng; mỗi task có phương án, AC liên quan, tệp được sửa, phụ thuộc; review ghi đạt/không đạt theo file:line. Xong khi mọi AC đã có task phụ trách.' },
  Dev: { responsibility: 'Làm đúng task, đúng tệp được giao. Không refactor ngoài task, không đổi AC, không tự xác nhận QA pass. Cần sửa tệp ngoài phạm vi thì báo trong handoff để Lead giao lại.', output: 'Code chạy được, có test cho logic chính nếu project có test; handoff liệt kê tệp, lý do và cách kiểm. Xong khi build/compile không lỗi và đã tự kiểm theo AC của task.' },
  VFX: { responsibility: 'Làm hiệu ứng theo mục VFX và ảnh tham chiếu, trong tệp được giao. Ưu tiên shader viết bằng code và script Editor thay vì sửa YAML/GUID tay. Không đổi gameplay.', output: 'Hiệu ứng kèm cách xem và chi phí ước tính (particle, overdraw, draw call). Xong khi có đủ cách xem và chi phí để người dùng hoặc QA đánh giá được.' },
  Art: { responsibility: 'Làm sprite, icon, ảnh UI và art 2D theo mục Art trong GDD, màn hình trong UIUX.md và ảnh tham chiếu, trong tệp được giao. Sinh/sửa ảnh bằng script, pipeline art của project hoặc MCP sinh ảnh được bật cho role. Không đổi gameplay, không sửa code ngoài phạm vi.', output: 'Ảnh đúng kích thước, pivot và import setting theo quy ước project; handoff liệt kê tệp, kích thước, cách sinh lại và ảnh cần người dùng xem. Xong khi ảnh đã import, console không lỗi và đã tự xem lại ảnh bằng Read.' },
  Anim: { responsibility: 'Làm animation (sprite theo frame, rig/skeletal 2D, Animator controller và state, timing, animation event) theo mục Anim trong GDD và đặc tả ANIM-… trong ART.md, trong tệp được giao. Tạo clip và Animator bằng script Editor hoặc pipeline animation của project. Không đổi logic gameplay; tham số Animator hoặc event mà code cần thì ghi rõ để Lead giao Dev.', output: 'Clip đúng số frame, fps, thời lượng, pose chính và event; Animator chuyển state đúng. Handoff liệt kê clip, frame/fps/thời lượng, event, tham số Animator, cách xem và cần kiểm tra trực quan gì. Xong khi clip chạy được trong Editor và đã tự xem chuỗi ảnh chụp các frame chính.' },
  QA: { responsibility: 'Kiểm theo AC, không kiểm theo cảm nhận; mỗi lỗi một Issue tái hiện được. Không sửa code. Không có công cụ để kiểm thì báo "chưa kiểm được", không đoán là pass. Test hook/cheat chỉ ở Editor/Development Build.', output: 'Bảng AC với đạt/không đạt và bằng chứng; Issue gồm ID, AC, các bước, kỳ vọng/thực tế; pha performance ghi số đo so với ngân sách. Xong khi mọi AC đều có kết quả kèm bằng chứng.' }
};
// Nhãn Lead cũ (≤ 0.8) chỉ còn để đọc dữ liệu cũ và migrate; không nơi nào sinh nhãn này nữa.
const LEGACY_LEAD = Object.freeze(['Lead Planning', 'Lead Review']);
const roleKey = role => LEGACY_LEAD.includes(role) ? 'Lead Dev' : role;
// US-02: model mặc định khi tạo khối mới. Chỉ Lead lập kế hoạch cần Opus; GD, Dev, QA, UI/UX dùng Sonnet (GD đổi sang Opus ở UI khi cần).
// Số đo 8 session: GD + Lead trên Opus chiếm 44% chi phí, phần lớn là output của Opus.
const DEFAULT_MODELS = Object.freeze({ 'Lead Dev': 'claude-opus-5-5' });
const FALLBACK_MODEL = 'sonnet';
// Art Director: chỉ một khối mỗi session, hai pha (planning: duyệt UI/UX, đặc tả ảnh, giao Art; review: kiểm ảnh/UI trong game).
const ART_DIRECTOR = 'Art Director';
const AD_PHASES = Object.freeze(['planning', 'review']);
// Lead pha triage/review làm việc hẹp hơn lập kế hoạch: khối để model mặc định thì chạy Sonnet ở các pha này.
// Chọn 'opus' (Opus) ở UI để Lead luôn chạy Opus.
const PHASE_MODELS = Object.freeze({ triage: 'sonnet', review: 'sonnet' });
const modelFor = (type, model, phase) => (type === 'Lead Dev' && model === DEFAULT_MODELS['Lead Dev'] && PHASE_MODELS[phase]) || model;
// Khối làm code/test mặc định Đọc & sửa: sửa tệp được giao và chạy lệnh (hỏi từng lần). Role khác theo mode của session.
const DEFAULT_MODES = Object.freeze({ Dev: 'edit', VFX: 'edit', Art: 'edit', Anim: 'edit', QA: 'edit', [ART_DIRECTOR]: 'edit' });
// Role được chạy shell trong phạm vi của mình ở mọi mode (permissions.roleScope đặt bash: true).
const SHELL_TYPES = Object.freeze(['Lead Dev', 'Dev', 'VFX', 'Art', 'Anim', 'QA', ART_DIRECTOR]);
// US-06: giới hạn số lượt tool trong một lượt chat (--max-turns).
// Dev/VFX 40: lượt dài làm ngữ cảnh phình, chi phí tăng nhanh hơn số lượt (session BaseTD: 60 lượt, ~150k token mỗi lần gọi).
const MAX_TURNS = Object.freeze({ GD: 30, 'Lead Dev': 30, Dev: 40, VFX: 40, Art: 40, Anim: 40, QA: 40, [ART_DIRECTOR]: 40 });
// Loại khối làm việc như Dev: nhận task từ Lead (khối tasks), sửa trong phạm vi tệp, chạy song song trong vòng Dev.
// Art: sprite, icon, ảnh UI (sinh bằng script/pipeline art hoặc MCP sinh ảnh bật riêng cho role). Anim: clip, Animator, rig 2D.
const DEV_TYPES = Object.freeze(['Dev', 'VFX', 'Art', 'Anim']);
const isDevType = type => DEV_TYPES.includes(type);
const DEFAULT_MAX_TURNS = 30;
// Ngưỡng tự compact của CLI (--autocompact, 100k–1M). Mỗi lần gọi model gửi lại toàn bộ ngữ cảnh (đọc từ cache), nên chi phí
// là kích thước ngữ cảnh × số lần gọi: với 1M, Dev chạy tới ~177k token mỗi lần gọi. 200k giữ ngữ cảnh mỗi lần gọi dưới ~200k.
const AUTOCOMPACT_WINDOW = '200k';
module.exports = { ART_DIRECTOR, AD_PHASES, defaults, roleKey, LEGACY_LEAD, DEFAULT_MODELS, FALLBACK_MODEL, PHASE_MODELS, modelFor, DEFAULT_MODES, SHELL_TYPES, MAX_TURNS, DEFAULT_MAX_TURNS, AUTOCOMPACT_WINDOW, DEV_TYPES, isDevType };
