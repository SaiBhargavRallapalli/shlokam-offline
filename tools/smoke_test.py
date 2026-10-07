#!/usr/bin/env python3
"""Smoke tests for shlokam-offline server. Fails loudly on any regression."""
import json, sys, urllib.request
BASE = "http://localhost:8080"
def get(p):
    req = urllib.request.Request(BASE+p, headers={"User-Agent":"test"})
    with urllib.request.urlopen(req, timeout=20) as r:
        ct = r.headers.get("Content-Type","")
        data = r.read()
        return r.status, ct, data

fails = []
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f" — {detail}" if detail and not cond else ""))
    if not cond: fails.append(name)

s,_,d = get("/api/health"); h=json.loads(d)
check("health ok", s==200 and h.get("ok"), str(h))
check("offline pages >500", h.get("offline_pages",0)>500, str(h))

s,_,d = get("/api/chapters"); ch=json.loads(d)
check("18 gita chapters", len(ch.get("chapters",[]))==18, str(len(ch.get("chapters",[]))))

s,_,d = get("/api/gita/chapter/2"); g=json.loads(d)
check("gita ch2 has 72 verses", len(g.get("verses",[]))==72, str(len(g.get("verses",[]))))

s,_,d = get("/api/texts"); t=json.loads(d)
check("texts >=30", len(t)>=30 if isinstance(t,list) else False, str(len(t) if isinstance(t,list) else type(t)))

s,_,d = get("/api/deities"); dd=json.loads(d)
check("deities >=30", len(dd)>=30, str(len(dd)))

s,_,d = get("/api/dictionary/search?q=karma"); dic=json.loads(d)
check("dictionary karma>0", dic.get("count",0)>0, str(dic.get("count")))

s,_,d = get("/api/search?q=shiva"); sr=json.loads(d)
check("search shiva>0", len(sr.get("results",[]))>0)

s,ct,d = get("/api/pdf/gita__chapter-2")
check("chapter pdf is pdf", s==200 and d[:5]==b"%PDF-", ct)

s,ct,d = get("/api/pdf-combined/gita")
check("combined pdf is pdf", s==200 and d[:5]==b"%PDF-", ct)

s,ct,d = get("/export/gita__chapter-2.html")
check("print html ok", s==200 and b"Print" in d)

s,_,d = get("/")
check("frontend serves", s==200 and b"Shlokam" in d)

# audio: verse resolution (302, no download) + byte-range chapter audio
import urllib.request as _u, urllib.error as _e
req = _u.Request(BASE+"/api/verse-audio?content_id=gita-2-47")
class _NoRedir(_u.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl): return None
try:
    _u.build_opener(_NoRedir).open(req, timeout=20)
    check("verse-audio 302", False, "expected redirect")
except _e.HTTPError as e:
    check("verse-audio 302", e.code in (301,302) and "/api/audio?token=" in (e.headers.get("Location") or ""), f"{e.code} {e.headers.get('Location')}")
req = _u.Request(BASE+"/api/audio/chapter/2", headers={"Range": "bytes=0-1023"})
with _u.urlopen(req, timeout=90) as r:
    check("chapter audio range", r.status==206 and r.headers.get_content_type()=="audio/mpeg", f"{r.status} {r.headers.get_content_type()}") if hasattr(r.headers, 'get_content_type') else check("chapter audio range", r.status==206, str(r.status))
s,_,d = get("/api/audio/status")
check("audio status", json.loads(d).get("files",0)>=1, d[:100])
req = _u.Request(BASE+"/api/audio?token=1Yru&download=1")
with _u.urlopen(req, timeout=60) as r:
    cd = r.headers.get("Content-Disposition") or ""
    check("audio download", r.status==200 and "attachment" in cd and r.headers.get_content_type()=="audio/mpeg", f"{r.status} {cd}")

print(f"\n{len(fails)} failures" if fails else "\nALL TESTS PASSED")
sys.exit(1 if fails else 0)
