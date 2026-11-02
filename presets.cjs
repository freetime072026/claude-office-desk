// Preset đội: bộ role chọn sẵn cho loại sản phẩm. Áp dụng thì mỗi khối có mục đích (workers[label].purpose) là preset đó;
// khối có mục đích dùng trách nhiệm/đầu ra trong config thay cho roleConfig/roleTemplates/defaults và chỉ nhận việc của preset.
// Mục đích đặt theo từng khối nên một session vẫn có thể có Dev làm game cạnh Dev làm PLA.
// PLA (Playable Ads): GD đóng vai PLA Producer; Lead giao Art/Anim trực tiếp nên không cần Art Director.
const PRESETS = Object.freeze({
  PLA: {
    name: 'Playable Ads (PLA)',
    roles: ['GD', 'UI/UX', 'Lead Dev', 'Dev', 'Art', 'Anim', 'Sound', 'QA'],
    guard: 'Khối này chỉ phục vụ làm playable ad (PLA): gameplay rút gọn, tutorial, end card, CTA, adapter network, build và nén asset cho playable. Việc ngoài PLA (tính năng game chính, backend, công cụ không dùng cho playable) thì không làm: bàn giao blocked kèm lý do để người dùng giao cho khối làm game.',
    // Engine chọn khi áp dụng preset (thread.engine); chưa chọn thì Lead chọn theo project. guide đi vào prompt mọi khối PLA.
    engines: {
      luna: { name: 'Luna Playable (Unity)', guide: 'Engine: Luna Playable trên project Unity. Chỉ dùng API/thành phần Unity mà Luna hỗ trợ (tra tài liệu Luna trước khi dùng tính năng mới), asset import qua Unity, xuất bản từng network bằng Luna Playground/công cụ build của project.' },
      cocos: { name: 'Cocos Creator', guide: 'Engine: Cocos Creator (TypeScript). Asset trong assets/, atlas bằng Auto Atlas, animation bằng Tween, Animation Clip hoặc Spine, âm thanh qua AudioSource; build web-mobile rồi đóng gói một tệp HTML bằng công cụ của project. Bỏ qua hướng dẫn riêng của Unity (Editor script, .meta, AudioMixer).' },
      phaser: { name: 'Phaser', guide: 'Engine: Phaser 3 (JS/TS) với bundler của project (Vite/webpack) inline asset thành một tệp HTML. Atlas TexturePacker JSON, animation bằng Tween hoặc anims sprite sheet, âm thanh qua Phaser Sound (WebAudio). Bỏ qua hướng dẫn riêng của Unity (Editor script, .meta, AudioMixer).' },
      pixi: { name: 'PixiJS', guide: 'Engine: PixiJS (JS/TS) với bundler của project inline asset thành một tệp HTML. Atlas TexturePacker JSON, animation bằng tween (GSAP nếu project có) hoặc AnimatedSprite, Spine qua pixi-spine nếu có; âm thanh qua @pixi/sound hoặc WebAudio. Bỏ qua hướng dẫn riêng của Unity (Editor script, .meta, AudioMixer).' },
      playcanvas: { name: 'PlayCanvas', guide: 'Engine: PlayCanvas. Model GLB nén (Draco/meshopt), texture nén nếu network cho phép, xuất một tệp HTML bằng công cụ playable của PlayCanvas hoặc script của project. Bỏ qua hướng dẫn riêng của Unity (Editor script, .meta, AudioMixer).' },
      threejs: { name: 'Three.js', guide: 'Engine: Three.js với bundler của project inline asset thành một tệp HTML. Model GLB nén (Draco/meshopt), ít draw call, ánh sáng bake sẵn khi được. Bỏ qua hướng dẫn riêng của Unity (Editor script, .meta, AudioMixer).' }
    },
    config: {
      GD: { responsibility: 'Đóng vai PLA Producer: chốt brief playable với người dùng (game gốc, network đích, hook, core loop 15–30 giây, kết thúc thắng/thua, end card, CTA, số biến thể cần ra). Chọn hook theo mục tiêu UA. Không viết code, không chọn engine.', output: 'GDD gồm storyboard theo giây (0–3s hook, tutorial hand, gameplay, thắng/thua, end card), US/AC kiểm được (thời gian vào gameplay, số lần chạm tới CTA, hướng màn hình), bảng network đích kèm giới hạn dung lượng và cách gọi CTA, danh sách biến thể (đổi gì: hook, màu, độ khó, end card). Xong khi mọi AC kiểm được và không còn câu hỏi mở.' },
      'UI/UX': { responsibility: 'Thiết kế tutorial hand, HUD tối giản, màn thắng/thua, end card và nút CTA cho cả màn dọc và ngang (9:16, 16:9, 4:3, safe area). Không đổi gameplay, không viết code.', output: 'Mỗi màn có layout dọc và ngang, vị trí và kích thước CTA, trạng thái tutorial hand, thời điểm hiện CTA. Xong khi mỗi AC liên quan UI có layout cả hai hướng.' },
      'Lead Dev': { responsibility: 'Chọn engine HTML5 theo project (Cocos, Phaser, PixiJS, PlayCanvas; Luna nếu nguồn là Unity) và pipeline build ra một tệp HTML duy nhất, asset inline, không request ngoài. Chia task theo module: gameplay, tutorial/end card, adapter network (MRAID, Google, Meta, Mintegral, TikTok/Pangle, Vungle…), build và nén asset. Review dung lượng và adapter sau khi QA xác nhận. Không tự sửa code của Dev.', output: 'PROJECT.md ghi engine, lệnh build từng network, ngân sách dung lượng (mặc định ≤ 5 MB, network chặt hơn thì theo network), quy ước asset; mỗi task có phương án, AC, tệp được sửa, phụ thuộc. Xong khi mọi AC và mọi network đích đã có task phụ trách.' },
      Dev: { responsibility: 'Làm đúng task, đúng tệp được giao. Code HTML5 nhẹ: không thư viện thừa, không request ngoài, xử lý resize/đổi hướng, pause/resume/mute theo sự kiện network, CTA chỉ gọi qua lớp adapter. Không refactor ngoài task, không đổi AC, không tự xác nhận QA pass.', output: 'Code chạy được trong trình duyệt; build ra tệp HTML từng network kèm dung lượng; handoff liệt kê tệp, lệnh build, cách mở thử và dung lượng. Xong khi build không lỗi, console không lỗi và đã tự kiểm theo AC của task.' },
      Art: { responsibility: 'Làm sprite, nền, icon, end card theo GDD và layout UI/UX, càng ít ảnh càng tốt: gộp atlas, WebP/PNG nén, kích thước vừa đủ cho màn 1080p. Sinh/sửa ảnh bằng script, pipeline art của project hoặc MCP sinh ảnh bật cho role. Không đổi gameplay, không sửa code ngoài phạm vi.', output: 'Ảnh/atlas đúng kích thước và định dạng, tổng dung lượng ảnh trong ngân sách PROJECT.md; handoff liệt kê tệp, kích thước, dung lượng, cách sinh lại và ảnh cần người dùng xem. Xong khi đã tự xem lại ảnh bằng Read và dung lượng đạt ngân sách.' },
      Anim: { responsibility: 'Làm animation nhẹ: tween bằng code hoặc định dạng engine dùng (Spine/DragonBones nếu project có) thay vì nhiều frame ảnh; tutorial hand, hiệu ứng thắng/thua, end card. Không đổi logic gameplay; tham số code cần gọi thì ghi rõ để Lead giao Dev.', output: 'Clip/tween đúng thời lượng và timing theo storyboard, dung lượng trong ngân sách; handoff liệt kê clip, thời lượng, event, cách xem và cần kiểm tra trực quan gì. Xong khi chạy được trong bản build và đã tự xem ảnh chụp các frame chính.' },
      Sound: { responsibility: 'Làm SFX ngắn và nhạc loop rất nhẹ: mono, bitrate thấp (MP3/OGG/M4A theo engine), mặc định tắt tiếng tới khi người chơi chạm hoặc network cho phép. Sinh/chỉnh bằng script, công cụ của project hoặc MCP âm thanh bật cho role. Không đổi gameplay; điểm gọi âm thanh ghi rõ để Lead giao Dev.', output: 'Tệp âm thanh đúng độ dài, loop không hở, tổng dung lượng âm thanh trong ngân sách; handoff liệt kê tệp, sự kiện, độ dài, dung lượng, cách nghe thử và cần người dùng nghe kiểm gì. Xong khi đã tự kiểm độ dài, peak, điểm loop và dung lượng bằng công cụ.' },
      QA: { responsibility: 'Kiểm theo AC và spec từng network đích, không theo cảm nhận; mỗi lỗi một Issue tái hiện được. Kiểm dung lượng, một tệp duy nhất, không request ngoài (tab Network), CTA gọi đúng hàm network, dọc/ngang/resize, pause/mute, thời gian vào gameplay; dùng công cụ preview của network nếu có. Không sửa code. Không có công cụ thì báo "chưa kiểm được", không đoán là pass.', output: 'Bảng AC × network với đạt/không đạt và bằng chứng (dung lượng, ảnh chụp, log console/network); Issue gồm ID, AC, network, bước tái hiện, kỳ vọng/thực tế. Xong khi mọi AC và mọi network đích có kết quả kèm bằng chứng.' }
    }
  }
});
// 'game' = không theo preset nào (cấu hình role thường).
const PURPOSES = Object.freeze(['game', ...Object.keys(PRESETS).map(key => key.toLowerCase())]);
const presetOf = purpose => Object.entries(PRESETS).find(([key]) => key.toLowerCase() === purpose)?.[1];
// Cấu hình của khối theo mục đích; null khi khối làm game hoặc preset không có role này.
// engine (thread.engine) có trong preset thì guide của engine nối sau guard.
function purposeConfig(type, purpose, engine) {
  const preset = presetOf(purpose), config = preset?.config[type]; if (!config) return null;
  const guide = Object.hasOwn(preset.engines || {}, engine || '') ? preset.engines[engine].guide : '';
  return { ...config, guard: [preset.guard, guide].filter(Boolean).join('\n') };
}
// '' = chưa chọn (Lead chọn theo project).
const validEngine = (preset, engine) => engine === '' || Object.hasOwn(PRESETS[preset]?.engines || {}, engine);
module.exports = { PRESETS, PURPOSES, purposeConfig, validEngine };
