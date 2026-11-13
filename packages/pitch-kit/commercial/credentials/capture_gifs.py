#!/usr/bin/env python3
"""
capture_gifs.py: every animation of a credentials deck as a GIF for its PPTX (COMMERCIAL.md §9 recipe).

    python3 capture_gifs.py <deck dir built by build.py> [spec.json]

Serves the deck on a free local port, drives headless Chrome over CDP, moves each animated SVG into a
bare overlay and renders it frame by frame with the deck's own ANIMS[k].render(ST[k], t). The GIF has a
fixed 64-colour palette (the exact background and white kept), no dithering and exact numpy mapping,
then gifsicle -O3 --lossy=30. The timeline is rotated so frame 0 is the finished diagram, which is what
Slides' PDF and any still show. Sizes and backgrounds are read from the DOM, not typed.

Writes <deck>/gifs/a<slide number>.gif and a<n>_final.png. The comparison (where-we-stand) is skipped:
the PPTX draws it natively from the kit's copy.
Needs Chrome, numpy, Pillow, websocket-client and gifsicle (brew install gifsicle).
"""
import base64, functools, http.server, io, json, os, shutil, socket, subprocess, sys, threading, time, urllib.request
import numpy as np
import websocket
from PIL import Image

CHROME = os.environ.get("CHROME_PATH", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
FPS = 15
HOLD_END = 2.0          # seconds on the finished diagram before the loop restarts
SKIP = {"where-we-stand"}


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def main():
    deck = os.path.abspath(sys.argv[1])
    out = os.path.join(deck, "gifs")
    os.makedirs(out, exist_ok=True)
    http_port, cdp_port = free_port(), free_port()
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    handler = functools.partial(Quiet, directory=deck)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", http_port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    prof = os.path.join(out, ".chrome")
    proc = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={cdp_port}", f"--user-data-dir={prof}",
                             "--hide-scrollbars", "--no-first-run", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    page = None
    for _ in range(50):
        try:
            page = [t for t in json.load(urllib.request.urlopen(f"http://127.0.0.1:{cdp_port}/json")) if t["type"] == "page"][0]
            break
        except Exception:
            time.sleep(0.2)
    ws = websocket.create_connection(page["webSocketDebuggerUrl"], max_size=None)
    state = {"id": 0}

    def cdp(method, **params):
        state["id"] += 1
        ws.send(json.dumps({"id": state["id"], "method": method, "params": params}))
        while True:
            m = json.loads(ws.recv())
            if m.get("id") == state["id"]:
                if "error" in m:
                    raise RuntimeError(m["error"])
                return m.get("result", {})

    def js(expr):
        r = cdp("Runtime.evaluate", expression=expr, awaitPromise=True, returnByValue=True)
        if "exceptionDetails" in r:
            raise RuntimeError(r["exceptionDetails"])
        return r["result"].get("value")

    try:
        cdp("Emulation.setDeviceMetricsOverride", width=1920, height=1080, deviceScaleFactor=1, mobile=False)
        cdp("Page.enable")
        cdp("Page.navigate", url=f"http://127.0.0.1:{http_port}/index.html")
        for _ in range(100):
            time.sleep(0.2)
            try:
                if js("typeof built!=='undefined' && built===true"):
                    break
            except Exception:
                pass
        time.sleep(0.5)
        js("cancelAnimationFrame(raf); play=()=>{};")
        targets = js("""Object.keys(ANIMS).map(k=>{const s=document.querySelectorAll('deck-stage > section')[k];
            const svg=s.querySelector('svg[data-anim]');let bg=getComputedStyle(svg.parentElement).backgroundColor;
            if(bg==='rgba(0, 0, 0, 0)')bg='rgb(255, 255, 255)';
            return {k:+k,name:svg.dataset.anim,w:+svg.getAttribute('width'),h:+svg.getAttribute('height'),bg}})""")
        js("""(()=>{const o=document.createElement('div');o.id='cap';
          o.style.cssText='position:fixed;left:0;top:0;z-index:2147483647;';document.body.appendChild(o);})()""")
        for tg in targets:
            k, w, h = tg["k"], tg["w"], tg["h"]
            if tg["name"] in SKIP:
                continue
            bgc = np.array([int(v) for v in tg["bg"][tg["bg"].index("(") + 1:-1].split(",")[:3]], dtype=np.int32)
            js(f"""(()=>{{const o=document.getElementById('cap');o.innerHTML='';
              o.style.background='{tg["bg"]}';o.style.width='{w}px';o.style.height='{h}px';
              const svg=document.querySelectorAll('deck-stage > section')[{k}].querySelector('svg[data-anim]');
              svg.style.position='absolute';svg.style.left='0';svg.style.top='0';o.appendChild(svg);}})()""")
            dur = js(f"ANIMS[{k}].dur")
            n = int(round(dur * FPS))
            frames = []
            for i in range(n + 1):
                js(f"ANIMS[{k}].render(ST[{k}],{dur * i / n})")
                r = cdp("Page.captureScreenshot", format="png", clip={"x": 0, "y": 0, "width": w, "height": h, "scale": 1})
                frames.append(Image.open(io.BytesIO(base64.b64decode(r["data"]))).convert("RGB"))
            final = frames[-1]
            seq = [final] * int(HOLD_END * FPS) + frames      # rotated: starts on the finished diagram
            final.save(os.path.join(out, f"a{k + 1}_final.png"))
            sample = Image.new("RGB", (w, h * 4))
            for i, f in enumerate([final, frames[len(frames) // 4], frames[len(frames) // 2], frames[3 * len(frames) // 4]]):
                sample.paste(f, (0, h * i))
            pal = np.array(sample.quantize(colors=62, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
                           .getpalette()[:62 * 3], dtype=np.int32).reshape(-1, 3)
            pal = np.vstack([bgc, np.array([255, 255, 255]), pal])[:64]
            flat = pal.astype(np.uint8).flatten().tolist() + [0] * (768 - pal.size)
            idx = []
            for f in seq:
                a = np.asarray(f, dtype=np.int32).reshape(-1, 3)
                key = (a[:, 0] << 16) | (a[:, 1] << 8) | a[:, 2]
                u, inv = np.unique(key, return_inverse=True)
                uc = np.stack([(u >> 16) & 255, (u >> 8) & 255, u & 255], 1)
                m = ((uc[:, None, :] - pal[None, :, :]) ** 2).sum(2).argmin(1).astype(np.uint8)[inv].reshape(h, w)
                im = Image.frombytes("P", (w, h), m.tobytes())
                im.putpalette(flat)
                idx.append(im)
            raw = os.path.join(out, f"a{k + 1}_raw.gif")
            idx[0].save(raw, save_all=True, append_images=idx[1:], duration=int(1000 / FPS), loop=0, optimize=False, disposal=1)
            gif = os.path.join(out, f"a{k + 1}.gif")
            if shutil.which("gifsicle"):
                subprocess.run(["gifsicle", "-O3", "--lossy=30", raw, "-o", gif], check=True)
                os.remove(raw)
            else:
                os.replace(raw, gif)
                print("  (no gifsicle: GIF not optimized; brew install gifsicle)")
            print(f"slide {k + 1} · {tg['name']}: {len(seq)} frames, {os.path.getsize(gif) / 1e6:.2f} MB")
    finally:
        ws.close()
        proc.terminate()
        srv.shutdown()
        shutil.rmtree(prof, ignore_errors=True)


if __name__ == "__main__":
    main()
