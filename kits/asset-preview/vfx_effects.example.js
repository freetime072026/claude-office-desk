// vfx_effects.js — các ô của màn VFX (kit asset-preview). Bản mẫu của Game-13 (PA0008); project chép thành
// vfx_effects.js cạnh build_preview.py rồi sửa theo hàm hiệu ứng của game mình. Quy ước: KIT.md, mục VFX.
// Tệp được chèn vào trong module VFX của trang, nên dùng được:
//   FX            = window.GAME_FX do vfx_entry.ts đặt (hàm hiệu ứng, IMAGES, SPINES, hằng số của game)
//   FB(a, b)      = Phaser.Math.FloatBetween, CW × CH = cỡ một ô (px world)
//   c.x, c.y      = tâm ô; c.objs = mảng đối tượng setup() trả về (dời theo ô khi đổi bố cục)
// Mỗi hiệu ứng: { id, name, src, note, every (ms, bỏ = chỉ setup), setup?(s, c) => [obj…], moved?(c), play(s, c) }.
VFX_SOURCE = 'src/scene/{fx,vfx,units,zombies}.ts';
VFX_NOTE = 'Rung camera và WARNING! của boss không phát ở đây.';
VFX_IMAGES = ['cash', 'gate'];   // khoá trong FX.IMAGES cần nạp (ảnh mà các ô dùng)
EFFECTS = [
  { id: 'muzzle', name: 'muzzleFlash', src: 'vfx.ts', note: 'đầu nòng khi bắn (units.ts fire)', every: 260,
    play: (s, c) => FX.muzzleFlash(s, c.x - 40, c.y, -0.45, FX.DEPTH_FX) },
  { id: 'impact', name: 'bulletImpact', src: 'units.ts', note: 'đạn trúng zombie: flash, tia lửa, máu', every: 700,
    play: (s, c) => FX.bulletImpact(s, c.x, c.y, -0.45 + FB(-0.2, 0.2)) },
  { id: 'death', name: 'deathPuff', src: 'vfx.ts', note: 'bụi khi zombie chết (zombies.ts killZombie)', every: 900,
    play: (s, c) => FX.deathPuff(s, c.x, c.y + 20, FX.DEPTH_FX) },
  { id: 'coin', name: 'coinFly', src: 'vfx.ts', note: '+$ bay về icon tiền (killReward)', every: 1300,
    setup: (s, c) => [s.add.image(c.x + 120, c.y - 100, 'cash').setScale(0.8)],
    play: (s, c) => {
      // coinFly reads s.moneyIcon as screen coords (the icon lives on the UI camera): hand it this cell's icon
      const icon = c.objs[0], cam = s.cameras.main;
      s.moneyIcon = {
        get x() { return (icon.x - cam.worldView.x) * cam.zoom; }, get y() { return (icon.y - cam.worldView.y) * cam.zoom; },
        get scale() { return icon.scale / 0.8; }, set scale(v) { icon.setScale(0.8 * v); },
      };
      FX.coinFly(s, c.x - 40, c.y + 130, 25);
    } },
  { id: 'fence', name: 'flashFence', src: 'zombies.ts', note: 'zombie đánh rào: rung + đỏ + glow', every: 900,
    setup: (s, c) => {
      const img = s.add.image(c.x, c.y, 'gate');
      img.setData('baseX', img.x);   // as world.ts sets up the fence pieces
      if (img.preFX) { img.preFX.padding = 24; img.setData('glow', img.preFX.addGlow(0xff2a2a, 0, 0, false, 0.1, 14)); }
      return [img];
    },
    moved: c => c.objs[0].setData('baseX', c.objs[0].x),
    play: (s, c) => FX.flashFence(s, c.objs[0]) },
  { id: 'upgrade', name: 'upgradeFx + speedText', src: 'fx.ts', note: 'nâng cấp: fx_appear trên/dưới nhân vật, SPEED++', every: 1700,
    setup: (s, c) => {
      // as units.ts addStaff: rig staffGun, SCALE_STAFF, skin STAFF_SKIN; Front_Idle as staffAnim
      const sp = FX.makeSpine(s, 'staffGun', c.x, c.y + 110, FX.SCALE_STAFF);
      sp.skeleton.setSkinByName(FX.STAFF_SKIN); sp.skeleton.setSlotsToSetupPose();
      sp.animationState.setAnimation(0, 'Front_Idle', true);
      return [sp];
    },
    play: (s, c) => { FX.upgradeFx(s, c.objs[0], 0, 0.9); FX.speedText(s, c.x, c.y + 110 - 150); } },
];
