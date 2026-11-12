#!/usr/bin/env python3
"""Kit art-frames của Office Desk: dựng animation từng frame từ sheet KEY POSE do model ảnh vẽ (ChatGPT, Codex).

Quy trình (lệnh `run`): tách nền cả sheet một lần (cùng tham số cho mọi frame) -> cắt key (lưới hoặc tự dò) ->
canh mọi frame vào một canvas cố định theo đường chân và tâm chân -> bù frame giữa từng cặp key -> đo và xuất.

Bắt buộc: Python 3.8+, numpy, Pillow. Tuỳ chọn: opencv-python (cv2) để nội suy bằng optical flow.
Không có cv2 thì cặp key chỉ được chỉnh nhịp (giữ frame), báo trong report. Xem KIT.md.
"""
import argparse
import json
import math
import os
import sys

try:
    import numpy as np
    from PIL import Image, ImageDraw
except ImportError as error:  # pragma: no cover
    sys.exit(f"Thiếu thư viện bắt buộc ({error}). Cài: python -m pip install numpy pillow")
try:
    import cv2  # type: ignore
except ImportError:  # optional
    cv2 = None

KIT_VERSION = 1
for stream in (sys.stdout, sys.stderr):  # console Windows mặc định cp1252: in tiếng Việt bị UnicodeEncodeError
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
ALPHA_ON = 16  # alpha > ALPHA_ON coi là có hình


# ---------------------------------------------------------------- ảnh và mask
def load_rgba(path):
    return np.asarray(Image.open(path).convert("RGBA")).astype(np.uint8).copy()


def save_rgba(array, path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    Image.fromarray(array.astype(np.uint8), "RGBA").save(path)


def mask_of(rgba):
    return rgba[..., 3] > ALPHA_ON


def bbox(mask):
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def shift(mask, dy, dx):
    out = np.zeros_like(mask)
    h, w = mask.shape
    out[max(dy, 0):h + min(dy, 0), max(dx, 0):w + min(dx, 0)] = mask[max(-dy, 0):h + min(-dy, 0), max(-dx, 0):w + min(-dx, 0)]
    return out


def dilate(mask, radius=1):
    out = mask.copy()
    for _ in range(radius):
        grown = out.copy()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            grown |= shift(out, dy, dx)
        out = grown
    return out


def erode(mask, radius=1):
    return ~dilate(~mask, radius)


def grow(seed, allowed):
    """Vùng của `allowed` nối với `seed` (flood fill 4 hướng bằng numpy)."""
    region = seed & allowed
    while True:
        grown = dilate(region) & allowed
        if (grown == region).all():
            return region
        region = grown


def hex_color(text):
    text = text.strip().lstrip("#")
    if len(text) != 6:
        raise argparse.ArgumentTypeError(f"màu hex không hợp lệ: {text}")
    return tuple(int(text[i:i + 2], 16) for i in (0, 2, 4))


# ---------------------------------------------------------------- 1. tách nền
def border_colors(rgb, ring=3, top=3):
    """Màu nền ước lượng từ viền ảnh: gom màu viền (lượng tử 8 mức) lấy các cụm lớn (nền một màu, ô caro vẽ giả)."""
    h, w, _ = rgb.shape
    edge = np.concatenate([rgb[:ring].reshape(-1, 3), rgb[-ring:].reshape(-1, 3), rgb[:, :ring].reshape(-1, 3), rgb[:, -ring:].reshape(-1, 3)]).astype(int)
    keys = (edge // 32)
    codes = keys[:, 0] * 64 + keys[:, 1] * 8 + keys[:, 2]
    values, counts = np.unique(codes, return_counts=True)
    order = np.argsort(-counts)
    colors = []
    for index in order[:top]:
        if counts[index] < 0.08 * len(codes):
            break
        colors.append(tuple(int(c) for c in edge[codes == values[index]].mean(axis=0)))
    return colors


def remove_background(rgba, colors=None, tolerance=40, erode_px=1, holes=False):
    """Xoá nền nối với mép ảnh (màu gần một trong các màu nền). Ảnh đã trong suốt thật thì chỉ dọn alpha rác."""
    rgba = rgba.copy()
    alpha = rgba[..., 3]
    info = {"mode": "", "colors": [], "tolerance": tolerance, "erode": erode_px}
    if (alpha < ALPHA_ON).mean() > 0.05:
        info["mode"] = "alpha-có-sẵn"
        background = alpha <= ALPHA_ON
    else:
        rgb = rgba[..., :3].astype(int)
        colors = colors or border_colors(rgb)
        info["mode"], info["colors"] = "màu-nền", ["#%02X%02X%02X" % c for c in colors]
        near = np.zeros(alpha.shape, bool)
        tight = np.zeros(alpha.shape, bool)
        for color in colors:
            distance = np.sqrt(((rgb - np.array(color)) ** 2).sum(axis=2))
            near |= distance <= tolerance
            tight |= distance <= tolerance / 2
        seed = np.zeros(alpha.shape, bool)
        seed[0, :] = seed[-1, :] = seed[:, 0] = seed[:, -1] = True
        background = grow(seed, near)
        if holes:  # vùng kín (giữa tay và thân) cùng màu nền, so ngưỡng chặt hơn
            background |= tight
    keep = ~background
    if erode_px > 0:
        keep = erode(keep, erode_px)  # bỏ quầng viền nền dính mép hình
    rgba[..., 3] = np.where(keep, np.maximum(alpha, 0) if info["mode"] == "alpha-có-sẵn" else 255, 0).astype(np.uint8)
    rgba[~keep, :3] = 0
    return rgba, info


# ---------------------------------------------------------------- 2. cắt key
def split_grid(rgba, cols, rows, count=None):
    h, w = rgba.shape[:2]
    cells = []
    for row in range(rows):
        for col in range(cols):
            y0, y1 = round(row * h / rows), round((row + 1) * h / rows)
            x0, x1 = round(col * w / cols), round((col + 1) * w / cols)
            cell = rgba[y0:y1, x0:x1]
            if bbox(mask_of(cell)) is not None:
                cells.append(cell)
    return cells[:count] if count else cells


def split_auto(rgba, count=None, gap=6):
    """Tự dò từng pose: các cụm hình tách nhau (nối các mảnh gần nhau trong khoảng `gap` px), xếp theo hàng rồi cột."""
    mask = mask_of(rgba)
    scale = max(1, max(mask.shape) // 400)
    small = mask[::scale, ::scale]
    small = dilate(small, max(1, gap // scale))
    h, w = small.shape
    labels = np.zeros((h, w), int)
    boxes = []
    for y, x in zip(*np.nonzero(small)):
        if labels[y, x]:
            continue
        label = len(boxes) + 1
        stack, labels[y, x] = [(y, x)], label
        x0 = x1 = x
        y0 = y1 = y
        area = 0
        while stack:
            cy, cx = stack.pop()
            area += 1
            x0, x1, y0, y1 = min(x0, cx), max(x1, cx), min(y0, cy), max(y1, cy)
            for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                if 0 <= ny < h and 0 <= nx < w and small[ny, nx] and not labels[ny, nx]:
                    labels[ny, nx] = label
                    stack.append((ny, nx))
        boxes.append((x0 * scale, y0 * scale, (x1 + 1) * scale, (y1 + 1) * scale, area))
    if not boxes:
        return []
    largest = max(box[4] for box in boxes)
    boxes = [box for box in boxes if box[4] >= 0.05 * largest]
    heights = sorted(box[3] - box[1] for box in boxes)
    row_gap = heights[len(heights) // 2] / 2
    boxes.sort(key=lambda box: (box[1] + box[3]) / 2)
    rows, current = [], [boxes[0]]
    for box in boxes[1:]:
        if (box[1] + box[3]) / 2 - (current[-1][1] + current[-1][3]) / 2 > row_gap:
            rows.append(current)
            current = []
        current.append(box)
    rows.append(current)
    ordered = [box for row in rows for box in sorted(row, key=lambda item: item[0])]
    cells = [rgba[max(0, y0 - 2):y1 + 2, max(0, x0 - 2):x1 + 2] for x0, y0, x1, y1, _ in ordered]
    return cells[:count] if count else cells


# ---------------------------------------------------------------- 3. canh frame
def anchor_of(rgba, mode="feet"):
    mask = mask_of(rgba)
    box = bbox(mask)
    if box is None:
        return None
    x0, y0, x1, y1 = box
    if mode == "bbox":
        return (x0 + x1) / 2, y1
    rows = mask[max(y0, y1 - max(2, int((y1 - y0) * 0.15))):y1] if mode == "feet" else mask
    xs = np.nonzero(rows)[1]
    return float(xs.mean()), y1


def align(frames, anchor="feet", canvas=None, margin=8):
    """Đặt mọi frame lên cùng canvas: đường chân (đáy hình) cùng một hàng, tâm chân cùng một cột. Không scale."""
    infos = []
    for frame in frames:
        box = bbox(mask_of(frame))
        ax, ay = anchor_of(frame, anchor)
        infos.append((box, ax, ay))
    left = max(ax - box[0] for box, ax, _ in infos)
    right = max(box[2] - ax for box, ax, _ in infos)
    up = max(ay - box[1] for box, _, ay in infos)
    width = int(math.ceil(left + right)) + 2 * margin
    height = int(math.ceil(up)) + 2 * margin
    if canvas:
        width, height = max(width, canvas[0]), max(height, canvas[1])
    foot_y = height - margin
    center_x = margin + left + (width - 2 * margin - left - right) / 2
    out = []
    for frame, (box, ax, ay) in zip(frames, infos):
        plate = np.zeros((height, width, 4), np.uint8)
        x0, y0, x1, y1 = box
        piece = frame[y0:y1, x0:x1]
        tx, ty = int(round(center_x - (ax - x0))), int(round(foot_y - (ay - y0)))
        plate[ty:ty + piece.shape[0], tx:tx + piece.shape[1]] = piece
        out.append(plate)
    return out, {"canvas": [width, height], "foot_y": foot_y, "center_x": round(center_x, 1), "anchor": anchor}


# ---------------------------------------------------------------- 4. bù frame giữa
def difference(a, b):
    """Độ khác hình dạng giữa hai frame: 1 - IoU của alpha (0 = trùng, 1 = không chồng)."""
    ma, mb = mask_of(a), mask_of(b)
    union = (ma | mb).sum()
    return 0.0 if union == 0 else float(1 - (ma & mb).sum() / union)


def motion(a, b, cap_ratio=0.25):
    """Quãng dịch của phần chuyển động, tính bằng tỉ lệ chiều cao nhân vật: khoảng cách (px) từ mỗi điểm chỉ có ở một frame
    tới hình của frame kia, lấy p90. Một bộ phận dịch d px thì điểm mới cách hình cũ <= d px (không phải cả chiều cao bộ phận);
    kiếm xoay 40° thì đầu kiếm mới cách hình cũ rất xa. Trả (tỉ lệ, px)."""
    ma, mb = mask_of(a), mask_of(b)
    box = bbox(ma | mb)
    if box is None:
        return 0.0, 0
    height = max(1, box[3] - box[1])
    cap = max(4, int(cap_ratio * height))
    distances = []
    for moved, target in ((mb & ~ma, ma), (ma & ~mb, mb)):
        if not moved.any():
            continue
        found = np.full(moved.shape, cap, np.int32)
        reach = target.copy()
        for step in range(1, cap + 1):
            reach = dilate(reach)
            newly = moved & reach & (found == cap)
            found[newly] = step
            if not (moved & ~reach).any():
                break
        distances.append(found[moved])
    if not distances:
        return 0.0, 0
    p90 = int(np.percentile(np.concatenate(distances), 90))
    return p90 / height, p90


def ease(t, mode):
    return 0.5 - 0.5 * math.cos(math.pi * t) if mode == "inout" else t


def premultiply(rgba):
    out = rgba.astype(np.float32)
    out[..., :3] *= out[..., 3:4] / 255.0
    return out


def unpremultiply(array):
    out = array.copy()
    alpha = np.clip(out[..., 3:4], 0, 255)
    safe = np.where(alpha > 0, alpha, 1)
    out[..., :3] = np.where(alpha > 0, out[..., :3] * 255.0 / safe, 0)
    out[..., 3:4] = alpha
    return np.clip(out, 0, 255).astype(np.uint8)


def flow_frames(a, b, times):
    """Optical flow hai chiều (Farneback) + warp kiểu Super SloMo trên ảnh premultiplied, alpha nội suy cùng hình."""
    gray = lambda img: cv2.cvtColor(np.ascontiguousarray(premultiply(img)[..., :3].astype(np.uint8)), cv2.COLOR_RGB2GRAY)
    ga, gb = gray(a), gray(b)
    params = dict(pyr_scale=0.5, levels=5, winsize=21, iterations=5, poly_n=7, poly_sigma=1.5, flags=0)
    f01 = cv2.calcOpticalFlowFarneback(ga, gb, None, **params)
    f10 = cv2.calcOpticalFlowFarneback(gb, ga, None, **params)
    h, w = ga.shape
    grid_x, grid_y = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    pa, pb = premultiply(a), premultiply(b)
    out = []
    for t in times:
        ft0 = -t * (1 - t) * f01 + t * t * f10
        ft1 = (1 - t) * (1 - t) * f01 - t * (1 - t) * f10
        wa = cv2.remap(pa, grid_x + ft0[..., 0], grid_y + ft0[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        wb = cv2.remap(pb, grid_x + ft1[..., 0], grid_y + ft1[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        mixed = (1 - t) * wa + t * wb
        frame = unpremultiply(mixed)
        frame[..., 3] = np.where(frame[..., 3] > 127, 255, np.where(frame[..., 3] > 40, frame[..., 3], 0))  # giữ viền gọn
        out.append(frame)
    return out


def find_rife(explicit_exe=None, explicit_model=None):
    """RIFE theo thứ tự: --rife/--rife-model, biến môi trường RIFE_NCNN_VULKAN(_MODEL), kit.json cạnh script (Office Desk ghi khi
    đã cài bằng nút Cài RIFE). Trả (exe, model) hoặc (None, None)."""
    exe, model = explicit_exe or os.environ.get("RIFE_NCNN_VULKAN"), explicit_model or os.environ.get("RIFE_NCNN_VULKAN_MODEL")
    if not exe:
        try:
            with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "kit.json"), encoding="utf-8") as handle:
                info = json.load(handle)
            exe, model = info.get("rife") or None, model or info.get("rifeModel") or None
        except (OSError, ValueError):
            pass
    if exe and os.path.isfile(exe):
        model = model or os.path.join(os.path.dirname(exe), "rife-v4.6")
        return exe, model if os.path.isdir(model) else None
    return None, None


def rife_frames(a, b, times, exe, model, work):
    """RIFE chỉ nhận RGB: chạy một lần cho màu (ghép trên nền xám 128) và một lần cho alpha (ảnh xám), rồi tách màu khỏi nền xám.
    rife-ncnn-vulkan -0 A -1 B -o OUT -s t -m MODEL (model v4 nhận time step bất kỳ). Lỗi GPU thì thử lại bằng CPU (-g -1)."""
    import subprocess
    import tempfile
    grey = 128.0
    os.makedirs(work, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=work) as folder:
        def write(name, array):
            path = os.path.join(folder, name)
            Image.fromarray(np.clip(array, 0, 255).astype(np.uint8), "RGB").save(path)
            return path

        def colour(img):
            alpha = img[..., 3:4].astype(np.float32) / 255
            return img[..., :3] * alpha + grey * (1 - alpha)

        def run(first, second, out, t):
            base = [exe, "-0", first, "-1", second, "-o", out, "-s", f"{t:.4f}"] + (["-m", model] if model else [])
            message = "RIFE không ra ảnh"
            for extra in ([], ["-g", "-1"]):
                result = subprocess.run(base + extra, capture_output=True, text=True, errors="replace", cwd=os.path.dirname(exe))
                if result.returncode == 0 and os.path.isfile(out):
                    return np.asarray(Image.open(out).convert("RGB")).astype(np.float32)
                lines = (result.stderr or result.stdout or "").strip().splitlines()
                message = lines[-1] if lines else message
            raise RuntimeError(message)

        rgb_in = (write("a_rgb.png", colour(a)), write("b_rgb.png", colour(b)))
        alpha_in = (write("a_alpha.png", np.repeat(a[..., 3:4], 3, axis=2)), write("b_alpha.png", np.repeat(b[..., 3:4], 3, axis=2)))
        out = []
        for index, t in enumerate(times):
            mixed = run(*rgb_in, os.path.join(folder, f"rgb_{index}.png"), t)
            alpha = run(*alpha_in, os.path.join(folder, f"alpha_{index}.png"), t).mean(axis=2, keepdims=True)
            ratio = alpha / 255
            rgb = np.where(ratio > 0.02, (mixed - grey * (1 - ratio)) / np.maximum(ratio, 0.02), 0)
            frame = np.concatenate([np.clip(rgb, 0, 255), alpha], axis=2).astype(np.uint8)
            frame[..., 3] = np.where(frame[..., 3] > 127, 255, np.where(frame[..., 3] > 40, frame[..., 3], 0))
            out.append(frame)
        return out


def interpolate(keys, between=1, method="auto", max_move=0.03, loop=False, easing="inout", rife=(None, None), max_move_rife=0.08, work="."):
    """Trả (frames, pairs). Chọn cách bù cho từng cặp key theo quãng dịch của phần chuyển động (tỉ lệ chiều cao nhân vật):
    - auto: RIFE nếu có và dịch <= max_move_rife; không có RIFE thì optical flow nếu có cv2 và dịch <= max_move; còn lại giữ frame
      (chỉnh nhịp) và báo nên sinh thêm key giữa hai key đó.
    - rife / flow / hold: ép một cách. Flow Farneback chỉ hợp chuyển động nhỏ (thở, nhún, áo choàng); vật mảnh xoay xa (kiếm, cung)
      ra viền đôi / bóng ma. RIFE chịu được quãng dịch vừa nhưng vẫn méo khi pose đổi hẳn: luôn xem contact.png."""
    frames, pairs = [], []
    count = len(keys)
    last = count if loop else count - 1
    exe, model = rife
    for index in range(last):
        a, b = keys[index], keys[(index + 1) % count]
        gap, (far, far_px) = difference(a, b), motion(a, b)
        name = f"{index + 1} và {(index + 1) % count + 1}"
        times = [ease((step + 1) / (between + 1), easing) for step in range(between)]
        made, chosen, note = None, "", ""
        use_rife = method == "rife" or (method == "auto" and exe and far <= max_move_rife)
        use_flow = method == "flow" or (method == "auto" and cv2 is not None and far <= max_move)
        if method == "hold" or between == 0:
            chosen = "hold"
        if not chosen and use_rife:
            if not exe:
                note = "không tìm thấy RIFE (cài ở Office Desk: Settings > Plugins, hoặc --rife <exe>)"
            else:
                try:
                    made, chosen = rife_frames(a, b, times, exe, model, work), "rife"
                    if far > max_move_rife:
                        note = f"ép RIFE dù phần chuyển động dịch {far_px} px: xem kỹ chỗ méo"
                except Exception as error:  # GPU / Vulkan lỗi: lùi về flow hoặc giữ frame
                    note = f"RIFE lỗi ({error}); dùng cách khác"
        if not chosen and (use_flow or (use_rife and cv2 is not None and far <= max_move)):
            if cv2 is None:
                note = "không có cv2 (cài: python -m pip install opencv-python)"
            else:
                made, chosen = flow_frames(a, b, times), "flow"
                if method == "flow" and far > max_move:
                    note = f"ép flow dù phần chuyển động dịch {far_px} px: xem kỹ viền đôi"
        if not chosen:
            chosen = "hold"
            limit = max_move_rife if exe else max_move
            if not note and far > limit:
                note = f"phần chuyển động giữa key {name} dịch {far_px} px ({far:.1%} chiều cao > {limit:.1%}): nên sinh thêm key giữa {name}"
            elif not note and method == "auto":
                note = "không có RIFE và cv2: chỉ giữ frame (cài RIFE ở Settings > Plugins của Office Desk, hoặc python -m pip install opencv-python)"
        frames.append(a)
        frames.extend(made if made is not None else [a if t < 0.5 else b for t in times])
        pairs.append({"from": index + 1, "to": (index + 1) % count + 1, "gap": round(gap, 3), "move_px": far_px, "move": round(far, 4), "method": chosen, "between": between, "note": note})
    if not loop:
        frames.append(keys[-1])
    return frames, pairs


# ---------------------------------------------------------------- 5. đo và xuất
def measure(frames, jump=0.15, loop=False, height_tolerance=0.08):
    rows, flags = [], []
    heights = []
    for frame in frames:
        box = bbox(mask_of(frame))
        heights.append(0 if box is None else box[3] - box[1])
    median_h = sorted(heights)[len(heights) // 2] or 1
    total = len(frames) if loop else len(frames) - 1
    for index in range(total):
        a, b = frames[index], frames[(index + 1) % len(frames)]
        box_a, box_b = bbox(mask_of(a)), bbox(mask_of(b))
        diff = difference(a, b)
        foot = 0 if not box_a or not box_b else box_b[3] - box_a[3]
        rows.append({"pair": f"{index + 1}->{(index + 1) % len(frames) + 1}", "diff": round(diff, 3), "foot_dy": foot})
        if diff > jump:
            flags.append(f"frame {index + 1}->{(index + 1) % len(frames) + 1} đổi {diff:.0%} > ngưỡng {jump:.0%}")
        if abs(foot) > 2:
            flags.append(f"frame {index + 1}->{(index + 1) % len(frames) + 1} lệch chân {foot} px")
    for index, height in enumerate(heights):
        if abs(height - median_h) / median_h > height_tolerance:
            flags.append(f"frame {index + 1} cao {height} px, lệch {abs(height - median_h) / median_h:.0%} so với trung vị {median_h} px (đổi cỡ hoặc pose cúi/nhảy: tự xem)")
    return rows, flags


def checker(width, height, size=8):
    ys, xs = np.mgrid[0:height, 0:width]
    tile = ((ys // size + xs // size) % 2).astype(np.uint8)
    plate = np.where(tile[..., None] == 1, 205, 240).astype(np.uint8)
    return np.concatenate([np.repeat(plate, 3, axis=2), np.full((height, width, 1), 255, np.uint8)], axis=2)


def compose(frame, background):
    alpha = frame[..., 3:4].astype(np.float32) / 255
    out = background.copy().astype(np.float32)
    out[..., :3] = frame[..., :3] * alpha + out[..., :3] * (1 - alpha)
    return out.astype(np.uint8)


def pack(frames, cols):
    h, w = frames[0].shape[:2]
    rows = math.ceil(len(frames) / cols)
    sheet = np.zeros((rows * h, cols * w, 4), np.uint8)
    for index, frame in enumerate(frames):
        y, x = divmod(index, cols)
        sheet[y * h:(y + 1) * h, x * w:(x + 1) * w] = frame
    return sheet


def contact(frames, cols, keys_at):
    h, w = frames[0].shape[:2]
    tiles = [compose(frame, checker(w, h)) for frame in frames]
    image = Image.fromarray(pack(tiles, cols), "RGBA")
    draw = ImageDraw.Draw(image)
    for index in range(len(frames)):
        y, x = divmod(index, cols)
        label = f"{index + 1}" + (" K" if index in keys_at else "")
        draw.rectangle([x * w, y * h, x * w + 8 * len(label) + 6, y * h + 14], fill=(0, 0, 0, 180))
        draw.text((x * w + 3, y * h + 1), label, fill=(255, 255, 255, 255))
    return image


def write_outputs(out, frames, keys_at, fps, cols, report):
    os.makedirs(os.path.join(out, "frames"), exist_ok=True)
    for index, frame in enumerate(frames):
        save_rgba(frame, os.path.join(out, "frames", f"frame_{index + 1:03d}.png"))
    cols = cols or min(len(frames), 8)
    save_rgba(pack(frames, cols), os.path.join(out, "sheet.png"))
    contact(frames, cols, keys_at).save(os.path.join(out, "contact.png"))
    h, w = frames[0].shape[:2]
    gif = [Image.fromarray(compose(frame, checker(w, h)), "RGBA").convert("P", palette=Image.ADAPTIVE) for frame in frames]
    gif[0].save(os.path.join(out, "preview.gif"), save_all=True, append_images=gif[1:], duration=int(1000 / fps), loop=0, disposal=2)
    with open(os.path.join(out, "report.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    lines = [f"# Kết quả art-frames v{KIT_VERSION}", "",
             f"- Kết luận: **{report['verdict']}**",
             f"- Key: {report['keys']} · frame cuối: {report['frames']} · fps: {fps} · {'lặp' if report['loop'] else 'chạy 1 lần'} · thời lượng {report['frames'] / fps:.2f} s",
             f"- Tách nền: {report['background']['mode']} {', '.join(report['background']['colors'])} (ngưỡng {report['background']['tolerance']}, co viền {report['background']['erode']} px)",
             f"- Canvas: {report['align']['canvas'][0]}x{report['align']['canvas'][1]}, đường chân y={report['align']['foot_y']}, neo {report['align']['anchor']}",
             f"- Nội suy: RIFE {'có' if report['rife'] else 'không có'} · cv2 {'có' if report['cv2'] else 'không có'}", "", "| Cặp key | Khác cả hình | Phần chuyển động dịch (p90) | Cách bù | Ghi chú |", "|---|---:|---:|---|---|"]
    lines += [f"| {p['from']}->{p['to']} | {p['gap']:.0%} | {p['move_px']} px ({p['move']:.1%}) | {p['method']} x{p['between']} | {p['note']} |" for p in report["pairs"]]
    lines += ["", "## Cần xem"] + ([f"- {flag}" for flag in report["flags"]] or ["- Không có"])
    lines += ["", "Tệp: frames/frame_###.png, sheet.png (trong suốt), contact.png (K = key), preview.gif (nền caro, chỉ để xem)."]
    with open(os.path.join(out, "report.md"), "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")


# ---------------------------------------------------------------- CLI
def size_arg(text):
    try:
        a, b = text.lower().split("x")
        return int(a), int(b)
    except ValueError:
        raise argparse.ArgumentTypeError(f"cần dạng CỘTxHÀNG hoặc RỘNGxCAO: {text}")


def load_keys(args):
    if args.keys_dir:
        names = sorted(name for name in os.listdir(args.keys_dir) if name.lower().endswith(".png"))
        frames = [load_rgba(os.path.join(args.keys_dir, name)) for name in names]
        cleaned, info = [], None
        for frame in frames:
            frame, info = remove_background(frame, args.bg, args.tolerance, args.erode, args.holes)
            cleaned.append(frame)
        return cleaned, info
    sheet, info = remove_background(load_rgba(args.sheet), args.bg, args.tolerance, args.erode, args.holes)
    keys = split_grid(sheet, *args.grid, args.count) if args.grid else split_auto(sheet, args.count)
    return keys, info


def command_run(args):
    keys, background = load_keys(args)
    if len(keys) < 2:
        sys.exit(f"Chỉ tìm thấy {len(keys)} key: kiểm --grid/--count hoặc tách nền (--bg, --tolerance).")
    keys, placement = align(keys, args.anchor, args.canvas)
    rife = find_rife(args.rife, args.rife_model)
    frames, pairs = interpolate(keys, args.between, args.method, args.max_move, args.loop, args.easing, rife, args.max_move_rife, args.out)
    step = args.between + 1
    keys_at = {index * step for index in range(len(keys))}
    _, flags = measure(frames, args.jump, args.loop)
    _, key_flags = measure(keys, 1.0, args.loop)  # chỉ lấy lỗi lệch chân / đổi cỡ ở key
    notes = list(dict.fromkeys(pair["note"] for pair in pairs if pair["note"]))  # mỗi ghi chú một lần (vd thiếu cv2)
    all_flags = notes + [f"key: {flag}" for flag in key_flags if "lệch chân" in flag or "cao" in flag] + flags
    report = {"kit": KIT_VERSION, "verdict": "ĐẠT" if not all_flags else "CẦN XEM", "keys": len(keys), "frames": len(frames), "fps": args.fps, "loop": args.loop,
              "background": background, "align": placement, "cv2": cv2 is not None, "rife": rife[0] or "", "pairs": pairs, "flags": all_flags}
    write_outputs(args.out, frames, keys_at, args.fps, args.cols, report)
    print(f"{report['verdict']}: {len(keys)} key -> {len(frames)} frame, ghi ở {args.out} (đọc report.md, xem contact.png)")
    for flag in report["flags"]:
        print("  - " + flag)


def command_clean(args):
    image, info = remove_background(load_rgba(args.input), args.bg, args.tolerance, args.erode, args.holes)
    save_rgba(image, args.out)
    print(json.dumps(info, ensure_ascii=False))


def command_measure(args):
    names = sorted(name for name in os.listdir(args.frames_dir) if name.lower().endswith(".png"))
    rows, flags = measure([load_rgba(os.path.join(args.frames_dir, name)) for name in names], args.jump, args.loop)
    print(json.dumps({"frames": len(names), "pairs": rows, "flags": flags}, ensure_ascii=False, indent=2))


def add_clean_options(parser):
    parser.add_argument("--bg", type=hex_color, action="append", help="màu nền (hex, lặp được); mặc định tự dò từ viền ảnh")
    parser.add_argument("--tolerance", type=float, default=40, help="ngưỡng khác màu so với nền (0-441), mặc định 40")
    parser.add_argument("--erode", type=int, default=1, help="co viền hình bao nhiêu px để bỏ quầng nền, mặc định 1")
    parser.add_argument("--holes", action="store_true", help="xoá cả vùng kín cùng màu nền (giữa tay và thân)")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Kit art-frames của Office Desk: key pose -> animation từng frame.")
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="cả quy trình: tách nền, cắt key, canh, bù frame, đo, xuất")
    source = run.add_mutually_exclusive_group(required=True)
    source.add_argument("--sheet", help="sheet key pose (PNG)")
    source.add_argument("--keys-dir", help="thư mục key đã tách sẵn (key_01.png, key_02.png…, xếp theo tên)")
    run.add_argument("--grid", type=size_arg, help="lưới CỘTxHÀNG của sheet; bỏ trống thì tự dò từng pose")
    run.add_argument("--count", type=int, help="số key cần lấy (bỏ ô thừa)")
    run.add_argument("--out", required=True, help="thư mục kết quả")
    run.add_argument("--between", type=int, default=1, help="số frame bù giữa mỗi cặp key, mặc định 1")
    run.add_argument("--method", choices=["auto", "rife", "flow", "hold"], default="auto", help="auto: RIFE nếu có và quãng dịch vừa, không thì flow khi quãng dịch nhỏ và có cv2, còn lại giữ frame")
    run.add_argument("--max-move", type=float, default=0.03, help="quãng dịch tối đa của phần chuyển động (tỉ lệ chiều cao nhân vật) để còn nội suy flow, mặc định 0.03")
    run.add_argument("--max-move-rife", type=float, default=0.08, help="như --max-move nhưng cho RIFE, mặc định 0.08")
    run.add_argument("--rife", help="đường dẫn rife-ncnn-vulkan; mặc định lấy từ kit.json (Office Desk ghi khi đã cài RIFE) hoặc biến RIFE_NCNN_VULKAN")
    run.add_argument("--rife-model", help="thư mục model RIFE, mặc định rife-v4.6 cạnh exe")
    run.add_argument("--easing", choices=["inout", "linear"], default="inout")
    run.add_argument("--loop", action="store_true", help="clip lặp: bù cả cặp key cuối -> key đầu")
    run.add_argument("--anchor", choices=["feet", "bbox", "mass"], default="feet", help="neo canh ngang: tâm chân (mặc định), tâm khung, trọng tâm")
    run.add_argument("--canvas", type=size_arg, help="canvas tối thiểu RỘNGxCAO")
    run.add_argument("--fps", type=int, default=12)
    run.add_argument("--cols", type=int, help="số cột của sheet.png xuất ra, mặc định tối đa 8")
    run.add_argument("--jump", type=float, default=0.15, help="ngưỡng đổi giữa hai frame kề của bản phát, mặc định 0.15")
    add_clean_options(run)
    run.set_defaults(func=command_run)
    clean = sub.add_parser("clean", help="chỉ tách nền một ảnh")
    clean.add_argument("input")
    clean.add_argument("--out", required=True)
    add_clean_options(clean)
    clean.set_defaults(func=command_clean)
    meter = sub.add_parser("measure", help="chỉ đo độ đổi giữa các frame của một thư mục")
    meter.add_argument("frames_dir")
    meter.add_argument("--jump", type=float, default=0.15)
    meter.add_argument("--loop", action="store_true")
    meter.set_defaults(func=command_measure)
    sub.add_parser("version", help="in version kit và thư viện").set_defaults(func=lambda args: print(json.dumps({"kit": KIT_VERSION, "numpy": np.__version__, "cv2": getattr(cv2, "__version__", None), "rife": find_rife()[0]})))
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
