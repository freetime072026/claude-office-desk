// vfx_entry.ts — điểm vào bản đóng gói VFX (kit asset-preview). Bản mẫu của Game-13 (PA0008); project chép thành
// vfx_entry.ts cạnh build_preview.py rồi đổi import theo code của mình. Đường dẫn tính từ <project>/.office-desk/preview/.
// Gom đúng hàm hiệu ứng game đang gọi (không viết lại hiệu ứng ở đây) + ảnh/Spine (src/assets.ts) + plugin Spine nếu có.
// build_vfx.mjs thay phaser = window.Phaser, SDK quảng cáo + tracking = rỗng, âm thanh = "".
import { makeTextures, speedText, upgradeFx, registerSpineData, makeSpine } from '../../src/scene/fx';
import { muzzleFlash, deathPuff, coinFly } from '../../src/scene/vfx';
import { bulletImpact } from '../../src/scene/units';
import { flashFence } from '../../src/scene/zombies';
import { DEPTH_FX, SCALE_STAFF, STAFF_SKIN } from '../../src/scene/constants';
import { IMAGES, SPINES } from '../../src/assets';
import { SpinePlugin } from '../../src/spine';

// Trang đọc: makeTextures(s) và registerSpineData(s) (nếu có) lúc create, IMAGES[k] cho VFX_IMAGES,
// SPINES (key/page/png) để nạp ảnh atlas, SpinePlugin (nếu có) để bật plugin Spine của Phaser.
(window as any).GAME_FX = {
  makeTextures, registerSpineData, makeSpine, speedText, upgradeFx, muzzleFlash, deathPuff, coinFly,
  bulletImpact, flashFence, DEPTH_FX, SCALE_STAFF, STAFF_SKIN, IMAGES, SPINES, SpinePlugin,
};
