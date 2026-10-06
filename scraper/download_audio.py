#!/usr/bin/env python3
"""
Download recitation audio for offline use.
- Gita chapter recitations: 18 files (~250 MB) — continuous chanting, best for pronunciation.
- Gita verse recitations: 701 files (~150 MB) — per-verse playback + queues.
- Any chapter: --chapter 1-1 (Bhagavatam canto-chapter) or --chapter 2 (Gita chapter).

Files go to ../data/audio/ (gitignored). The server auto-caches on first listen,
so this script is only needed to pre-fill offline devices.

Usage:
  python download_audio.py --gita-chapters
  python download_audio.py --gita-chapters --gita-verses
  python download_audio.py --chapter 1-1 --chapter 4-16
"""
import argparse, json, os, sys, time
import requests

BASE = "https://shlokam.org"
API = "https://app.shlokam.org"
AUDIO = os.path.join(os.path.dirname(__file__), "..", "data", "audio")
UA = {"User-Agent": "ShlokamLibrary/1.0 (offline cache prefill)"}

def dl(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 1024:
        return "skip"
    r = requests.get(url, headers=UA, timeout=90)
    r.raise_for_status()
    data = r.content
    if len(data) < 1024 or not (data[:3] == b"ID3" or (data[0] == 0xFF and (data[1] & 0xE0) == 0xE0)):
        raise ValueError("not mp3: " + url)
    with open(dest, "wb") as f:
        f.write(data)
    return f"ok {len(data)//1024}KB"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gita-chapters", action="store_true")
    ap.add_argument("--gita-verses", action="store_true")
    ap.add_argument("--chapter", action="append", default=[])
    ap.add_argument("--delay", type=float, default=0.3)
    args = ap.parse_args()
    os.makedirs(AUDIO, exist_ok=True)
    jobs = []
    if args.gita_chapters:
        jobs += [(f"{BASE}/api/audio/chapter/{n}", f"chapter-{n}.mp3") for n in range(1, 19)]
    for spec in args.chapter:
        jobs.append((f"{BASE}/api/audio/chapter/{spec}", f"chapter-{spec}.mp3"))
    if args.gita_verses:
        ch = requests.get(API + "/api/unified/chapters/list", headers={**UA, "Accept": "application/json"}, timeout=30).json()
        toks = {}
        for c in ch.get("chapters", []):
            n = c["number"]
            for v in range(1, c["verse_count"] + 1):
                cid = f"gita-{n}-{v}"
                try:
                    j = requests.get(API + "/api/unified/explain?q=" + cid, headers={**UA, "Accept": "application/json"}, timeout=30).json()
                    if j.get("has_audio") and j.get("url_token"):
                        toks[cid] = j["url_token"]
                    time.sleep(args.delay)
                except Exception as e:
                    print(f"  token {cid} FAIL {e}")
        with open(os.path.join(AUDIO, "tokens.json"), "w") as f:
            json.dump(toks, f)
        print(f"resolved {len(toks)} verse tokens")
        for cid, tok in toks.items():
            jobs.append((f"{BASE}/api/audio?token={tok}", f"t-{tok}.mp3"))
    if not jobs:
        ap.error("nothing to do: pass --gita-chapters, --gita-verses and/or --chapter SPEC")
    ok = skip = fail = 0
    for i, (url, fn) in enumerate(jobs):
        try:
            st = dl(url, os.path.join(AUDIO, fn))
            if st == "skip":
                skip += 1
            else:
                ok += 1
                print(f"[{i+1}/{len(jobs)}] {fn}: {st}")
            time.sleep(args.delay)
        except Exception as e:
            fail += 1
            print(f"[{i+1}/{len(jobs)}] {fn}: FAIL {e}")
    print(f"done: ok={ok} skip={skip} fail={fail}")

if __name__ == "__main__":
    main()
