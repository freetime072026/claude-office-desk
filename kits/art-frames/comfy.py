#!/usr/bin/env python3
"""Kit art-frames của Office Desk: sinh ảnh bằng ComfyUI chạy trên máy (chế độ sinh ảnh 'comfyui' của khối Art).

Đọc comfy.json cạnh tệp này (Office Desk ghi trước mỗi lượt Art: server + preset của model đã cài), dựng workflow theo
family của model, gửi tới API ComfyUI (/prompt), chờ xong (/history) rồi tải ảnh về (/view). Chỉ dùng thư viện chuẩn.

  python comfy.py status
  python comfy.py gen --model dreamshaper-xl-lightning --prompt-file p.txt --out .office-desk/tmp/comfy/ART-1.png
  python comfy.py upscale --image in.png --out out.png [--scale 2]
Xem KIT.md (mục ComfyUI).
"""
import argparse
import json
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

for stream in (sys.stdout, sys.stderr):  # console Windows mặc định cp1252: in tiếng Việt bị UnicodeEncodeError
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
SDXL_NEGATIVE = "text, watermark, signature, logo, blurry, lowres, jpeg artifacts, cropped, extra limbs, extra fingers, deformed, bad anatomy"


def load_config(path=None):
    path = path or os.path.join(HERE, "comfy.json")
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        sys.exit(f"Không thấy {path}: Office Desk ghi tệp này trước lượt Art khi chọn sinh ảnh bằng ComfyUI.")


def http_json(url, data=None, timeout=30):
    body = json.dumps(data).encode("utf-8") if data is not None else None
    request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"} if body else {})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def find_server(config, wanted=None):
    for url in [wanted] if wanted else [config.get("server")] + list(config.get("servers") or []):
        if not url:
            continue
        try:
            http_json(url.rstrip("/") + "/system_stats", timeout=4)
            return url.rstrip("/")
        except (urllib.error.URLError, OSError, ValueError):
            continue
    return None


def model_of(config, model_id, family=None):
    for model in config.get("models") or []:
        if model["id"] == model_id and (family is None or model["family"] in family):
            return model
    names = ", ".join(m["id"] for m in config.get("models") or [] if family is None or m["family"] in family) or "(chưa cài model nào)"
    sys.exit(f"Model '{model_id}' chưa cài hoặc không dùng được ở đây. Đã cài: {names}. Cài thêm ở Office Desk: Settings > Plugins.")


# ---------------------------------------------------------------- workflow (định dạng API của ComfyUI)
def build_workflow(model, positive, negative, width, height, seed, steps, cfg, sampler, scheduler, loras=(), prefix="officedesk/art"):
    family, files = model["family"], model["files"]
    nodes = {}
    if family == "sdxl":
        nodes["1"] = {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": files["checkpoints"]}}
        model_ref, clip_ref, vae_ref = ["1", 0], ["1", 1], ["1", 2]
        for index, (lora_file, strength) in enumerate(loras):
            key = str(20 + index)
            nodes[key] = {"class_type": "LoraLoader", "inputs": {"model": model_ref, "clip": clip_ref, "lora_name": lora_file, "strength_model": strength, "strength_clip": strength}}
            model_ref, clip_ref = [key, 0], [key, 1]
        latent = {"class_type": "EmptyLatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}}
    elif family in ("zimage", "qwen"):
        nodes["1"] = {"class_type": "UNETLoader", "inputs": {"unet_name": files["diffusion_models"], "weight_dtype": "default"}}
        nodes["2"] = {"class_type": "CLIPLoader", "inputs": {"clip_name": files["text_encoders"], "type": model.get("clipType", "lumina2"), "device": "default"}}
        nodes["3"] = {"class_type": "VAELoader", "inputs": {"vae_name": files["vae"]}}
        nodes["4"] = {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["1", 0], "shift": model.get("shift", 3)}}
        model_ref, clip_ref, vae_ref = ["4", 0], ["2", 0], ["3", 0]
        if loras:
            sys.exit("LoRA trong kit chỉ dùng cho model SDXL.")
        latent = {"class_type": "EmptySD3LatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}}
    else:
        sys.exit(f"Model '{model['id']}' (family {family}) không sinh ảnh một mình.")
    nodes["5"] = {"class_type": "CLIPTextEncode", "inputs": {"text": positive, "clip": clip_ref}}
    nodes["6"] = {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": clip_ref}}
    nodes["7"] = latent
    nodes["8"] = {"class_type": "KSampler", "inputs": {"model": model_ref, "seed": seed, "steps": steps, "cfg": cfg, "sampler_name": sampler, "scheduler": scheduler,
                                                        "positive": ["5", 0], "negative": ["6", 0], "latent_image": ["7", 0], "denoise": 1.0}}
    nodes["9"] = {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": vae_ref}}
    nodes["10"] = {"class_type": "SaveImage", "inputs": {"images": ["9", 0], "filename_prefix": prefix}}
    return nodes


def upscale_workflow(model, image_name, scale, prefix="officedesk/upscale"):
    nodes = {
        "1": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "2": {"class_type": "UpscaleModelLoader", "inputs": {"model_name": model["files"]["upscale_models"]}},
        "3": {"class_type": "ImageUpscaleWithModel", "inputs": {"upscale_model": ["2", 0], "image": ["1", 0]}},
    }
    last = ["3", 0]
    if scale != 4:  # model phóng 4 lần; muốn ít hơn thì thu lại bằng lanczos
        nodes["4"] = {"class_type": "ImageScaleBy", "inputs": {"image": last, "upscale_method": "lanczos", "scale_by": scale / 4}}
        last = ["4", 0]
    nodes["9"] = {"class_type": "SaveImage", "inputs": {"images": last, "filename_prefix": prefix}}
    return nodes


# ---------------------------------------------------------------- chạy trên server
def run_workflow(server, workflow, out_path, timeout):
    client = uuid.uuid4().hex
    try:
        queued = http_json(server + "/prompt", {"prompt": workflow, "client_id": client})
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        sys.exit(f"ComfyUI từ chối workflow (HTTP {error.code}): {detail[:1500]}")
    prompt_id = queued["prompt_id"]
    start = time.time()
    while True:
        history = http_json(f"{server}/history/{prompt_id}")
        entry = history.get(prompt_id)
        if entry:
            status = entry.get("status") or {}
            if status.get("status_str") == "error":
                messages = [m for m in status.get("messages") or [] if m and m[0] == "execution_error"]
                sys.exit("ComfyUI báo lỗi khi chạy: " + json.dumps(messages[-1][1] if messages else status, ensure_ascii=False)[:1500])
            images = [image for output in (entry.get("outputs") or {}).values() for image in output.get("images") or []]
            if images:
                break
            if status.get("completed"):
                sys.exit("ComfyUI chạy xong nhưng không trả ảnh.")
        if time.time() - start > timeout:
            sys.exit(f"Quá {timeout} giây chưa xong (prompt {prompt_id}). Card yếu thì giảm --width/--height hoặc dùng model nhẹ hơn.")
        time.sleep(1.0)
    image = images[0]
    query = urllib.parse.urlencode({"filename": image["filename"], "subfolder": image.get("subfolder", ""), "type": image.get("type", "output")})
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with urllib.request.urlopen(f"{server}/view?{query}", timeout=120) as response, open(out_path, "wb") as handle:
        handle.write(response.read())
    return time.time() - start


def upload_image(server, path):
    boundary = uuid.uuid4().hex
    name = f"officedesk_{uuid.uuid4().hex[:8]}_{os.path.basename(path)}"
    with open(path, "rb") as handle:
        data = handle.read()
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{name}\"\r\nContent-Type: image/png\r\n\r\n").encode() + data + \
        f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n--{boundary}--\r\n".encode()
    request = urllib.request.Request(server + "/upload/image", data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(request, timeout=60) as response:
        result = json.loads(response.read().decode("utf-8"))
    return (result.get("subfolder") + "/" if result.get("subfolder") else "") + result["name"]


def read_text(value, file):
    if file:
        with open(file, encoding="utf-8") as handle:
            return handle.read().strip()
    return (value or "").strip()


# ---------------------------------------------------------------- lệnh
def cmd_status(args, config):
    server = find_server(config, args.server)
    gpu = config.get("gpu") or {}
    print(f"GPU: {gpu.get('name') or 'không rõ'} · VRAM {gpu.get('vramGb') or '?'} GB · RAM {gpu.get('ramGb') or '?'} GB")
    if not server:
        print("ComfyUI: CHƯA CHẠY (đã thử " + ", ".join(filter(None, [config.get('server')] + list(config.get('servers') or []))) + ")")
        return 2
    stats = http_json(server + "/system_stats")
    print(f"ComfyUI: đang chạy ở {server} · bản {stats.get('system', {}).get('comfyui_version', '?')}")
    models = config.get("models") or []
    if not models:
        print("Model: chưa cài model nào (cài ở Office Desk: Settings > Plugins).")
        return 3
    for model in models:
        kind = "addon" if model.get("addon") else model["family"]
        defaults = "" if model.get("addon") else f" · mặc định {model.get('width')}x{model.get('height')}, {model.get('steps')} bước, cfg {model.get('cfg')}, prompt {'kiểu tag' if model.get('prompt') == 'tags' else 'câu tự nhiên'}"
        print(f"- {model['id']} [{kind}]{defaults}: {model.get('use', '')}")
    return 0


def cmd_gen(args, config):
    model = model_of(config, args.model, family=("sdxl", "zimage", "qwen"))
    positive = read_text(args.prompt, args.prompt_file)
    if not positive:
        sys.exit("Thiếu prompt (--prompt hoặc --prompt-file).")
    negative = read_text(args.negative, args.negative_file)
    if not negative and model["family"] == "sdxl":
        negative = SDXL_NEGATIVE
    steps, cfg, sampler, scheduler = model.get("steps", 20), model.get("cfg", 5), model.get("sampler", "euler"), model.get("scheduler", "normal")
    loras = []
    if args.fast:
        if model["family"] != "sdxl":
            sys.exit("--fast chỉ dùng cho model SDXL.")
        lightning = model_of(config, "sdxl-lightning-lora", family=("lora",))
        loras.append((lightning["files"]["loras"], 1.0))
        steps, cfg, sampler, scheduler = 4, 1.0, "euler", "sgm_uniform"
    for spec in args.lora or []:
        lora_id, _, weight = spec.partition(":")
        lora = model_of(config, lora_id, family=("lora",))
        loras.append((lora["files"]["loras"], float(weight) if weight else float(lora.get("strength", 1.0))))
    steps = args.steps or steps
    cfg = args.cfg if args.cfg is not None else cfg
    width, height = args.width or model.get("width", 1024), args.height or model.get("height", 1024)
    seed = args.seed if args.seed is not None else random.randint(1, 2**31 - 1)
    if args.dry_run:
        print(json.dumps(build_workflow(model, positive, negative, width, height, seed, steps, cfg, sampler, scheduler, loras), ensure_ascii=False, indent=1))
        return 0
    server = find_server(config, args.server)
    if not server:
        sys.exit("ComfyUI chưa chạy: mở ComfyUI rồi chạy lại (Office Desk: khối Art > ComfyUI > ↻).")
    outs = []
    for index in range(args.count):
        out = args.out if args.count == 1 else "{0}_{2:02d}{1}".format(*os.path.splitext(args.out), index + 1)
        this_seed = seed + index
        took = run_workflow(server, build_workflow(model, positive, negative, width, height, this_seed, steps, cfg, sampler, scheduler, loras), out, args.timeout)
        outs.append(out)
        print(f"OK {os.path.abspath(out)} · model {model['id']} · seed {this_seed} · {width}x{height} · {steps} bước · cfg {cfg} · {took:.0f}s")
    return 0


def cmd_upscale(args, config):
    model = model_of(config, args.model, family=("upscale",))
    server = find_server(config, args.server)
    if not server:
        sys.exit("ComfyUI chưa chạy: mở ComfyUI rồi chạy lại.")
    name = upload_image(server, args.image)
    took = run_workflow(server, upscale_workflow(model, name, args.scale), args.out, args.timeout)
    print(f"OK {os.path.abspath(args.out)} · x{args.scale} · {took:.0f}s")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="Sinh ảnh bằng ComfyUI cho khối Art của Office Desk")
    parser.add_argument("--config", help="comfy.json (mặc định cạnh comfy.py)")
    parser.add_argument("--server", help="URL ComfyUI (mặc định lấy từ comfy.json)")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status", help="server, GPU và model đã cài")
    gen = sub.add_parser("gen", help="sinh ảnh từ prompt")
    gen.add_argument("--model", required=True)
    gen.add_argument("--prompt"); gen.add_argument("--prompt-file")
    gen.add_argument("--negative"); gen.add_argument("--negative-file")
    gen.add_argument("--out", required=True)
    gen.add_argument("--width", type=int); gen.add_argument("--height", type=int)
    gen.add_argument("--seed", type=int); gen.add_argument("--steps", type=int); gen.add_argument("--cfg", type=float)
    gen.add_argument("--lora", action="append", help="id[:trọng số], vd pixel-art-xl:1.2 (chỉ model SDXL)")
    gen.add_argument("--fast", action="store_true", help="SDXL Lightning LoRA: 4 bước, cfg 1")
    gen.add_argument("--count", type=int, default=1, help="số ảnh (seed tăng dần), tệp thêm hậu tố _01, _02…")
    gen.add_argument("--timeout", type=int, default=900)
    gen.add_argument("--dry-run", action="store_true", help="chỉ in workflow JSON")
    up = sub.add_parser("upscale", help="phóng to ảnh bằng model upscale")
    up.add_argument("--model", default="realesrgan-x4plus")
    up.add_argument("--image", required=True); up.add_argument("--out", required=True)
    up.add_argument("--scale", type=float, default=4)
    up.add_argument("--timeout", type=int, default=600)
    args = parser.parse_args(argv)
    config = load_config(args.config)
    return {"status": cmd_status, "gen": cmd_gen, "upscale": cmd_upscale}[args.command](args, config)


if __name__ == "__main__":
    sys.exit(main())
