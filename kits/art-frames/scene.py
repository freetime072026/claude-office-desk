#!/usr/bin/env python3
"""Kit art-frames · scene.py: đo ảnh cảnh / ảnh thay thế so với ref (Office Desk).

Dùng cho Art (tự kiểm trước handoff) và Art Director (lập bảng kiểm kê ref, review cả cảnh).
Chỉ cần numpy + Pillow. Mọi lệnh in báo cáo ra stdout; lệnh kiểm trả mã thoát 1 khi TRƯỢT.

  baked   --img NỀN [--out ẢNH] [--min-area 400]
          Liệt kê object vẽ sẵn trong ảnh nền / ảnh ghép (vùng có nét viền đậm), đánh số trên ảnh --out.
          Dùng khi vẽ lại nền: mọi object trong danh sách phải có thứ thay (giữ, tách sprite) hoặc được chốt bỏ.
  swap    --old ẢNH_CŨ --new ẢNH_MỚI [--tol 8]
          Ảnh thay thế phải "thả vào là khớp": cùng canvas, khung alpha, điểm cực trái/phải/trên/dưới, độ dốc cạnh đáy.
  line    --points x1,y1 x2,y2 ... [--slope 0.5] [--tol 4]
          Các điểm đặt (hai đầu từng đoạn rào/tường/băng trong world px, đọc từ code hoặc đo trên ảnh chụp)
          có thẳng hàng, đúng trục iso, không gãy khúc không. Không đo viền sprite: cọc, chân bàn làm viền răng cưa.
  keep    --src ẢNH_GỐC --new ẢNH_MỚI [--out ẢNH] [--min-ratio 0.6]
          Ảnh mới dựng từ asset gốc có giữ chi tiết của gốc không (số màu, mật độ nét ở cùng cỡ) + ảnh cạnh nhau.
          TRƯỢT = đã vẽ lại thành hình phẳng; phải cắt ghép pixel của ảnh gốc hoặc dùng nguyên ảnh gốc.
  compare --ref ẢNH_REF --shot ẢNH_GAME --out ẢNH [--grid 100] [--crop x,y,w,h]
          Ảnh ref | ảnh game | chồng 50% | khác biệt, có lưới toạ độ (px của ref) để đi từng dòng kiểm kê.
"""
import argparse
import math
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ALPHA_MIN = 40  # điểm ảnh có alpha trên ngưỡng này tính là "có hình"


def load_rgba(path):
    return Image.open(path).convert('RGBA')


def font(size=14):
    for name in ('arial.ttf', 'DejaVuSans.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


# ------------------------------------------------------------------ hình học của mask

def mask_of(img):
    return np.asarray(img)[:, :, 3] > ALPHA_MIN


def bbox(mask):
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def extremes(mask):
    """Điểm cực trái/phải/trên/dưới của hình (lấy điểm giữa nếu nhiều điểm cùng hàng/cột)."""
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return {}

    def mid(sel_x, sel_y):
        return int(np.median(sel_x)), int(np.median(sel_y))

    out = {}
    for name, pick in (('trái', xs == xs.min()), ('phải', xs == xs.max()), ('trên', ys == ys.min()), ('dưới', ys == ys.max())):
        out[name] = mid(xs[pick], ys[pick])
    return out


def contour(mask, side='bottom'):
    """Mỗi cột có hình: y của điểm thấp nhất (bottom) hoặc cao nhất (top)."""
    cols = np.nonzero(mask.any(axis=0))[0]
    if side == 'bottom':
        ys = np.array([np.nonzero(mask[:, x])[0].max() for x in cols])
    else:
        ys = np.array([np.nonzero(mask[:, x])[0].min() for x in cols])
    return cols.astype(float), ys.astype(float)


def fit_line(xs, ys):
    """Đường thẳng qua hai cụm đầu/cuối (bền hơn bình phương nhỏ nhất khi cạnh có cọc/răng cưa)."""
    if len(xs) < 2:
        return 0.0, float(ys[0]) if len(ys) else 0.0
    k = max(1, len(xs) // 10)
    x0, y0 = xs[:k].mean(), np.median(ys[:k])
    x1, y1 = xs[-k:].mean(), np.median(ys[-k:])
    slope = (y1 - y0) / (x1 - x0) if x1 != x0 else 0.0
    return slope, y0 - slope * x0


def line_report(xs, ys, slope_expected, tol, label):
    slope, icpt = fit_line(xs, ys)
    dev = ys - (slope * xs + icpt)
    i = int(np.argmax(np.abs(dev)))
    worst = float(dev[i])
    p95 = float(np.percentile(np.abs(dev), 95)) if len(dev) > 2 else abs(worst)
    lines = [f'{label}: {len(xs)} điểm, x {xs.min():.0f}→{xs.max():.0f}',
             f'  độ dốc dy/dx = {slope:.4f} ({math.degrees(math.atan(slope)):.2f}°; âm = cạnh đi lên ↗ trên màn)',
             f'  lệch khỏi đường thẳng: p95 {p95:.1f} px, lớn nhất {worst:+.1f} px tại x={xs[i]:.0f}']
    ok = abs(worst) <= tol
    if slope_expected is not None:
        # so theo độ lớn: cạnh ↗ có dy/dx âm, ↘ dương; trục iso 2:1 là 0,5 cho cả hai
        want = math.degrees(math.atan(abs(slope_expected)))
        got = math.degrees(math.atan(abs(slope)))
        lines.append(f'  độ dốc cần |{abs(slope_expected):.4f}| ({want:.2f}°), lệch {got - want:+.2f}°')
        ok = ok and abs(got - want) <= 1.5
    # Gãy khúc: độ dốc nửa đầu và nửa sau khác nhau rõ
    if len(xs) >= 8:
        h = len(xs) // 2
        s1, _ = fit_line(xs[:h], ys[:h])
        s2, _ = fit_line(xs[h:], ys[h:])
        bend = math.degrees(math.atan(s2)) - math.degrees(math.atan(s1))
        lines.append(f'  độ dốc nửa đầu {s1:.4f}, nửa sau {s2:.4f} (gãy {bend:+.2f}°)')
        ok = ok and abs(bend) <= 3
    lines.append(f'  => {"ĐẠT" if ok else "TRƯỢT"} (ngưỡng lệch {tol} px, dốc ±1,5°, gãy ±3°)')
    return ok, lines


# ------------------------------------------------------------------ lệnh

def cmd_swap(a):
    old, new = load_rgba(a.old), load_rgba(a.new)
    mo, mn = mask_of(old), mask_of(new)
    rows, ok = [], True

    def check(name, vo, vn, good, note=''):
        nonlocal ok
        ok = ok and good
        rows.append(f'| {name} | {vo} | {vn} | {"ok" if good else "LỆCH"} {note}|')

    check('canvas', old.size, new.size, old.size == new.size)
    bo, bn = bbox(mo), bbox(mn)
    if bo and bn:
        d = max(abs(p - q) for p, q in zip(bo, bn))
        check('khung alpha (x0,y0,x1,y1)', bo, bn, d <= a.tol, f'(lệch {d} px)')
    else:
        check('khung alpha', bo, bn, False, '(ảnh trống)')
    co, cn = mo.mean(), mn.mean()
    check('độ phủ', f'{co:.1%}', f'{cn:.1%}', 0.5 <= (cn / co if co else 0) <= 1.6, '(ngoài 0,5–1,6 lần là thiếu/thừa hình)')
    eo, en = extremes(mo), extremes(mn)
    for k in ('trái', 'phải', 'trên', 'dưới'):
        if k in eo and k in en:
            d = math.dist(eo[k], en[k])
            check(f'điểm cực {k}', eo[k], en[k], d <= a.tol * 2, f'({d:.0f} px)')
    if old.size == new.size and bo and bn:
        inter, union = (mo & mn).sum(), (mo | mn).sum()
        iou = inter / union if union else 0
        rows.append(f'| trùng mask (IoU) | | {iou:.2f} | {"ok" if iou >= 0.35 else "xem lại"} (thấp = hình ở chỗ khác) |')
    if bo and (bo[2] - bo[0]) > 2.5 * (bo[3] - bo[1]) or (bo and (bo[2] - bo[0]) > 300):
        so, _ = fit_line(*contour(mo))
        sn, _ = fit_line(*contour(mn))
        d = math.degrees(math.atan(sn)) - math.degrees(math.atan(so))
        check('độ dốc cạnh đáy', f'{so:.4f}', f'{sn:.4f}', abs(d) <= 1.5, f'({d:+.2f}°)')
    print(f'swap {a.old} -> {a.new}\n| mục | cũ | mới | kết quả |\n|---|---|---|---|')
    print('\n'.join(rows))
    print(f'=> {"ĐẠT" if ok else "TRƯỢT"}: ảnh mới {"thả vào chỗ ảnh cũ là khớp" if ok else "không thả vào chỗ ảnh cũ được, sửa ảnh (không sửa toạ độ trong code để chữa)"}')
    return 0 if ok else 1


def cmd_line(a):
    pts = sorted(tuple(float(v) for v in p.split(',')) for p in a.points)
    xs, ys = np.array([p[0] for p in pts]), np.array([p[1] for p in pts])
    ok, lines = line_report(xs, ys, a.slope, a.tol, 'điểm')
    print('\n'.join(lines))
    return 0 if ok else 1


def cmd_baked(a):
    img = Image.open(a.img).convert('RGB')
    w, h = img.size
    sc = max(1, round(max(w, h) / 960))  # làm việc ở cỡ ≤ ~960 px cho nhanh
    small = img.resize((w // sc, h // sc), Image.BILINEAR)
    arr = np.asarray(small).astype(int)
    lum = arr @ np.array([0.299, 0.587, 0.114])
    # Nét viền đậm (outline) của art cartoon: điểm tối hẳn so với nền quanh nó
    dark = lum < a.dark
    # nối nét viền thành khối: giãn 2 lần
    m = dark.copy()
    for _ in range(a.grow):
        g = m.copy()
        g[1:, :] |= m[:-1, :]; g[:-1, :] |= m[1:, :]; g[:, 1:] |= m[:, :-1]; g[:, :-1] |= m[:, 1:]
        m = g
    seen = np.zeros_like(m)
    H, W = m.shape
    comps = []
    for y in range(H):
        for x in range(W):
            if not m[y, x] or seen[y, x]:
                continue
            q = deque([(y, x)]); seen[y, x] = True
            x0 = x1 = x; y0 = y1 = y; n = 0
            while q:
                cy, cx = q.popleft(); n += 1
                x0, x1, y0, y1 = min(x0, cx), max(x1, cx), min(y0, cy), max(y1, cy)
                for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                    if 0 <= ny < H and 0 <= nx < W and m[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True; q.append((ny, nx))
            area = (x1 - x0 + 1) * (y1 - y0 + 1) * sc * sc
            if area >= a.min_area:
                comps.append((x0 * sc, y0 * sc, (x1 + 1) * sc, (y1 + 1) * sc, area))
    comps.sort(key=lambda c: (c[1] + c[3]) / 2 * 10000 + c[0])
    print(f'baked {a.img} ({w}×{h}): {len(comps)} object có nét viền (khung ≥ {a.min_area} px²)')
    print('| # | khung x0,y0,x1,y1 | tâm đáy (chân) | cỡ |\n|---|---|---|---|')
    for i, (x0, y0, x1, y1, _) in enumerate(comps, 1):
        print(f'| B{i} | {x0},{y0},{x1},{y1} | ({(x0 + x1) // 2},{y1}) | {x1 - x0}×{y1 - y0} |')
    print('Mỗi B# phải có một dòng trong bảng kiểm kê ref (giữ / tách sprite / thay bằng ART-… / bỏ có người chốt).')
    if a.out:
        view = img.copy()
        view.thumbnail((1400, 1400))
        k = view.width / w
        d = ImageDraw.Draw(view)
        f = font(16)
        for i, (x0, y0, x1, y1, _) in enumerate(comps, 1):
            d.rectangle([x0 * k, y0 * k, x1 * k, y1 * k], outline=(255, 0, 255), width=2)
            d.text((x0 * k + 2, y0 * k + 1), f'B{i}', fill=(255, 0, 255), font=f, stroke_width=2, stroke_fill=(255, 255, 255))
        view.save(a.out)
        print(f'Ảnh đánh số: {a.out}')
    return 0


def detail_of(img):
    """Độ chi tiết trong vùng có hình: số màu (lượng tử 5 bit/kênh) và mật độ nét (gradient trung bình)."""
    arr = np.asarray(img).astype(int)
    m = arr[:, :, 3] > ALPHA_MIN
    if not m.any():
        return 0, 0.0
    rgb = arr[:, :, :3][m] >> 3
    colors = len(np.unique(rgb[:, 0] * 1024 + rgb[:, 1] * 32 + rgb[:, 2]))
    lum = arr[:, :, :3] @ np.array([0.299, 0.587, 0.114])
    gx = np.abs(np.diff(lum, axis=1))[:-1, :]
    gy = np.abs(np.diff(lum, axis=0))[:, :-1]
    inner = m[:-1, :-1] & m[1:, :-1] & m[:-1, 1:]
    edges = float(((gx + gy)[inner] > 24).mean()) if inner.any() else 0.0
    return colors, edges


def cmd_keep(a):
    src, new = load_rgba(a.src), load_rgba(a.new)
    # so ở cùng cỡ hình: co ảnh gốc về cỡ khung alpha của ảnh mới
    bs, bn = bbox(mask_of(src)), bbox(mask_of(new))
    s_crop, n_crop = src.crop(bs), new.crop(bn)
    s_fit = s_crop.resize(n_crop.size, Image.LANCZOS)
    cs, es = detail_of(s_fit)
    cn, en = detail_of(n_crop)
    rc, re_ = (cn / cs if cs else 0), (en / es if es else 0)
    ok = rc >= a.min_ratio and re_ >= a.min_ratio
    print(f'keep {a.src} -> {a.new} (so ở cỡ {n_crop.size[0]}×{n_crop.size[1]})')
    print(f'| mục | gốc | mới | tỉ lệ |\n|---|---|---|---|')
    print(f'| số màu | {cs} | {cn} | {rc:.2f} |')
    print(f'| mật độ nét | {es:.3f} | {en:.3f} | {re_:.2f} |')
    print(f'=> {"ĐẠT" if ok else "TRƯỢT"}: ' + ('ảnh mới giữ được chi tiết của ảnh gốc' if ok else
          f'ảnh mới mất chi tiết so với gốc (tỉ lệ < {a.min_ratio}): có thể đã vẽ lại bằng hình phẳng thay vì cắt ghép pixel của ảnh gốc'))
    if a.out:
        h = 520
        tiles = [t.copy() for t in (s_crop, n_crop)]
        for t in tiles:
            t.thumbnail((h * 2, h))
        out = Image.new('RGB', (sum(t.width for t in tiles) + 30, h + 30), (200, 200, 255))
        x = 10
        d = ImageDraw.Draw(out)
        for name, t in zip(('GỐC', 'MỚI'), tiles):
            out.paste(t, (x, 26), t)
            d.text((x, 4), name, fill=(0, 0, 0), font=font(16))
            x += t.width + 10
        out.save(a.out)
        print(f'Ảnh cạnh nhau: {a.out} (Read để so bằng mắt: còn đủ chi tiết, cửa sổ, đồ trang trí của gốc không)')
    return 0 if ok else 1


def grid_on(im, step, scale, color=(255, 0, 255)):
    d = ImageDraw.Draw(im)
    f = font(12)
    W, H = im.size
    x = 0
    while x * scale < W:
        X = x * scale
        d.line([(X, 0), (X, H)], fill=color + (90,), width=1)
        d.text((X + 2, 2), str(x), fill=color, font=f, stroke_width=2, stroke_fill=(255, 255, 255))
        x += step
    y = 0
    while y * scale < H:
        Y = y * scale
        d.line([(0, Y), (W, Y)], fill=color + (90,), width=1)
        d.text((2, Y + 2), str(y), fill=color, font=f, stroke_width=2, stroke_fill=(255, 255, 255))
        y += step


def cmd_compare(a):
    ref = Image.open(a.ref).convert('RGB')
    shot = Image.open(a.shot).convert('RGB')
    if a.crop:
        x, y, w, h = (int(v) for v in a.crop.split(','))
        ref, shot = ref.crop((x, y, x + w, y + h)), shot.crop((x, y, x + w, y + h)) if shot.size == ref.size else shot
    if shot.size != ref.size:
        print(f'Cỡ khác nhau: ref {ref.size}, game {shot.size} — ảnh game được co về cỡ ref. Chụp đúng cùng khung hình/camera để so toạ độ.')
        shot = shot.resize(ref.size, Image.BILINEAR)
    pw = min(ref.width, 700)
    k = pw / ref.width
    ph = round(ref.height * k)
    r, s = ref.resize((pw, ph)), shot.resize((pw, ph))
    blend = Image.blend(r, s, 0.5)
    diff = np.abs(np.asarray(r).astype(int) - np.asarray(s).astype(int)).sum(axis=2)
    heat = np.zeros((ph, pw, 3), np.uint8)
    heat[:, :, 0] = np.clip(diff, 0, 255)
    heat[:, :, 1] = np.clip(diff // 3, 0, 255)
    dimg = Image.blend(r.convert('L').convert('RGB'), Image.fromarray(heat), 0.6)
    tiles = [('REF', r), ('GAME', s), ('CHỒNG 50%', blend), ('KHÁC (đỏ = khác)', dimg)]
    out = Image.new('RGB', (pw * 2 + 10, (ph + 24) * 2 + 10), 'white')
    f = font(16)
    for i, (name, t) in enumerate(tiles):
        t = t.convert('RGBA')
        grid_on(t, a.grid, k)
        ox, oy = (i % 2) * (pw + 10), (i // 2) * (ph + 34)
        out.paste(t.convert('RGB'), (ox, oy + 24))
        ImageDraw.Draw(out).text((ox + 4, oy + 2), name, fill=(0, 0, 0), font=f)
    out.save(a.out)
    share = float((diff > 60).mean())
    print(f'compare: {a.out} ({out.width}×{out.height}); lưới mỗi {a.grid} px toạ độ ref; {share:.1%} điểm ảnh khác rõ.')
    print('Read ảnh này rồi đi từng dòng bảng kiểm kê ref: có mặt, đúng chỗ, đúng lớp, cạnh thẳng. % khác chỉ để tham khảo (đổi skin thì khác là đúng).')
    return 0


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):  # console Windows (cp1252) không in được tiếng Việt
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
        except (AttributeError, ValueError):
            pass
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    b = sub.add_parser('baked'); b.add_argument('--img', required=True); b.add_argument('--out')
    b.add_argument('--min-area', type=int, default=400); b.add_argument('--dark', type=int, default=90); b.add_argument('--grow', type=int, default=2)
    s = sub.add_parser('swap'); s.add_argument('--old', required=True); s.add_argument('--new', required=True); s.add_argument('--tol', type=int, default=8)
    l = sub.add_parser('line'); l.add_argument('--points', nargs='+', required=True)
    l.add_argument('--slope', type=float); l.add_argument('--tol', type=float, default=4)
    k = sub.add_parser('keep'); k.add_argument('--src', required=True); k.add_argument('--new', required=True); k.add_argument('--out')
    k.add_argument('--min-ratio', type=float, default=0.6)
    c = sub.add_parser('compare'); c.add_argument('--ref', required=True); c.add_argument('--shot', required=True); c.add_argument('--out', required=True)
    c.add_argument('--grid', type=int, default=100); c.add_argument('--crop')
    a = p.parse_args(argv)
    return {'baked': cmd_baked, 'swap': cmd_swap, 'line': cmd_line, 'keep': cmd_keep, 'compare': cmd_compare}[a.cmd](a)


if __name__ == '__main__':
    sys.exit(main())
