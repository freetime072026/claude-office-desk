"""Fake rife-ncnn-vulkan for tests: same CLI (-0 A -1 B -o OUT -s T [-m MODEL] [-g ID]), writes the linear blend of A and B at T.
Lets tests check frames.py's RIFE plumbing (arguments, RGB/alpha split, recombination) without the real 430 MB tool.
FAKE_RIFE_FAIL_GPU=1: fail unless -g -1 is passed (checks the CPU retry). FAKE_RIFE_LOG=<file>: append each argv as a JSON line."""
import json, os, sys
import numpy as np
from PIL import Image

args = sys.argv[1:]
opts = {args[i]: args[i + 1] for i in range(0, len(args) - 1, 2) if args[i].startswith("-")}
if os.environ.get("FAKE_RIFE_LOG"):
    with open(os.environ["FAKE_RIFE_LOG"], "a", encoding="utf-8") as handle:
        handle.write(json.dumps(args) + "\n")
if os.environ.get("FAKE_RIFE_FAIL_GPU") and opts.get("-g") != "-1":
    sys.stderr.write("vkCreateInstance failed -9\n")
    sys.exit(255)
if opts.get("-m") and not os.path.isdir(opts["-m"]):
    sys.stderr.write("model not found\n")
    sys.exit(1)
t = float(opts.get("-s", "0.5"))
a = np.asarray(Image.open(opts["-0"]).convert("RGB")).astype(np.float32)
b = np.asarray(Image.open(opts["-1"]).convert("RGB")).astype(np.float32)
Image.fromarray(((1 - t) * a + t * b).clip(0, 255).astype(np.uint8), "RGB").save(opts["-o"])
