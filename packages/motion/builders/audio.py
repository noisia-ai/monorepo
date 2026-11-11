#!/usr/bin/env python3
"""
audio.py: voices, music and timing for a Noisia video piece (rules in packages/pitch-kit/VIDEO.md §5.3).

    python3 builders/audio.py piece.json --budget     # characters to generate and what they cost; no API call
    python3 builders/audio.py piece.json --estimate   # timing without audio, for a silent draft; no API call
    python3 builders/audio.py piece.json              # ElevenLabs voices + music, then the real timing

Writes <piece>.timing.json next to the piece and the audio into <piece folder>/audio/<piece>_*.mp3.

- The key is the user's and costs money. It lives in the piece folder's .env (ELEVENLABS_API_KEY=...),
  ignored by git, and never goes through the chat or the repo. It is validated before generating.
- Voices: narrator eleven_multilingual_v2 with the settings below; quotes eleven_v3 with the market's
  language_code and the quote's emotion tag, which is filtered out of the timestamps.
- Cache by hash of the spec (text, voice, model, settings): re-running only regenerates what changed.
- Every time is measured from the real audio and written in frames. Nothing is fixed in the composition.
"""
import argparse, base64, hashlib, json, math, os, sys, urllib.error, urllib.request

FPS = 30
CHARS_PER_SECOND = 15.0          # narrator pace used by --estimate (~750 characters per finished minute)

NARRATOR_MODEL = "eleven_multilingual_v2"
NARRATOR_SETTINGS = {"stability": 0.42, "similarity_boost": 0.8, "style": 0.35, "use_speaker_boost": True}
QUOTE_MODEL = "eleven_v3"

# Timing rules of a study chapter (VIDEO.md §5.3), in frames.
VO_AT = 6                 # the voice enters on frame 6
QUOTE_AFTER_VO = 6        # the quote, 6 frames after the voice ends
SPARK_AFTER = 8           # spark_at, 8 frames after the quote (or the voice)
SPARK_VOICE_AFTER = 6     # the spark's voice at spark_at + 6
SCENE_TAIL = 20           # the scene closes 20 frames after the spark's voice
UNVOICED_QUOTE = lambda text: int(FPS * (2.2 + 0.045 * len(text)))   # reading time of a silent quote card
CHAT_STEP = 16            # one post every 16 frames in the climax chat

# Clip lengths of the social scenes without voice (the website's SCENE_FRAMES).
SCENE_FRAMES = {"hook": 84, "stat": 108, "compare": 138, "journey": 156, "split": 120, "tension": 126, "quote": 156, "takeaway": 108, "base": 120}
BASE_FRAMES = SCENE_FRAMES["base"]   # the base scene: mentions, channels, period (VIDEO.md §2)


def frames(seconds):
    return round(seconds * FPS)


class Voice:
    def __init__(self, piece_dir, estimate, prefix):
        self.dir = piece_dir
        # Files carry the piece's name: two pieces in one case folder can reuse scene ids
        # (social scenes are s1, s2...) and must never overwrite each other's audio.
        self.prefix = prefix
        self.estimate = estimate
        self.aud = os.path.join(piece_dir, "audio")
        self.man_p = os.path.join(self.aud, "manifest.json")
        self.man = json.load(open(self.man_p)) if os.path.exists(self.man_p) else {}
        self.key = None if estimate else read_key(piece_dir)

    def api(self, path, body):
        r = urllib.request.Request("https://api.elevenlabs.io" + path, data=json.dumps(body).encode(),
                                   headers={"xi-api-key": self.key, "Content-Type": "application/json"})
        try:
            return urllib.request.urlopen(r, timeout=600)
        except urllib.error.HTTPError as e:
            raise SystemExit(f"ElevenLabs {path}: {e.code} {e.read()[:300]!r}")

    def cached(self, name, spec, make):
        name = f"{self.prefix}_{name}"
        h = hashlib.sha1(json.dumps(spec, sort_keys=True).encode()).hexdigest()
        f = os.path.join(self.aud, name + ".mp3")
        if self.man.get(name, {}).get("hash") == h and os.path.exists(f):
            return self.man[name]["meta"]
        os.makedirs(self.aud, exist_ok=True)
        meta = make(f)
        self.man[name] = {"hash": h, "meta": meta}
        json.dump(self.man, open(self.man_p, "w"), indent=1)
        print("  generated", name)
        return meta

    def tts(self, name, text, voice, model, settings=None, lang=None):
        """Returns {'file', 'dur', 'words': [[word, start_s, end_s]]}."""
        if self.estimate:
            return estimate_words(text)
        spec = {"t": text, "v": voice, "m": model, "s": settings, "l": lang}

        def make(f):
            body = {"text": text, "model_id": model}
            if settings:
                body["voice_settings"] = settings
            if lang:
                body["language_code"] = lang
            d = json.load(self.api(f"/v1/text-to-speech/{voice}/with-timestamps?output_format=mp3_44100_128", body))
            open(f, "wb").write(base64.b64decode(d["audio_base64"]))
            al = d["alignment"]
            return {"dur": al["character_end_times_seconds"][-1], "words": split_words(al)}

        meta = self.cached(name, spec, make)
        return {**meta, "file": f"audio/{self.prefix}_{name}.mp3"}

    def music(self, prompt, seconds):
        if self.estimate or not prompt:
            return None
        ms = int(math.ceil((seconds + 2) / 5) * 5 * 1000)    # rounded up to 5 s so small edits reuse the track

        def make(f):
            open(f, "wb").write(self.api("/v1/music", {"prompt": prompt, "music_length_ms": ms, "force_instrumental": True}).read())
            return {"dur": ms / 1000}

        self.cached("music", {"p": prompt, "ms": ms}, make)
        return f"audio/{self.prefix}_music.mp3"


def read_key(piece_dir):
    key = os.environ.get("ELEVENLABS_API_KEY", "")
    env = os.path.join(piece_dir, ".env")
    if not key and os.path.exists(env):
        for line in open(env, encoding="utf-8"):
            if line.startswith("ELEVENLABS_API_KEY="):
                key = line.split("=", 1)[1]
    key = key.strip().strip("\"'").strip()       # a key pasted with quotes gave a 401
    if not key:
        raise SystemExit(f"No ElevenLabs key. Put ELEVENLABS_API_KEY=... in {env} (ignored by git), never in the chat.")
    r = urllib.request.Request("https://api.elevenlabs.io/v1/user/subscription", headers={"xi-api-key": key})
    try:
        sub = json.load(urllib.request.urlopen(r, timeout=30))
    except urllib.error.HTTPError as e:
        raise SystemExit(f"The ElevenLabs key did not validate ({e.code}). Check the .env.")
    left = sub.get("character_limit", 0) - sub.get("character_count", 0)
    print(f"ElevenLabs key ok · {left:,} characters left this period")
    return key


def split_words(al):
    out, cur, s, e = [], "", None, None
    for ch, a, b in zip(al["characters"], al["character_start_times_seconds"], al["character_end_times_seconds"]):
        if ch.isspace():
            if cur:
                out.append([cur, s, e])
                cur = ""
            continue
        if not cur:
            s = a
        cur += ch
        e = b
    if cur:
        out.append([cur, s, e])
    return [w for w in out if not (w[0].startswith("[") and w[0].endswith("]"))]   # drop v3 audio tags


def estimate_words(text):
    t, out = 0.0, []
    for w in text.split():
        d = (len(w) + 1) / CHARS_PER_SECOND + (0.25 if w[-1] in ".?!:" else 0.08 if w[-1] == "," else 0)
        out.append([w, t, t + (len(w) + 1) / CHARS_PER_SECOND])
        t += d
    return {"file": None, "dur": t, "words": out}


def clip(kind, meta, at):
    return {"kind": kind, "file": meta.get("file"), "at": at, "len": frames(meta["dur"]) + 2,
            "words": [[w, frames(a), frames(b)] for w, a, b in meta["words"]]}


def quote_say(q):
    return (f"{q['emotion']} " if q.get("emotion") else "") + q["text"]


def time_piece(piece, v):
    voices = piece.get("voices") or {}
    narrator = voices.get("narrator", "")
    qvoices = voices.get("quotes", {})
    qlang = voices.get("quoteLanguage")
    vo = lambda name, text: v.tts(name, text, narrator, NARRATOR_MODEL, NARRATOR_SETTINGS)
    def qv(name, q):
        voice = qvoices.get(name) or qvoices.get("default") or narrator
        return v.tts(f"q_{name}", quote_say(q), voice, QUOTE_MODEL, None, qlang)

    scenes, t = [], 0
    for i, sc in enumerate(piece["scenes"]):
        sid = sc.get("id") or f"s{i + 1}"
        clips, marks, cur = [], {}, 0
        typ = sc["type"]
        if piece["format"] == "social":
            base = SCENE_FRAMES.get(typ, 110)
            if sc.get("vo"):
                c = clip("vo", vo(f"{sid}_vo", sc["vo"]), VO_AT)
                clips.append(c)
                cur = max(base, c["at"] + c["len"] + 24)
            else:
                cur = base
        elif typ == "cold":
            q = sc["quote"]
            if q.get("voiced"):
                c = clip("quote", qv(sid, q), 20)
                clips.append(c)
                cur = c["at"] + c["len"] + 16
            else:
                cur = 20 + UNVOICED_QUOTE(q["text"])
            marks["words_at"] = cur
            cur += 40                                        # the vocabulary storms in
            c = clip("vo", vo(f"{sid}_vo", sc["vo"]), cur)
            clips.append(c)
            cur = c["at"] + c["len"] + 36
        elif typ == "base":
            cur = BASE_FRAMES
            if sc.get("vo"):
                c = clip("vo", vo(f"{sid}_vo", sc["vo"]), VO_AT)
                clips.append(c)
                cur = max(BASE_FRAMES, c["at"] + c["len"] + 30)
        elif typ == "close":
            c = clip("vo", vo(f"{sid}_vo", sc["vo"]), 8)
            clips.append(c)
            marks["logo_at"] = c["at"] + c["len"] + 24
            cur = marks["logo_at"] + 100
        else:                                                # chapter, climax
            c = clip("vo", vo(f"{sid}_vo", sc["vo"]), VO_AT)
            clips.append(c)
            cur = c["at"] + c["len"]
            marks["chart_at"] = 20
            if typ == "climax":
                marks["zero_at"] = cur + 4
                if sc.get("vo2"):
                    c = clip("vo", vo(f"{sid}_vo2", sc["vo2"]), cur + 26)
                    clips.append(c)
                    cur = c["at"] + c["len"]
                else:
                    cur += 40
                marks["chat_at"] = cur + 12
                cur = marks["chat_at"] + (len(sc["chat"]) + 1) * CHAT_STEP + 20
            q = sc.get("quote")
            if q:
                marks["quote_at"] = cur + QUOTE_AFTER_VO
                if q.get("voiced"):
                    c = clip("quote", qv(sid, q), marks["quote_at"])
                    clips.append(c)
                    cur = c["at"] + c["len"]
                else:
                    cur = marks["quote_at"] + UNVOICED_QUOTE(q["text"])
            marks["spark_at"] = cur + SPARK_AFTER
            say = sc["spark"].get("say") or sc["spark"]["line"]
            c = clip("spark", vo(f"{sid}_spark", say), marks["spark_at"] + SPARK_VOICE_AFTER)
            clips.append(c)
            cur = c["at"] + c["len"] + SCENE_TAIL
        scenes.append({"id": sid, "from": t, "len": cur, "marks": marks, "clips": clips})
        t += cur
    return scenes, t


def budget(piece):
    texts = []
    for sc in piece["scenes"]:
        for k in ("vo", "vo2"):
            if sc.get(k):
                texts.append(sc[k])
        if sc.get("quote", {}).get("voiced"):
            texts.append(sc["quote"]["text"])
        if sc.get("spark"):
            texts.append(sc["spark"].get("say") or sc["spark"]["line"])
    n = sum(len(x) for x in texts)
    print(f"{len(texts)} voice clips · {n:,} characters per full pass")
    print(f"Plan for ~3 passes while the script settles: ~{3 * n:,} characters (only changed clips are regenerated).")
    if piece.get("music"):
        print("Music: one /v1/music track, billed apart. Confirm its commercial licence on the plan before publishing.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("piece")
    ap.add_argument("--estimate", action="store_true", help="timing without audio, no API call")
    ap.add_argument("--budget", action="store_true", help="characters to generate, no API call")
    a = ap.parse_args()
    path = os.path.abspath(a.piece)
    piece = json.load(open(path, encoding="utf-8"))
    if piece.get("format") not in ("social", "study"):
        raise SystemExit("audio.py is for social and study pieces")
    if a.budget:
        budget(piece)
        return
    narrator = (piece.get("voices") or {}).get("narrator", "")
    if not a.estimate and (not narrator or narrator.endswith("_VOICE_ID")):
        raise SystemExit("Set voices.narrator (an ElevenLabs voice id) in the piece before generating.")
    v = Voice(os.path.dirname(path), a.estimate, os.path.splitext(os.path.basename(path))[0])
    scenes, total = time_piece(piece, v)
    music = v.music(piece.get("music"), total / FPS)
    out = os.path.splitext(path)[0] + ".timing.json"
    json.dump({"fps": FPS, "total": total, "estimated": a.estimate, "scenes": scenes, "music": music, "sfx": {}},
              open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{len(scenes)} scenes · {total / FPS:.1f} s{' (estimated, no audio)' if a.estimate else ''} → {out}")
    for sc in scenes:
        print(f"  {sc['id']:10s} {sc['len'] / FPS:5.1f} s  {sc['marks']}")


if __name__ == "__main__":
    main()
