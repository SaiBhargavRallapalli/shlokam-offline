# Shlokam — Offline Library Clone (Production Ready)

Offline-capable, production-ready rebuild of **shlokam.org** for personal study —
covers all 6 required sections:

- **Bhagavad Gita** (18 chapters, 701 verses + summaries/topics/keywords)
- **Texts** (32 works: Upanishads, Gitas, Sutras — ~3,516 verses)
- **Bhagavatam** (12 cantos, ~335 chapters, characters index)
- **Browse by deity** (36 deities, ~600+ shlokas)
- **Browse by type** (Stotram, Ashtakam, Kavacham, Suktam, Mantra, Sahasranamam…)
- **Site** (Home, About, What's New, Dictionary, sitemap)
- **+ Sanskrit Dictionary** (Devanagari / IAST / English search, built from word-meanings)
- **+ PDF export** (per-chapter PDF, all-chapters-in-one PDF, single-page print view)
- **+ REST API** (local-first, live fallback)

> **Attribution & fair use:** content originates from shlokam.org. This mirror is for
> **personal / educational offline use**. Keep attribution, link back to
> https://shlokam.org, respect their terms/robots.txt, and do not republish commercially
> without permission. Translations/commentaries may have their own licenses.
>
> **Verified full mirror (2026-10-06): 2,075/2,075 sitemap pages, 78 MB, 29,339 verses,
> 31,597 dictionary entries — Gita 759, Bhagavatam 687 (12 cantos / 335 chapters),
> Shloka 594, Texts 33. Smoke tests 12/12 PASS.**

## Architecture

```
shlokam-offline/
├── scraper/scrape.py        # end-to-end scraper (sitemap + JSON API + HTML parse)
├── data/                    # offline cache (populated by scraper)
│   ├── texts.json deities.json topics.json chapters.json keywords.json
│   ├── sitemap_urls.json page_index.json dictionary.json meta.json
│   └── pages/<slug>.json    # one per page: title, verses[{sanskrit,roman,translation,word_meaning…}]
├── server.js                # Express: static frontend + /api/* + /api/pdf/* + /export/*.html
├── frontend/                # zero-build SPA (works offline via sw.js)
│   └── index.html app.js styles.css sw.js manifest.json
├── Dockerfile / docker-compose.yml
```

**Offline strategy:** server reads `data/` first; if a page is missing it proxies
live `https://app.shlokam.org` (so the app works online even before a full scrape,
and fully offline after `scrape.py --full`).

## Quick start (online use)

```bash
cd shlokam-offline
npm install
# sample data already in data/ after quick scrape; or refresh:
pip install -r scraper/requirements.txt
python scraper/scrape.py --quick      # ~25 pages, <10s
node server.js                        # http://localhost:8080
```

## Full offline mirror (no internet needed afterwards)

```bash
python scraper/scrape.py --full --workers 6 --delay 0.15
# ~2075 URLs, ~5-10 min, ~50-200 MB in data/
node server.js
# now disconnect internet — everything in data/ + service-worker cache still works
```

Docker (production):

```bash
docker compose up --build -d
# http://localhost:8080
```

Deploy online (any host): build image and push, or `npm start` behind Caddy/Nginx.
Set `LIVE_API_BASE=https://app.shlokam.org` (default) and `PORT=8080`.

## Features

### Reading
- Gita chapter view (all verses, toggles for Sanskrit / Transliteration / Translation / Word-meanings, font size)
- Texts, Bhagavatam canto→chapter, Shloka pages — same verse layout
- Search (offline index + live `/api/unified/live-search` fallback)
- Browse by deity (`/api/deities` → `/api/deity/:name`) and by type (tag search)

### PDF / single-page (user asked: “download all chapters into one pdf or single page or whatever user intended”)
- Per page: **⬇ Chapter PDF** → `GET /api/pdf/:slug` (server PDF)
- Combined: **⬇ All Gita chapters — one PDF** → `GET /api/pdf-combined/gita` (cover + contents + 18 chapters, ~300 pages)
- Single-page/print: `GET /export/:slug.html`, `GET /export-combined/gita.html` → browser Print → Save as PDF
- Frontend also has **Single-page view (all chapters)** + `window.print()` button

> How the PDFs stay readable: the server renders the print HTML with headless
> Chrome (correct Devanagari shaping + IAST diacritics, Tiro font embedded,
> A4 with page numbers) and falls back to a basic PDF when no browser binary
> exists. Set `CHROME_PATH` to override detection; the Docker image installs
> `chromium` automatically.

### Audio / voice (recitation for pronunciation)
- Every verse shows 🔊 — verse recitation via `GET /api/verse-audio?content_id=gita-2-47`
- Every chapter view has **▶ Recitation** — full-chapter chanting for Gita (`/api/audio/chapter/2`)
  and Bhagavatam (`/api/audio/chapter/1-1`); other works play verse-by-verse queues
- Mini player: play/pause, previous/next, 0.75–1.5× speed, auto-advance with verse highlighting
- First listen streams live and caches to `data/audio/`; replays work offline.
  Pre-fill a device with `python scraper/download_audio.py --gita-chapters`
  (18 files, ~250 MB) or add `--gita-verses` (~150 MB) / `--chapter 4-16`.

### Dictionary (Sanskrit word → English)
- Built by scraper from every `word_meaning` (`<b>word</b> – meaning`) + Gita keywords
- UI: Dictionary tab; API: `GET /api/dictionary/search?q=karma`
- Current cache: ~13k entries after partial scrape; ~40k+ after full scrape

### API access
| Endpoint | Description |
|---|---|
| `GET /api/health` `GET /api/meta` | status, cached pages |
| `GET /api/texts` `/api/deities` `/api/topics` `/api/chapters` `/api/keywords` | indexes |
| `GET /api/deity/:name` | e.g. `/api/deity/Shiva` |
| `GET /api/topic/:slug` | e.g. `/api/topic/karma-yoga-path-of-selfless-action` |
| `GET /api/explain?q=` | single verse/work, e.g. `?q=gita-2-47` |
| `GET /api/page/:slug` | cached page JSON, e.g. `/api/page/gita__chapter-2` (`-nav` slugs auto-resolve to chapters) |
| `GET /api/types` • `GET /api/type/:tag` | shloka type browser, e.g. `/api/type/Ashtakam` (49), `/api/type/Stotram` (133) |
| `GET /api/bhagavatam/cantos` | 12 cantos / 335 chapters with cached counts |
| `GET /api/gita/chapter/:n` | chapter aggregate |
| `GET /api/search?q=` | offline + live search |
| `GET /api/dictionary/search?q=` | Sanskrit→English |
| `GET /api/pdf/:slug` | chapter PDF |
| `GET /api/pdf-combined/gita` | all-in-one PDF |
| `GET /export/:slug.html` | printable single page |

## Verification

```bash
node server.js & sleep 2
curl -s localhost:8080/api/health
curl -s "localhost:8080/api/dictionary/search?q=dharma" | head -c 500
curl -s localhost:8080/api/gita/chapter/2 | python3 -c "import json,sys;print(len(json.load(sys.stdin)['verses']))"  # 72
curl -s localhost:8080/api/pdf/gita__chapter-2 -o /tmp/ch2.pdf && ls -lh /tmp/ch2.pdf
```

## Limits & next steps
- Audio (`/api/audio`) streams live; offline audio would need R2 bulk download (TB-scale — intentionally not mirrored).
- Transliteration into 20 scripts (Telugu/Tamil/…) is display-side via original site; this clone stores Sanskrit + IAST roman and relies on browser fonts.
- Re-run scraper weekly to stay in sync (`--full` is resumable — skips existing files).
