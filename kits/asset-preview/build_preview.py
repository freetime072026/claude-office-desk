"""Asset preview of a game project: gallery of every image in assets/ and input/, Spine anim, frame-by-frame anim
and the game's own VFX. Kit asset-preview of Office Desk (see KIT.md next to this file).

Run:   python .office-desk/preview/build_preview.py [--root <project>]
       (root defaults to the folder that holds .office-desk/; the Build preview button of Office Desk passes it)
Needs: Pillow. Optional: psd-tools (PSB, some PSD), node + esbuild + phaser in the project (VFX view),
       @esotericsoftware/spine-webgl in the project (Spine view).
Output: <out>/index.html (+ thumbs/, rigs/, vfx/), out = "input/_preview" unless preview.config.json says otherwise.
Thumbnails are cached; delete thumbs/ to rebuild. Add ?raf=timer to the URL to check it in a hidden tab.
"""
import base64
import json
import os
import re
import subprocess
import zlib
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = None

KIT = Path(__file__).resolve().parent
DEFAULTS = {
    "scan": ["assets", "input"],   # folders (from the project root) shown in the preview
    "title": "",                   # page title, default = project folder name
    "out": "input/_preview",       # where index.html and its caches go (input/ is not committed in template-pla)
    "src": "src",                  # game code: clip names found there are marked "game dùng"
    "vfx": {"entry": "vfx_entry.ts", "effects": "vfx_effects.js"},  # project files next to this script; none = no VFX view
}
# Set by setup(): project root, config, output folders
ROOT = OUT = THUMBS = RIGS_DIR = VFX_JS = SPINE_JS = None
CONF = dict(DEFAULTS)
SCAN = DEFAULTS["scan"]
WEB = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
LAYERED = {".psd", ".psb"}
SKIP_DIRS = {"_preview", "node_modules", ".office-desk", ".git"}
THUMB = 320
BIG = 1800


def key(rel: str) -> str:
    return rel.replace("/", "__").replace(" ", "_")


def open_layered(src: Path):
    if src.suffix.lower() == ".psd":
        try:
            im = Image.open(src)
            im.load()
            return im
        except Exception:
            pass
    from psd_tools import PSDImage  # optional

    psd = PSDImage.open(src)
    return psd.topil() or psd.composite()


def work(args):
    rel, src, thumbs = args
    THUMBS = Path(thumbs)
    src = Path(src)
    ext = src.suffix.lower()
    k = key(rel)
    thumb = THUMBS / f"{k}.webp"
    big = THUMBS / f"{k}.big.webp" if ext in LAYERED else None
    meta = THUMBS / f"{k}.json"
    mtime = src.stat().st_mtime
    if meta.exists() and thumb.exists() and thumb.stat().st_mtime >= mtime:
        return json.loads(meta.read_text(encoding="utf-8"))
    try:
        im = open_layered(src) if ext in LAYERED else Image.open(src)
        w, h = im.size
        mode = im.mode
        im = im.convert("RGBA")
        if big is not None:
            b = im.copy()
            b.thumbnail((BIG, BIG), Image.LANCZOS)
            b.save(big, "WEBP", quality=82)
        im.thumbnail((THUMB, THUMB), Image.LANCZOS)
        im.save(thumb, "WEBP", quality=80)
        alpha = im.getchannel("A").getextrema()[0] < 255
        info = {"w": w, "h": h, "mode": mode, "alpha": alpha, "err": None}
    except Exception as e:  # keep going, show the file as an error card
        info = {"w": 0, "h": 0, "mode": "", "alpha": False, "err": f"{type(e).__name__}: {e}"[:200]}
    meta.write_text(json.dumps(info), encoding="utf-8")
    return info


MIME = {".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}


def data_uri(p: Path, mime: str) -> str:
    return f"data:{mime};base64," + base64.b64encode(p.read_bytes()).decode()


def used_patterns():
    """String literals in src/ (template `${…}` parts become wildcards), to mark clips the game plays."""
    pats = set()
    for f in (ROOT / CONF["src"]).rglob("*.ts"):
        text = f.read_text(encoding="utf-8", errors="ignore")
        for m in re.finditer(r"'([^'\n]+)'|\"([^\"\n]+)\"|`([^`]+)`", text):
            s = next(g for g in m.groups() if g is not None)
            parts = re.split(r"\$\{[^}]*\}", s)
            pats.add(re.compile("^" + ".+".join(re.escape(x) for x in parts) + "$"))
    return pats


def setup(argv):
    """Project root (--root, else the folder holding .office-desk/, else cwd), preview.config.json, output folders."""
    global ROOT, OUT, THUMBS, RIGS_DIR, VFX_JS, SPINE_JS, CONF, SCAN
    root = None
    if "--root" in argv:
        root = Path(argv[argv.index("--root") + 1])
    elif KIT.parent.name == ".office-desk":
        root = KIT.parent.parent
    ROOT = (root or Path.cwd()).resolve()
    conf = dict(DEFAULTS)
    cfile = KIT / "preview.config.json"
    if cfile.exists():
        conf.update(json.loads(cfile.read_text(encoding="utf-8")))
    CONF, SCAN = conf, conf["scan"]
    OUT = (ROOT / conf["out"]).resolve()
    THUMBS, RIGS_DIR, VFX_JS = OUT / "thumbs", OUT / "rigs", OUT / "vfx" / "game_fx.js"
    # the project's own Spine runtime (same version as the game)
    SPINE_JS = ROOT / "node_modules/@esotericsoftware/spine-webgl/dist/iife/spine-webgl.min.js"
    SKIP_DIRS.add(OUT.name)


def rel_root():
    """Project root as seen from index.html (e.g. ../..), used for every link to a project file."""
    return Path(os.path.relpath(ROOT, OUT)).as_posix()


def to_runtime42(sk: dict, js: Path) -> list:
    """Make a Spine 4.3 export readable by the 4.2 runtime the game uses. Returns notes on what changed."""
    fixes = []
    # like the game (src/scene/fx.ts registerSpineData): extra clips from a sibling animations-only JSON
    for other in sorted(js.parent.glob("*.json")):
        if other == js:
            continue
        try:
            o = json.loads(other.read_text(encoding="utf-8"))
        except Exception:
            continue
        if isinstance(o, dict) and isinstance(o.get("animations"), dict) and "bones" not in o:
            new = [n for n in o["animations"] if n not in sk.setdefault("animations", {})]
            sk["animations"].update(o["animations"])
            if new:
                fixes.append(f"gộp clip {', '.join(new)} từ {other.name} (như game)")
    # toSpine42 in src/scene/fx.ts: 4.3 linked meshes name their source `source`, 4.2 reads `parent`
    for skin in sk.get("skins") or []:
        for slot in (skin.get("attachments") or {}).values():
            for att in slot.values():
                if att.get("type") == "linkedmesh" and "source" in att and "parent" not in att:
                    att["parent"] = att.pop("source")
    # 4.3 keeps every constraint in one `constraints` list (list order = update order); 4.2 has ik/transform/path
    # lists with an `order` field
    cons = sk.pop("constraints", None)
    if cons:
        dropped, converted = [], []
        for order, c in enumerate(cons):
            t = c.pop("type", "")
            if t in ("ik", "path"):
                c.setdefault("order", order)
                if t == "path" and "slot" in c and "target" not in c:  # 4.3 names the path slot `slot`, 4.2 `target`
                    c["target"] = c.pop("slot")
                sk.setdefault(t, []).append(c)
            elif t == "transform" and (tc := transform42(c)) is not None:
                tc.setdefault("order", order)
                sk.setdefault("transform", []).append(tc)
                converted.append(c.get("name", "?"))
            else:  # 4.3 mapping with offsets / scale, sliders, 4.3 physics: no 4.2 equivalent
                dropped.append(c.get("name", "?"))
        if dropped:
            gone = set(dropped)
            for a in sk.get("animations", {}).values():
                for kind in ("transform", "path", "physics", "ik", "slider"):
                    tl = a.get(kind)
                    if isinstance(tl, dict):
                        for n in gone:
                            tl.pop(n, None)
                        if not tl:
                            a.pop(kind)
            # skins list the constraints they switch on: a dropped name makes the 4.2 reader fail
            for skin in sk.get("skins") or []:
                for kind in ("ik", "transform", "path", "physics", "slider", "constraints"):
                    if isinstance(skin.get(kind), list):
                        skin[kind] = [n for n in skin[kind] if n not in gone]
                        if not skin[kind]:
                            skin.pop(kind)
            fixes.append(f"bỏ {len(dropped)} constraint 4.3 runtime 4.2 không đọc được: {', '.join(dropped)} (chuyển động có thể lệch)")
        if converted:
            fixes.append(f"đổi {len(converted)} transform constraint 4.3 sang dạng 4.2 (bỏ giới hạn max): {', '.join(converted)}")
    return fixes


def transform42(c: dict):
    """4.3 transform constraint -> 4.2, when its property mapping is the plain 4.2 one (each property drives
    the same property, no from / to offsets, no scale). Returns None otherwise."""
    props = c.get("properties") or {}
    names = {"rotate": "Rotate", "x": "X", "y": "Y", "scaleX": "ScaleX", "scaleY": "ScaleY", "shearY": "ShearY"}
    for fp, v in props.items():
        to = v.get("to") or {}
        if fp not in names or v.get("offset") or set(to) != {fp} or to[fp].get("offset") or to[fp].get("scale", 1) != 1:
            return None
    out = {"name": c["name"], "bones": c.get("bones", []), "target": c.get("source")}
    if c.get("skin"):
        out["skin"] = True
    if c.get("localTarget") or c.get("localSource"):
        out["local"] = True
    if c.get("additive"):
        out["relative"] = True
    for k43, k42 in (("rotate", "rotation"), ("x", "x"), ("y", "y"), ("scaleX", "scaleX"), ("scaleY", "scaleY"), ("shearY", "shearY")):
        if k43 in c:
            out[k42] = c[k43]
    mix_x = c.get("mixX", 1)
    mix_sx = c.get("mixScaleX", 1)
    mixes = {"rotate": c.get("mixRotate", 1), "x": mix_x, "y": c.get("mixY", mix_x), "scaleX": mix_sx,
             "scaleY": c.get("mixScaleY", mix_sx), "shearY": c.get("mixShearY", 1)}
    for p, n in names.items():  # a property the 4.3 constraint does not map gets no mix in 4.2
        out["mix" + n] = mixes[p] if p in props else 0
    return out


def find_rigs():
    """Spine exports (skeleton JSON + atlas + pages) under assets/ and input/. Each rig's data goes to rigs/<id>.js
    (data URIs), loaded by the page only when that rig is opened; index.html keeps the list."""
    pats = used_patterns()
    rigs = []
    RIGS_DIR.mkdir(exist_ok=True)
    keep = set()
    for top in SCAN:
        for js in sorted((ROOT / top).rglob("*.json")):
            if any(s in js.parts for s in SKIP_DIRS):
                continue
            try:
                sk = json.loads(js.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not isinstance(sk, dict) or "skeleton" not in sk or "bones" not in sk:
                continue
            atlases = [a for a in js.parent.iterdir() if a.name.lower().endswith((".atlas", ".atlas.txt"))]
            same = [a for a in atlases if re.sub(r"\.atlas(\.txt)?$", "", a.name, flags=re.I) == js.stem]
            atlas = (same or (atlases if len(atlases) == 1 else [None]))[0]
            if atlas is None:
                continue  # raw PhotoshopToSpine setup, no export
            rel = js.relative_to(ROOT).as_posix()
            rid = re.sub(r"[^a-z0-9]+", "_", rel.lower()).strip("_")
            atext = atlas.read_text(encoding="utf-8", errors="ignore")
            pages, kb_pages = {}, 0
            for line in atext.splitlines():
                line = line.strip()
                p = js.parent / line
                if Path(line).suffix.lower() in MIME and ":" not in line and p.exists():
                    pages[f"{rid}/{line}"] = data_uri(p, MIME[p.suffix.lower()])
                    kb_pages += p.stat().st_size
            fixes = to_runtime42(sk, js)
            clips = list((sk.get("animations") or {}).keys())
            skins = sk.get("skins") or []
            skins = [s.get("name") for s in skins] if isinstance(skins, list) else list(skins)
            used = [c for c in clips if rel.startswith("assets/") and any(p.match(c) for p in pats)]
            rigs.append({
                "id": rid,
                "name": js.stem,
                "dir": js.parent.relative_to(ROOT).as_posix(),
                "src": rel,
                "ver": (sk.get("skeleton") or {}).get("spine", ""),
                "clips": clips,
                "skins": skins,
                "used": used,
                "pma": bool(re.search(r"^\s*pma:\s*true", atext, re.I | re.M)),
                "kb": round((js.stat().st_size + atlas.stat().st_size + kb_pages) / 1024),
                "fixes": fixes,
                "pages": [k[len(rid) + 1:] for k in pages],
                "data": f"rigs/{rid}.js",
            })
            payload = {
                "skel": "data:application/json;base64," + base64.b64encode(json.dumps(sk).encode()).decode(),
                "atlas": data_uri(atlas, "text/plain"),
                "files": pages,
            }
            out = RIGS_DIR / f"{rid}.js"
            text = f"window.__rigData({json.dumps(rid)}, {json.dumps(payload)});\n"
            if not out.exists() or out.read_text(encoding="utf-8") != text:
                out.write_text(text, encoding="utf-8")
            keep.add(out.name)
            rigs[-1]["data"] += f"?v={zlib.crc32(text.encode()):08x}"  # new data, new URL (no stale cache)
    for old in RIGS_DIR.glob("*.js"):
        if old.name not in keep:
            old.unlink()
    return rigs


ANIM_HINT = re.compile(r"(^|[^a-z])(fx|vfx|anim|effect|muzzle|explo|smoke|spark|fire|flash|hit|frame|seq)", re.I)


def find_sequences(items):
    """Numbered images in one folder (name_001.png, Comp 1_00002.png, 3.png…) = frame-by-frame sequences.
    `anim` marks the likely animations / VFX: zero-padded numbers, or fx / anim / muzzle… in the folder or name;
    the rest (item tiers, tiles, screenshots that happen to be numbered) is listed apart."""
    groups = {}
    for it in items:
        if it["err"] or Path(it["p"]).suffix.lower() not in WEB:
            continue
        d, fn = it["p"].rsplit("/", 1)
        m = re.match(r"^(.*?)(\d+)(\.[a-z]+)$", fn, re.I)
        if m:
            groups.setdefault((d, m.group(1), m.group(3).lower()), []).append((int(m.group(2)), m.group(2), it))
    seqs = []
    for (d, prefix, ext), frames in groups.items():
        if len(frames) < 3:
            continue
        frames.sort(key=lambda f: f[0])
        padded = any(len(s) > 1 and s.startswith("0") for _, s, _ in frames)
        anim = padded or bool(ANIM_HINT.search(d.rsplit("/", 1)[-1]) or ANIM_HINT.search(prefix))
        sizes = {(it["w"], it["h"]) for _, _, it in frames}
        seqs.append({
            "id": re.sub(r"[^a-z0-9]+", "_", f"{d}/{prefix}{ext}".lower()).strip("_"),
            "name": (prefix.strip(" _-") or d.rsplit("/", 1)[-1]) + f" [{frames[0][1]}–{frames[-1][1]}]",
            "dir": d,
            "frames": [it["p"] for _, _, it in frames],
            "anim": anim,
            "w": max(w for w, _ in sizes), "h": max(h for _, h in sizes),
            "sameSize": len(sizes) == 1,
            "kb": sum(it["kb"] for _, _, it in frames),
        })
    seqs.sort(key=lambda s: (not s["anim"], s["dir"], s["name"]))
    return seqs


def main():
    setup(sys.argv[1:])
    THUMBS.mkdir(parents=True, exist_ok=True)
    up = rel_root() + "/"
    images, others = [], {}
    for top in SCAN:
        for dirpath, dirnames, files in os.walk(ROOT / top):
            dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
            for f in sorted(files):
                p = Path(dirpath) / f
                rel = p.relative_to(ROOT).as_posix()
                ext = p.suffix.lower()
                if ext in WEB or ext in LAYERED:
                    images.append((rel, str(p), str(THUMBS)))
                else:
                    others.setdefault(Path(rel).parent.as_posix(), []).append(
                        {"n": f, "kb": round(p.stat().st_size / 1024)}
                    )
    print(f"{len(images)} images, generating thumbnails…", flush=True)
    with ProcessPoolExecutor() as ex:
        infos = list(ex.map(work, images, chunksize=4))
    items = []
    for (rel, src, _), info in zip(images, infos):
        ext = Path(rel).suffix.lower()
        k = key(rel)
        items.append({
            "p": rel,
            "kb": round(Path(src).stat().st_size / 1024),
            "t": f"thumbs/{k}.webp",
            "f": f"thumbs/{k}.big.webp" if ext in LAYERED else up + rel,
            "src": up + rel,
            **info,
        })
    errs = [i for i in items if i["err"]]
    rigs = find_rigs()
    seqs = find_sequences(items)
    data = json.dumps({"items": items, "others": others, "rigs": rigs, "seqs": seqs}, ensure_ascii=False)
    runtime = SPINE_JS.read_text(encoding="utf-8").replace("</script", "<\\/script") if SPINE_JS.exists() else ""
    # VFX view: the game's effect code bundled by esbuild into vfx/game_fx.js (Phaser itself is read from node_modules)
    VFX_JS.parent.mkdir(exist_ok=True)
    entry, effects = KIT / CONF["vfx"].get("entry", ""), KIT / CONF["vfx"].get("effects", "")
    vfx_ok = False
    if entry.is_file() and effects.is_file():
        try:
            subprocess.run(["node", str(KIT / "build_vfx.mjs"), str(entry), str(VFX_JS)], cwd=ROOT, capture_output=True,
                           text=True, encoding="utf-8", check=True)
            vfx_ok = True
        except Exception as e:  # the VFX view says the game effects are missing
            print("  ! build_vfx.mjs:", getattr(e, "stderr", "") or e)
            VFX_JS.unlink(missing_ok=True)
    else:
        print(f"  (no VFX view: add {entry.name} + {effects.name} next to build_preview.py, see KIT.md)")
    if not runtime:
        print(f"  (no Spine view: {SPINE_JS.relative_to(ROOT)} not found, run npm install in the project)")
    html = (KIT / "template.html").read_text(encoding="utf-8")
    html = html.replace("/*__SPINE__*/", runtime).replace("__ROOT__/", up).replace("__TITLE__", CONF.get("title") or ROOT.name)
    html = html.replace("/*__VFX_EFFECTS__*/", effects.read_text(encoding="utf-8") if vfx_ok else "")
    html = html.replace("/*__VFX__*/null", json.dumps({"ok": vfx_ok, "stamp": int(VFX_JS.stat().st_mtime) if vfx_ok else 0})).replace("/*__DATA__*/null", data)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "index.html").write_text(html, encoding="utf-8")
    print(f"index.html: {len(items)} images, {len(rigs)} spine rigs, "
          f"{len(seqs)} frame sequences ({sum(s['anim'] for s in seqs)} likely anim), {len(errs)} unreadable, "
          f"game VFX {'ok' if vfx_ok else 'FAILED' if entry.is_file() and effects.is_file() else 'off'}")
    for r in rigs:
        print(f"  spine {r['src']}  v{r['ver'] or '?'}  {len(r['clips'])} clip  used: {', '.join(r['used']) or '-'}")
    for e in errs:
        print("  !", e["p"], "-", e["err"])
    print("OUT", OUT / "index.html")


if __name__ == "__main__":
    sys.exit(main())
