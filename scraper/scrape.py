#!/usr/bin/env python3
"""
Shlokam.org end-to-end scraper
- Reads sitemap.xml (2075 URLs) for full coverage:
  Site, Bhagavad Gita, Texts, Bhagavatam, Browse by deity, Browse by type
- Fetches live JSON API (https://app.shlokam.org) for structured data where available
- Fetches static HTML pages and parses verses into structured JSON
- Saves everything under ../data/ for offline use
- Builds dictionary index from word_meanings
- Resumable, rate-limited, production-safe

Usage:
  pip install -r requirements.txt
  python scrape.py --quick        # small sample (~20 pages, fast, for testing)
  python scrape.py --full         # everything (~2075 pages, ~30-60 min)
  python scrape.py --only gita,texts,deities  # subset
  python scrape.py --full --delay 0.3 --workers 4

Output:
  ../data/meta.json
  ../data/texts.json, deities.json, topics.json, chapters.json, keywords.json,
          browse_footer.html, sitemap_urls.json
  ../data/pages/<slug>.json   (one per scraped page)
  ../data/dictionary.json     (sanskrit -> english index)
  ../data/bhagavatam_index.json, shloka_index.json, gita_index.json, text_index.json
"""
import argparse, json, os, re, sys, time, html as ihtml
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import quote, urlparse
import requests
from bs4 import BeautifulSoup

BASE = "https://shlokam.org"
API = "https://app.shlokam.org"
DATA = os.path.join(os.path.dirname(__file__), "..", "data")
PAGES = os.path.join(DATA, "pages")
UA = {"User-Agent": "ShlokamOfflineClone/1.0 (educational offline mirror; contact: local use)", "Accept": "*/*"}
session = requests.Session()
session.headers.update(UA)

def get_json(path, timeout=30):
    r = session.get(API + path, headers={"Accept": "application/json", **UA}, timeout=timeout)
    r.raise_for_status()
    return r.json()

def get_raw(url, timeout=30):
    r = session.get(url, timeout=timeout)
    r.raise_for_status()
    return r.text

def save(name, obj):
    p = os.path.join(DATA, name)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    print(f"saved {p} ({os.path.getsize(p)} bytes)")
    return p

def slug_from_url(url):
    path = urlparse(url).path  # /gita/gita-1-1.htm
    base = os.path.basename(path)  # gita-1-1.htm
    slug = re.sub(r"\.htm[l]?$", "", base)
    prefix = urlparse(url).path.split("/")[1] if "/" in urlparse(url).path else "root"
    if url.rstrip("/") == BASE or url.rstrip("/") == BASE + "/":
        return "root__home"
    return f"{prefix}__{slug}"

def _field_text(node, field):
    """Extract detail-section[data-field=...] .detail-text html, stripping settings buttons."""
    sec = node.select_one(f'.detail-section[data-field="{field}"]')
    if not sec:
        return None
    # remove settings buttons/labels
    for b in sec.select("button"):
        b.decompose()
    txt_el = sec.select_one(".detail-text") or sec
    # preserve <br> and <b> for word-meanings: return inner HTML
    html_val = txt_el.decode_contents().strip() if txt_el else None
    if html_val and len(re.sub(r"<[^>]+>", "", html_val).strip()) == 0:
        return None
    return html_val

def parse_verse_html(html_text, url):
    """Parse static HTML page into structured verses. Works for gita/text/shloka/bhagavatam chapter pages."""
    soup = BeautifulSoup(html_text, "lxml")
    title = soup.title.string.strip() if soup.title and soup.title.string else url
    desc = ""
    m = soup.find("meta", attrs={"name": "description"})
    if m and m.get("content"):
        desc = m["content"]
    verses = []
    # Strategy 1: elements with data-content-id (single-work pages e.g. some shloka/text)
    nodes = soup.select("[data-content-id]")
    seen = set()
    for n in nodes:
        cid = n.get("data-content-id", "").strip()
        if not cid or cid in seen:
            continue
        seen.add(cid)
        def txt(sel):
            el = n.select_one(sel)
            if el:
                # preserve <br> as newline
                for br in el.find_all("br"):
                    br.replace_with("\n")
                return el.get_text("\n").strip()
            return None
        def html_sel(sel):
            el = n.select_one(sel)
            return str(el.decode_contents()).strip() if el else None
        # Common class names in shlokam.css pages
        v = {
            "content_id": cid,
            "chapter": n.get("data-chapter") or None,
            "section": n.get("data-section") or None,
            "verse": n.get("data-verse") or None,
            "sanskrit": html_sel(".sanskrit, .devanagari, .verse-sanskrit") or txt(".sanskrit, .devanagari, .verse-sanskrit"),
            "roman": html_sel(".roman, .transliteration, .verse-roman") or txt(".roman, .transliteration, .verse-roman"),
            "colloquial": html_sel(".colloquial, .english-translit") or None,
            "translation": html_sel(".translation, .verse-translation") or txt(".translation, .verse-translation"),
            "word_meaning": html_sel(".word-meaning, .word_meaning, .verse-word-meaning") or txt(".word-meaning, .word_meaning, .verse-word-meaning"),
            "verse_notes": html_sel(".verse-notes, .notes") or None,
            "description": html_sel(".description, .verse-description") or None,
        }
        # also try detail-section[data-field] inside (new layout)
        if not any([v["sanskrit"], v["roman"], v["translation"]]):
            for f in ["sanskrit", "roman", "colloquial", "translation", "word_meaning", "verse_notes", "description"]:
                val = _field_text(n, f)
                if val:
                    v[f if f != "word_meaning" else "word_meaning"] = val
        # Fallback: grab all text inside node if specific selectors failed
        if not any([v["sanskrit"], v["roman"], v["translation"]]):
            for br in n.find_all("br"):
                br.replace_with("\n")
            full = n.get_text("\n").strip()
            if len(full) > 20:
                v["translation"] = full[:4000]
            else:
                continue
        verses.append(v)
    # Strategy 1b: chapter pages use .verse-item / .verse-section.verse-item with detail-section[data-field]
    if not verses:
        items = soup.select(".verse-item, .verse-section.verse-item")
        for n in items:
            # citation link often holds verse ref
            cit = n.select_one(".verse-citation")
            ref = cit.get_text().strip() if cit else ""
            field = lambda f: _field_text(n, f)
            sanskrit = field("sanskrit")
            roman = field("roman")
            colloquial = field("colloquial")
            translation = field("translation")
            word_meaning = field("word_meaning")
            verse_notes = field("verse_notes")
            if not any([sanskrit, roman, translation]):
                continue
            cid = n.get("id") or (cit.get("href", "").strip("/") if cit and cit.get("href") else ref)
            verses.append({
                "content_id": cid or f"{slug_from_url(url)}-{ref or len(verses)}",
                "chapter": n.get("data-chapter") or (cit.get("data-chapter") if cit else None),
                "section": n.get("data-section") or None,
                "verse": n.get("data-verse") or (cit.get("data-verse") if cit else None) or ref,
                "sanskrit": sanskrit, "roman": roman, "colloquial": colloquial,
                "translation": translation, "word_meaning": word_meaning,
                "verse_notes": verse_notes, "description": None,
            })
    # Strategy 2: if still none, look for verse cards / paragraphs
    if not verses:
        # Bhagavatam chapter pages: .verse-card, .bhag-verse, article
        candidates = soup.select(".verse-card, .verse, article.verse, .bhag-verse, .shloka-verse")
        for i, n in enumerate(candidates):
            for br in n.find_all("br"):
                br.replace_with("\n")
            verses.append({
                "content_id": f"{slug_from_url(url)}-v{i}",
                "chapter": None, "section": None, "verse": str(i),
                "sanskrit": None, "roman": None, "colloquial": None,
                "translation": n.get_text("\n").strip()[:6000],
                "word_meaning": None, "verse_notes": None, "description": None,
            })
    # Strategy 3: raw fallback — store cleaned body text (still useful offline)
    body_text = None
    if not verses:
        main = soup.select_one("#explore-content, .page-content, main, body")
        if main:
            for s in main(["script", "style", "nav", "select", "form"]):
                s.decompose()
            body_text = main.get_text("\n").strip()
            body_text = re.sub(r"\n{3,}", "\n\n", body_text)[:20000]
    return {"url": url, "slug": slug_from_url(url), "title": title, "description": desc, "verses": verses, "body_text": body_text, "verse_count": len(verses)}

def fetch_api_meta():
    meta = {}
    jobs = {
        "texts": "/api/unified/explore/texts",
        "deities": "/api/unified/explore/deities",
        "topics": "/api/unified/explore/topics",
        "chapters": "/api/unified/chapters/list",
        "keywords": "/api/keywords/list",
    }
    for k, p in jobs.items():
        try:
            meta[k] = get_json(p)
            print(f"meta {k}: OK ({len(str(meta[k]))} chars)")
            time.sleep(0.2)
        except Exception as e:
            print(f"meta {k}: FAIL {e}")
            meta[k] = None
    try:
        r = session.get(API + "/api/site/browse-footer", headers={"Accept": "text/html", **UA}, timeout=20)
        meta["browse_footer"] = r.text if r.ok else None
    except Exception as e:
        print(f"browse_footer FAIL {e}")
        meta["browse_footer"] = None
    return meta

def fetch_sitemap_urls():
    xml = get_raw(BASE + "/sitemap.xml")
    urls = re.findall(r"<loc>(.*?)</loc>", xml)
    return urls

def scrape_page(url, delay=0.4):
    slug = slug_from_url(url)
    out = os.path.join(PAGES, slug + ".json")
    if os.path.exists(out):
        try:
            with open(out, encoding="utf-8") as f:
                d = json.load(f)
            if d.get("verses") or d.get("body_text"):
                return ("skip", url)
        except Exception:
            pass
    try:
        html_text = get_raw(url)
        parsed = parse_verse_html(html_text, url)
        # Also try API explain for single-verse pages (gita/shloka) to get richer JSON
        # Derive candidate content_ids from parsed verses
        api_enriched = False
        if len(parsed["verses"]) <= 3 and parsed["verses"]:
            cid = parsed["verses"][0].get("content_id")
            if cid:
                try:
                    j = get_json("/api/unified/explain?q=" + quote(cid))
                    parsed["api"] = j
                    api_enriched = True
                    time.sleep(0.2)
                except Exception:
                    pass
        with open(out, "w", encoding="utf-8") as f:
            json.dump(parsed, f, ensure_ascii=False, indent=1)
        time.sleep(delay)
        return ("ok" + ("+api" if api_enriched else ""), url)
    except Exception as e:
        return (f"fail:{e}", url)

WORD_SPLIT = re.compile(r"<b>(.*?)</b>\s*[–\-—:]\s*([^<;]+)", re.I)

def build_dictionary():
    """Build sanskrit->english dict from all scraped word_meaning fields + keywords."""
    entries = {}  # key: sanskrit (devanagari or iast) -> {sanskrit, iast, english, sources[]}
    def add(sa, en, src):
        if not sa or not en:
            return
        sa = sa.strip().strip("() ")[:120]
        en = ihtml.unescape(re.sub(r"<[^>]+>", "", en)).strip()[:300]
        if len(sa) < 1 or len(en) < 1:
            return
        key = sa.lower()
        if key not in entries:
            entries[key] = {"sanskrit": sa, "english": en, "sources": [src]}
        else:
            if src not in entries[key]["sources"]:
                entries[key]["sources"].append(src)
            if len(en) > len(entries[key]["english"]):
                entries[key]["english"] = en
    for fn in os.listdir(PAGES):
        if not fn.endswith(".json"):
            continue
        try:
            with open(os.path.join(PAGES, fn), encoding="utf-8") as f:
                d = json.load(f)
        except Exception:
            continue
        src = d.get("slug", fn)
        for v in d.get("verses", []) or []:
            wm = v.get("word_meaning") or ""
            if not wm:
                # also check api payload
                api = d.get("api") or {}
                for vv in (api.get("verses") or []):
                    wm2 = vv.get("word_meaning") or ""
                    for m in WORD_SPLIT.finditer(wm2):
                        add(m.group(1), m.group(2), src)
                continue
            for m in WORD_SPLIT.finditer(wm):
                add(m.group(1), m.group(2), src)
        api = d.get("api") or {}
        for vv in (api.get("verses") or []) if isinstance(api, dict) else []:
            for m in WORD_SPLIT.finditer(vv.get("word_meaning") or ""):
                add(m.group(1), m.group(2), src)
    # keywords list as extra entries
    try:
        with open(os.path.join(DATA, "keywords.json"), encoding="utf-8") as f:
            kw = json.load(f)
        items = kw.get("items") if isinstance(kw, dict) else kw
        if isinstance(items, list):
            for it in items:
                # "Abhaya (अभय)"
                m = re.match(r"(.+?)\s*\((.+)\)", str(it))
                if m:
                    add(m.group(2).strip(), m.group(1).strip(), "keywords")
                    add(m.group(1).strip(), m.group(2).strip(), "keywords")
    except Exception as e:
        print("keywords dict skipped:", e)
    arr = sorted(entries.values(), key=lambda x: x["sanskrit"].lower())[:50000]
    save("dictionary.json", {"count": len(arr), "entries": arr})
    print(f"dictionary built: {len(arr)} entries")
    return arr

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true", help="scrape ~25 sample pages")
    ap.add_argument("--full", action="store_true", help="scrape all sitemap URLs")
    ap.add_argument("--only", default="", help="comma list: gita,texts,shloka,bhagavatam,site,deity,type,dictionary")
    ap.add_argument("--delay", type=float, default=0.4)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    os.makedirs(PAGES, exist_ok=True)
    print("fetching meta + sitemap...")
    meta = fetch_api_meta()
    for k in ["texts", "deities", "topics", "chapters", "keywords"]:
        if meta.get(k) is not None:
            save(f"{k}.json", meta[k])
    if meta.get("browse_footer"):
        with open(os.path.join(DATA, "browse_footer.html"), "w", encoding="utf-8") as f:
            f.write(meta["browse_footer"])
    urls = fetch_sitemap_urls()
    save("sitemap_urls.json", urls)
    print(f"sitemap: {len(urls)} urls")
    only = set([x.strip() for x in args.only.split(",") if x.strip()]) if args.only else set()
    def keep(u):
        if not only:
            return True
        p = urlparse(u).path
        for o in only:
            if o in p or o in u or (o == "texts" and "/text/" in p) or (o == "site" and p in ["/", "/sanskrit-dictionary.htm"]):
                return True
        return False
    urls = [u for u in urls if keep(u)]
    print(f"after --only filter: {len(urls)} urls")
    if args.quick and not args.full:
        # representative sample across all 6 required sections
        wanted = [
            "/gita/chapter-2.htm", "/gita/gita-2-47.htm", "/gita/gita-1-1.htm",
            "/text/anma-viddai.htm", "/shloka/aadya-kalika-ashtottara-sata-namavali.htm",
            "/shloka/om-namah-shivaya.htm" if False else None,
            "/bhagavatam/canto-1-chapter-1.htm", "/bhagavatam/canto-1-chapter-1-nav.htm",
            "/sanskrit-dictionary.htm",
        ]
        # resolve to real sitemap urls (fuzzy)
        picked = []
        for w in wanted:
            if not w:
                continue
            for u in urls:
                if u.endswith(w):
                    picked.append(u)
                    break
        # + first of each category
        for u in urls:
            if len(picked) >= 25:
                break
            if u not in picked:
                picked.append(u)
        urls = picked[:25]
        print(f"quick sample: {len(urls)} urls")
    if args.limit:
        urls = urls[:args.limit]
    print(f"scraping {len(urls)} pages with {args.workers} workers...")
    from tqdm import tqdm
    results = {"ok": 0, "skip": 0, "fail": 0}
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(scrape_page, u, args.delay): u for u in urls}
        for fut in tqdm(as_completed(futs), total=len(futs)):
            status, u = fut.result()
            if status.startswith("ok"):
                results["ok"] += 1
            elif status.startswith("skip"):
                results["skip"] += 1
            else:
                results["fail"] += 1
                print(f"  FAIL {u}: {status[:200]}")
    print("done:", results)
    # build indexes
    index = {}
    for fn in os.listdir(PAGES):
        if not fn.endswith(".json"):
            continue
        with open(os.path.join(PAGES, fn), encoding="utf-8") as f:
            try:
                d = json.load(f)
            except Exception:
                continue
        index[d.get("slug", fn)] = {"url": d.get("url"), "title": d.get("title"), "verses": d.get("verse_count", 0)}
    save("page_index.json", index)
    build_dictionary()
    save("meta.json", {"scraped_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "results": results, "total_pages": len(index)})

if __name__ == "__main__":
    main()
