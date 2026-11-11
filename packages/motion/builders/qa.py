#!/usr/bin/env python3
"""
qa.py: checks a rendered piece (VIDEO.md §5.3 QA).

    python3 builders/qa.py sheet <stills folder> <out.png>     contact sheet of the stills, labelled
    python3 builders/qa.py check <video.mp4> [--format study]  size, duration, fps, audio, loudness

The stills come from build-video.mjs --qa, which renders every scene at its markers: end of the
voice, end of the quote, the spark complete. That is where every overlap showed up before. The audio
can only be approved by a person listening to it: ask the user.
"""
import glob, json, os, re, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
FONT = os.path.join(PKG, "public", "fonts", "GoogleSans-Medium.ttf")


def sheet(folder, out, cols=6, width=270):
    files = [f for f in sorted(glob.glob(os.path.join(folder, "*.png"))) if not os.path.basename(f).startswith("_")]
    if not files:
        raise SystemExit("no stills")
    ims = [Image.open(f).convert("RGB") for f in files]
    h = round(width * ims[0].height / ims[0].width)
    rows = (len(ims) + cols - 1) // cols
    font = ImageFont.truetype(FONT, 15)
    o = Image.new("RGB", (cols * (width + 12) + 12, rows * (h + 40) + 12), "#3a3a3a")
    d = ImageDraw.Draw(o)
    for i, (f, im) in enumerate(zip(files, ims)):
        x, y = 12 + (i % cols) * (width + 12), 12 + (i // cols) * (h + 40)
        o.paste(im.resize((width, h), Image.LANCZOS), (x, y))
        d.text((x, y + h + 6), os.path.basename(f)[:-4][:34], fill="#eeeeee", font=font)
    o.save(out)
    print(out)


def ff(tool, *a):
    """The ffmpeg/ffprobe that ship with Remotion's compositor (no system install needed)."""
    found = glob.glob(os.path.join(PKG, "..", "..", "node_modules", ".pnpm", "@remotion+compositor-*", "node_modules", "@remotion", "compositor-*", tool))
    if not found:
        raise SystemExit(f"{tool} not found: run pnpm install")
    d = os.path.dirname(found[0])
    env = {**os.environ, "DYLD_LIBRARY_PATH": d, "LD_LIBRARY_PATH": d}
    return subprocess.run([found[0], *a], capture_output=True, text=True, env=env)


def check(video, fmt=None):
    r = ff("ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate:format=duration,size", "-of", "json", video)
    info = json.loads(r.stdout or "{}")
    v = next((s for s in info.get("streams", []) if s["codec_type"] == "video"), {})
    a = any(s["codec_type"] == "audio" for s in info.get("streams", []))
    dur = float(info.get("format", {}).get("duration", 0))
    mb = int(info.get("format", {}).get("size", 0)) / 1e6
    print(f"{v.get('width')}×{v.get('height')} · {v.get('r_frame_rate')} fps · {dur:.1f} s · {mb:.1f} MB · audio: {'yes' if a else 'no'}")
    problems = []
    if fmt != "deck" and (v.get("width"), v.get("height")) != (1080, 1920):
        problems.append("not 1080×1920")
    limits = {"clip": (10, 40), "social": (15, 32), "study": (80, 160)}
    if fmt in limits and not (limits[fmt][0] <= dur <= limits[fmt][1]):
        problems.append(f"{dur:.0f} s is outside {limits[fmt]} for {fmt}")
    if a:
        l = ff("ffmpeg", "-hide_banner", "-nostats", "-i", video, "-af", "ebur128", "-f", "null", "-")
        m = re.findall(r"I:\s+(-?[\d.]+) LUFS", l.stderr)
        if m:
            lufs = float(m[-1])
            print(f"loudness {lufs:.1f} LUFS integrated (target -14)")
            if abs(lufs + 14) > 2:
                problems.append(f"loudness {lufs:.1f} LUFS, target -14")
        else:
            print("loudness: this ffmpeg has no ebur128; measure with a full ffmpeg")
    for p in problems:
        print("PROBLEM:", p)
    return not problems


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "sheet":
        sheet(sys.argv[2], sys.argv[3])
    elif len(sys.argv) >= 3 and sys.argv[1] == "check":
        fmt = sys.argv[sys.argv.index("--format") + 1] if "--format" in sys.argv else None
        sys.exit(0 if check(sys.argv[2], fmt) else 1)
    else:
        print(__doc__)
