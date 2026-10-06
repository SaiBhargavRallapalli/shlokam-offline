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

print(f"\n{len(fails)} failures" if fails else "\nALL TESTS PASSED")
sys.exit(1 if fails else 0)
