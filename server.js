/**
 * Shlokam Offline Clone — production-ready server
 * - Serves frontend (offline-capable SPA)
 * - REST API with local-data-first + live fallback to https://app.shlokam.org
 * - Dictionary search API
 * - Server-side PDF export (PDFKit) + printable single-page HTML
 * - Works fully offline once `data/` is populated by scraper/scrape.py --full
 */
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const app = express();
const PORT = process.env.PORT || 8080;
const API_BASE = process.env.LIVE_API_BASE || "https://app.shlokam.org";
const DATA = path.join(__dirname, "data");
const FRONTEND = path.join(__dirname, "frontend");

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/assets", express.static(path.join(__dirname, "assets"), { maxAge: "7d" }));

// ---------- helpers ----------
function readJson(name, fallback = null) {
  try {
    const p = path.join(DATA, name);
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return fallback;
  }
}
function listPages() {
  const pagesDir = path.join(DATA, "pages");
  if (!fs.existsSync(pagesDir)) return [];
  return fs.readdirSync(pagesDir).filter((f) => f.endsWith(".json"));
}
function readPage(slug) {
  const p = path.join(DATA, "pages", slug + ".json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}
function findPage(predicate) {
  for (const f of listPages()) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(DATA, "pages", f), "utf-8"));
      if (predicate(d, f)) return d;
    } catch {}
  }
  return null;
}
async function liveJson(apiPath) {
  const r = await fetch(API_BASE + apiPath, { headers: { Accept: "application/json", "User-Agent": "ShlokamOfflineClone/1.0" } });
  if (!r.ok) throw new Error(`live ${apiPath} -> ${r.status}`);
  return r.json();
}
function stripHtml(s) {
  if (!s) return "";
  return String(s).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
}

// ---------- health / meta ----------
app.get("/api/health", (req, res) => {
  const pages = listPages().length;
  res.json({ ok: true, offline_pages: pages, live_api: API_BASE, time: new Date().toISOString() });
});
app.get("/api/meta", (req, res) => {
  res.json(readJson("meta.json", { offline_pages: listPages().length }));
});

// ---------- browse indexes (local-first, live fallback) ----------
async function localOrLive(file, livePath, res) {
  const local = readJson(file, null);
  if (local) return res.json(local);
  try {
    const j = await liveJson(livePath);
    return res.json(j);
  } catch (e) {
    return res.status(502).json({ error: "offline data missing and live API unreachable", detail: String(e) });
  }
}
app.get("/api/texts", (req, res) => localOrLive("texts.json", "/api/unified/explore/texts", res));
app.get("/api/deities", (req, res) => localOrLive("deities.json", "/api/unified/explore/deities", res));
app.get("/api/topics", (req, res) => localOrLive("topics.json", "/api/unified/explore/topics", res));
app.get("/api/chapters", (req, res) => localOrLive("chapters.json", "/api/unified/chapters/list", res));
app.get("/api/keywords", (req, res) => localOrLive("keywords.json", "/api/keywords/list", res));
app.get("/api/index", (req, res) => res.json(readJson("page_index.json", {})));
app.get("/api/sitemap", (req, res) => res.json(readJson("sitemap_urls.json", [])));
// Bhagavatam cantos grouping from sitemap + cache (works offline)
app.get("/api/bhagavatam/cantos", (req, res) => {
  const urls = readJson("sitemap_urls.json", []);
  const re = /canto-(\d+)-chapter-(\d+)\.htm$/;
  const map = {};
  for (const u of urls) {
    const m = u.match(re);
    if (m && !u.includes("-nav.htm")) {
      const canto = Number(m[1]);
      (map[canto] = map[canto] || []).push(Number(m[2]));
    }
  }
  const cantos = Object.keys(map).sort((a, b) => a - b).map((c) => ({
    canto: Number(c),
    chapters: [...new Set(map[c])].sort((a, b) => a - b),
    cached: [...new Set(map[c])].sort((a, b) => a - b).filter((ch) => {
      try {
        return fs.existsSync(path.join(DATA, "pages", `bhagavatam__canto-${c}-chapter-${ch}.json`));
      } catch { return false; }
    }).length,
  }));
  res.json({ cantos });
});

// deity detail, topic detail, keyword entry — live proxy with local page fallback
app.get("/api/deity/:name", async (req, res) => {
  try {
    const j = await liveJson("/api/unified/explore/deity/" + encodeURIComponent(req.params.name));
    return res.json(j);
  } catch (e) {
    // fallback: search local pages by deity mention
    const hits = [];
    for (const f of listPages()) {
      const d = readPage(path.basename(f, ".json"));
      if (d && (d.title || "").toLowerCase().includes(req.params.name.toLowerCase())) hits.push({ slug: d.slug, title: d.title, verses: d.verse_count });
    }
    if (hits.length) return res.json({ deity: req.params.name, shlokas: hits, _offline: true });
    return res.status(502).json({ error: String(e) });
  }
});
app.get("/api/topic/:slug", async (req, res) => {
  try {
    const j = await liveJson("/api/unified/explore/topic/" + encodeURIComponent(req.params.slug));
    return res.json(j);
  } catch (e) {
    return res.status(502).json({ error: String(e) });
  }
});
app.get("/api/explain", async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: "missing ?q=" });
  // local-first: find page whose verse content_id matches
  const hit = findPage((d) => (d.verses || []).some((v) => v.content_id === q) || (d.api && (d.api.content_id === q)));
  if (hit) return res.json(hit.api || hit);
  try {
    const j = await liveJson("/api/unified/explain?q=" + encodeURIComponent(q));
    return res.json(j);
  } catch (e) {
    return res.status(502).json({ error: String(e) });
  }
});

// ---------- content pages ----------
function pageBySlug(slug) {
  if (!slug) return null;
  // Nav pages (bhagavatam *-nav.htm) contain only verse links, no verses.
  // Transparently resolve them to the readable chapter page: try the stripped
  // slug FIRST (the nav file itself exists but is not useful to readers).
  const candidates = [];
  if (slug.endsWith("-nav")) {
    const stripped = slug.replace(/-nav$/, "");
    candidates.push(stripped, stripped.replace(/\//g, "__"));
  }
  candidates.push(slug, slug.replace(/\//g, "__"));
  // Deity/topic/type UIs pass bare slugs (e.g. "aksharamalika-shiva-stotram");
  // cached files are prefixed (e.g. "shloka__aksharamalika-shiva-stotram").
  for (const prefix of ["shloka__", "text__", "gita__", "bhagavatam__"]) {
    if (!slug.startsWith(prefix)) candidates.push(prefix + slug);
  }
  for (const c of candidates) {
    const d = readPage(c);
    if (d) return d;
  }
  // search index
  return findPage((x) => x.slug === slug || (x.url || "").includes(slug));
}
app.get("/api/page/:slug", (req, res) => {
  const d = pageBySlug(req.params.slug);
  if (d) return res.json(d);
  return res.status(404).json({ error: "page unavailable", slug: req.params.slug });
});
// Gita chapter: aggregate verses from cached chapter page or live explain per verse
app.get("/api/gita/chapter/:n", async (req, res) => {
  const n = req.params.n;
  const cand = [`gita__chapter-${n}`, `gita__gita-chapter-${n}`];
  for (const c of cand) {
    const d = readPage(c);
    if (d) return res.json(d);
  }
  const fuzzy = findPage((d) => (d.url || "").includes(`/gita/chapter-${n}.htm`));
  if (fuzzy) return res.json(fuzzy);
  // live fallback: chapters list + per-verse explain
  try {
    const chapters = await liveJson("/api/unified/chapters/list");
    const ch = (chapters.chapters || []).find((c) => String(c.number) === String(n));
    if (!ch) return res.status(404).json({ error: "chapter not found" });
    const verses = [];
    for (let v = 1; v <= ch.verse_count; v++) {
      try {
        const j = await liveJson(`/api/unified/explain?q=${encodeURIComponent(`gita-${n}-${v}`)}`);
        verses.push(j);
      } catch {}
    }
    return res.json({ chapter: Number(n), ...ch, verses, _live: true });
  } catch (e) {
    return res.status(502).json({ error: String(e) });
  }
});

// ---------- search (local-first, live fallback) ----------
// NOTE: cached `body_text` includes site chrome/footer (deity/type link lists),
// so matching on it alone returns irrelevant pages (e.g. every nav page matches
// "Stotram"). We rank: title match first, then verses text; body_text is only a
// last-resort fallback. "*-nav" navigation pages (verse-link lists, 0 verses)
// are excluded — pageBySlug() already resolves them to readable chapters.
app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (q.length < 2) return res.json({ results: [] });
  const ql = q.toLowerCase();
  const titleHits = [];
  const verseHits = [];
  // Phase 1: title matches via the small index (complete, order-independent).
  // This guarantees e.g. "shiva" surfaces Shiva-titled shlokas before
  // verse-body mentions in Bhagavatam chapters.
  try {
    const idx = readJson("page_index.json", {});
    for (const [slug, info] of Object.entries(idx)) {
      if (slug.endsWith("-nav")) continue;
      if ((info.title || "").toLowerCase().includes(ql)) {
        titleHits.push({ slug, title: info.title, verses: info.verses, _offline: true });
        if (titleHits.length >= 50) break;
      }
    }
  } catch {}
  // Phase 2: verse-text matches via file scan (skip already-matched titles).
  const seenTitles = new Set(titleHits.map((r) => r.slug));
  const bodyHits = [];
  for (const f of listPages()) {
    if (titleHits.length + verseHits.length >= 50) break;
    let d;
    try {
      d = JSON.parse(fs.readFileSync(path.join(DATA, "pages", f), "utf-8"));
    } catch { continue; }
    if (!d || !d.slug || d.slug.endsWith("-nav") || seenTitles.has(d.slug)) continue;
    const versesText = ((d.verses || []).map((v) => [v.content_id, v.sanskrit, v.roman, v.translation].join(" ")).join(" ")).toLowerCase();
    const entry = {
      slug: d.slug, title: d.title, url: d.url, verses: d.verse_count,
      snippet: stripHtml(((d.verses || [])[0] || {}).translation || "").slice(0, 220),
      _offline: true,
    };
    if (versesText.includes(ql)) verseHits.push(entry);
    else if ((d.body_text || "").toLowerCase().includes(ql)) bodyHits.push(entry);
    if (titleHits.length + verseHits.length >= 50) break;
  }
  const results = [...titleHits, ...verseHits, ...bodyHits].slice(0, 50);
  if (results.length >= 10) return res.json({ results });
  try {
    const live = await liveJson("/api/unified/live-search?q=" + encodeURIComponent(q));
    const seen = new Set(results.map((r) => r.slug));
    for (const r of (live && live.results) || []) {
      if (results.length >= 50) break;
      results.push(r);
    }
    return res.json({ results });
  } catch {
    return res.json({ results });
  }
});

// ---------- browse by type ----------
// Shloka taxonomy mirrors shlokam.org/shloka/types.htm tags. We have no per-page
// tag metadata in the scrape, so match titles/slugs containing the tag stem
// (e.g. "ashtakam", "kavacham", "suktam", "sahasranamam"). Sorted with exact
// title matches first. Slugs returned include the `shloka__` prefix so the
// frontend can open them directly via /api/page/:slug.
const TYPE_TAGS = ["Stotram","Ashtakam","Ashtottara","Suktam","Kavacham","Mantra","Shanti Mantra","Sahasranamam","Gayatri Mantra","Stuti","Panchakam","Bhujangam","Shankara","Shatakam","Namavali","Ramana"];
app.get("/api/types", (req, res) => {
  const idx = readJson("page_index.json", {});
  const counts = TYPE_TAGS.map((tag) => {
    const stem = tag.toLowerCase().replace(/[^a-z]/g, "");
    let n = 0;
    for (const [slug, info] of Object.entries(idx)) {
      if (!slug.startsWith("shloka__")) continue;
      const hay = (slug + " " + (info.title || "")).toLowerCase().replace(/[^a-z]/g, "");
      if (hay.includes(stem)) n++;
    }
    return { tag, count: n };
  });
  res.json({ tags: counts });
});
app.get("/api/type/:tag", (req, res) => {
  const tag = req.params.tag;
  const stem = tag.toLowerCase().replace(/[^a-z]/g, "");
  if (!stem) return res.status(400).json({ error: "bad tag" });
  const idx = readJson("page_index.json", {});
  const exact = [];
  const partial = [];
  for (const [slug, info] of Object.entries(idx)) {
    if (!slug.startsWith("shloka__")) continue;
    const hay = ((info.title || "") + " " + slug).toLowerCase();
    const norm = hay.replace(/[^a-z]/g, "");
    if (!norm.includes(stem)) continue;
    const entry = { slug, title: info.title, verses: info.verses, _offline: true };
    if ((info.title || "").toLowerCase().includes(tag.toLowerCase())) exact.push(entry);
    else partial.push(entry);
  }
  res.json({ tag, count: exact.length + partial.length, shlokas: [...exact, ...partial].slice(0, 200) });
});

// ---------- dictionary ----------
app.get("/api/dictionary/search", (req, res) => {
  const q = (req.query.q || "").trim().toLowerCase();
  if (!q) return res.json({ results: [] });
  const dict = readJson("dictionary.json", null);
  if (!dict) return res.status(503).json({ error: "dictionary unavailable" });
  const out = [];
  for (const e of dict.entries) {
    if (e.sanskrit.toLowerCase().includes(q) || e.english.toLowerCase().includes(q)) {
      out.push(e);
      if (out.length >= 50) break;
    }
  }
  res.json({ query: req.query.q, count: out.length, results: out });
});
app.get("/api/dictionary", (req, res) => {
  const dict = readJson("dictionary.json", null);
  if (!dict) return res.status(503).json({ error: "dictionary not built yet" });
  res.json({ count: dict.count });
});

// ---------- PDF export ----------
// Two-tier pipeline:
//  1. Headless Chrome renders the print HTML → pixel-perfect PDF with correct
//     Devanagari shaping + IAST diacritics (browsers use HarfBuzz).
//  2. PDFKit fallback when no Chrome binary is available (ASCII-safe only).
const { spawn, execSync } = require("child_process");
const os = require("os");
const crypto = require("crypto");

function printCss() {
  return `
  @font-face{font-family:'Tiro Devanagari Sanskrit';src:url('/assets/fonts/TiroDevanagariSanskrit-Regular.ttf') format('truetype');}
  @font-face{font-family:'Tiro Devanagari Sanskrit';font-style:italic;src:url('/assets/fonts/TiroDevanagariSanskrit-Italic.ttf') format('truetype');}
  *{box-sizing:border-box}
  @page{size:A4;margin:18mm 15mm 20mm 15mm;
    @bottom-center{content:'Page ' counter(page) ' of ' counter(pages);font-size:9pt;color:#8a7a5c;font-family:Georgia,serif;}
    @bottom-right{content:'Shlokam Library';font-size:9pt;color:#8a7a5c;font-family:Georgia,serif;}}
  body{font-family:'Tiro Devanagari Sanskrit',Georgia,'DejaVu Serif','Noto Serif',serif;color:#241a10;margin:0;line-height:1.55}
  .cover{text-align:center;padding:28px 10px 18px;border-bottom:3px double #8a5a00;margin-bottom:18px}
  .kicker{letter-spacing:.25em;font-size:10pt;color:#8a5a00;font-weight:bold;margin:0 0 6px}
  .cover h1{font-size:22pt;margin:.1em 0}
  .cover .sub{font-size:10.5pt;color:#5a4a2f}
  .toc{margin:0 0 18px}.toc h2{font-size:14pt;border-bottom:1px solid #8a5a00;padding-bottom:4px}
  .toc li{font-size:10.5pt;margin:3px 0}
  .chapter{page-break-before:always}.chapter.first{page-break-before:avoid}
  .chapter h2{font-size:16pt;border-bottom:2px solid #8a5a00;padding-bottom:4px;margin:0 0 4px}
  .chapter .cdesc{font-size:10pt;color:#444;margin:0 0 10px}
  .verse{border-bottom:1px solid #e5d9bd;padding:10px 0 12px;page-break-inside:avoid}
  .vnum{font-size:9.5pt;font-weight:bold;color:#fff;background:#8a5a00;border-radius:10px;padding:1px 10px;display:inline-block;margin-bottom:6px}
  .sa{font-size:14pt;line-height:2;margin:2px 0}
  .ro{font-size:10.5pt;font-style:italic;color:#3d3d3d}
  .tr{font-size:11pt;margin:6px 0}
  .wm{font-size:9.5pt;color:#333;background:#faf3df;border-left:3px solid #8a5a00;padding:5px 8px;margin-top:6px}
  .wm b{color:#5a3c00}
  .vn{font-size:9.5pt;color:#555;margin-top:4px}
  .no-print{display:flex;gap:8px;justify-content:center;margin:14px 0}
  .no-print button,.no-print a{font-family:Georgia,serif;background:#8a5a00;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-size:11pt;cursor:pointer;text-decoration:none}
  @media print{.no-print{display:none}}`;
}

function verseNum(v, i) {
  const raw = String(v.verse ?? "").trim();
  if (/^\d+$/.test(raw)) return raw;
  const m = String(v.content_id || "").match(/(\d+)\s*$/);
  return m ? m[1] : String(i + 1);
}

function verseBlock(v, i) {
  const n = verseNum(v, i);
  return `<section class="verse">
    <span class="vnum">Verse ${n}</span>
    ${v.sanskrit ? `<div class="sa">${v.sanskrit}</div>` : ""}
    ${v.roman ? `<div class="ro">${v.roman}</div>` : ""}
    ${v.translation ? `<div class="tr">${v.translation}</div>` : ""}
    ${v.word_meaning ? `<div class="wm">${v.word_meaning}</div>` : ""}
    ${v.verse_notes ? `<div class="vn"><i>Notes:</i> ${v.verse_notes}</div>` : ""}
  </section>`;
}

function buildPrintHtml({ kicker, title, subtitle, sourceUrl, chapters, toc, pdfLink }) {
  const tocHtml = toc
    ? `<nav class="toc"><h2>Contents</h2><ol>${toc.map((t) => `<li>${t}</li>`).join("")}</ol></nav>` : "";
  const body = chapters.map((c, ci) => `
    <div class="chapter${ci === 0 && !toc ? " first" : ""}">
      ${c.heading ? `<h2>${c.heading}</h2>${c.desc ? `<p class="cdesc">${c.desc}</p>` : ""}` : ""}
      ${(c.verses || []).map((v, i) => verseBlock(v, i)).join("\n") ||
        `<p>${c.fallback || ""}</p>`}
    </div>`).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} — Shlokam Library</title>
  <style>${printCss()}</style></head><body>
  <div class="no-print"><button onclick="window.print()">Print / Save as PDF</button>${pdfLink ? `<a href="${pdfLink}">Download PDF</a>` : ""}</div>
  <header class="cover"><p class="kicker">${kicker}</p><h1>${title}</h1>
  <p class="sub">${subtitle || ""}${sourceUrl ? ` · ${sourceUrl}` : ""}</p></header>
  ${tocHtml}${body}</body></html>`;
}

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  for (const p of [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
  ]) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  for (const b of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    try {
      const r = execSync(`command -v ${b}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
      if (r) return r;
    } catch {}
  }
  return null;
}

function chromePdf(url, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const chrome = findChrome();
    if (!chrome) return reject(new Error("no-chrome"));
    const out = path.join(os.tmpdir(), `shlokam-${crypto.randomBytes(8).toString("hex")}.pdf`);
    const args = ["--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
      "--no-pdf-header-footer", "--virtual-time-budget=15000", `--print-to-pdf=${out}`, url];
    const child = spawn(chrome, args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    const t = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("chrome-timeout")); }, timeoutMs);
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => { clearTimeout(t); reject(e); });
    child.on("close", () => {
      clearTimeout(t);
      fs.readFile(out, (e, buf) => {
        fs.unlink(out, () => {});
        if (e) return reject(new Error("pdf-read-fail " + String(err).slice(-300)));
        resolve(buf);
      });
    });
  });
}

function sendPdf(res, buf, filename) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buf);
}

// Shared Devanagari-capable font for the PDFKit fallback path.
function devaFont(doc) {
  const candidates = [
    path.join(__dirname, "assets", "fonts", "TiroDevanagariSanskrit-Regular.ttf"),
    "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansDevanagari-Regular.ttf",
  ];
  for (const f of candidates) {
    try {
      if (fs.existsSync(f)) {
        doc.registerFont("devanagari", f);
        return "devanagari";
      }
    } catch {}
  }
  return "Helvetica";
}
function cleanTitle(t) {
  return String(t || "").replace(/\s*[|｜]\s*Shlokam\s*$/i, "").trim();
}

// Printable single-page HTML — same layout the PDF is rendered from.
app.get("/export/:slug.html", (req, res) => {
  const d = pageBySlug(req.params.slug);
  if (!d) return res.status(404).send("Page unavailable");
  const verses = d.verses && d.verses.length ? d.verses
    : [{ translation: d.body_text || "No verses available." }];
  res.send(buildPrintHtml({
    kicker: (d.source || "SHLOKAM LIBRARY").toUpperCase(),
    title: cleanTitle(d.title || d.slug),
    subtitle: `${verses.length} verses`,
    sourceUrl: d.url || "",
    chapters: [{ heading: null, verses }],
    pdfLink: `/api/pdf/${encodeURIComponent(d.slug)}`,
  }));
});

// Combined print view: all Gita chapters on one page.
app.get("/export-combined/gita.html", (req, res) => {
  res.send(buildGitaPrintHtml(`/api/pdf-combined/gita`));
});

function gitaChaptersData() {
  const chapters = readJson("chapters.json", null);
  const list = (chapters && chapters.chapters) || [];
  const items = (list.length ? list : Array.from({ length: 18 }, (_, i) => ({ number: i + 1, title: `Chapter ${i + 1}` })))
    .map((ch) => {
      const n = ch.number;
      const page = readPage(`gita__chapter-${n}`) || findPage((d) => (d.url || "").includes(`/gita/chapter-${n}.htm`));
      const verses = (page && page.verses) || [];
      const rawTitle = stripHtml(ch.yoga_name || ch.subtitle || ch.title || "");
      const heading = rawTitle.replace(/^chapter\s+\d+\s*[–—-]\s*/i, "").trim();
      return {
        heading: `Chapter ${n} — ${heading || rawTitle}`,
        desc: stripHtml(ch.description || "").slice(0, 600),
        verses,
        fallback: `(Chapter ${n} verses unavailable offline. Live: https://shlokam.org/gita/chapter-${n}.htm)`,
      };
    });
  return items;
}

function buildGitaPrintHtml(pdfLink) {
  const items = gitaChaptersData();
  const total = items.reduce((a, c) => a + c.verses.length, 0);
  return buildPrintHtml({
    kicker: "BHAGAVAD GITA",
    title: "Bhagavad Gita — All Chapters",
    subtitle: `18 chapters · ${total} verses · Sanskrit, transliteration & translation`,
    sourceUrl: "https://shlokam.org/gita/chapters.htm",
    toc: items.map((c, i) => `${c.heading} (${c.verses.length} verses)`),
    chapters: items,
    pdfLink,
  });
}

// Per-page PDF: headless-Chrome render (perfect shaping), PDFKit fallback.
app.get("/api/pdf/:slug", async (req, res) => {
  const d = pageBySlug(req.params.slug);
  if (!d) return res.status(404).json({ error: "page unavailable" });
  const url = `http://127.0.0.1:${PORT}/export/${encodeURIComponent(d.slug)}.html`;
  try {
    const buf = await chromePdf(url);
    return sendPdf(res, buf, `${d.slug}.pdf`);
  } catch (e) {
    if (String(e.message || e) !== "no-chrome") {
      console.error("chrome pdf failed, falling back:", e.message);
    }
  }
  // ---- PDFKit fallback (no shaping; usable for Latin text) ----
  const verses = d.verses && d.verses.length ? d.verses : [{ translation: d.body_text || "No verses available." }];
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${d.slug}.pdf"`);
  const doc = new PDFDocument({ margin: 50, size: "A4" });
  doc.pipe(res);
  const font = devaFont(doc);
  doc.fontSize(18).font(font).text(d.title || d.slug, { underline: false });
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor("#555").text(`Shlokam Library • ${d.url || ""}`);
  doc.fillColor("#000");
  verses.forEach((v, i) => {
    doc.moveDown(0.7);
    doc.fontSize(11).fillColor("#333").text(`Verse ${verseNum(v, i)}`);
    doc.fillColor("#000");
    if (v.sanskrit) {
      doc.fontSize(11).font(font).text(stripHtml(v.sanskrit).slice(0, 2000));
    }
    if (v.roman) doc.fontSize(10).font("Helvetica-Oblique").text(stripHtml(v.roman).slice(0, 2000));
    if (v.translation) doc.fontSize(10).font("Helvetica").text(stripHtml(v.translation).slice(0, 4000));
    if (v.word_meaning) doc.fontSize(9).fillColor("#333").text(stripHtml(v.word_meaning).slice(0, 2000));
    doc.fillColor("#000");
  });
  doc.end();
});

// Combined "all chapters in one PDF" for the Gita.
app.get("/api/pdf-combined/gita", async (req, res) => {
  const url = `http://127.0.0.1:${PORT}/export-combined/gita.html`;
  try {
    const buf = await chromePdf(url, 180000);
    return sendPdf(res, buf, "bhagavad-gita-all-chapters.pdf");
  } catch (e) {
    console.error("chrome combined pdf failed:", e.message);
    return res.status(503).json({ error: "PDF service temporarily unavailable. Use the print view instead.", print: "/export-combined/gita.html" });
  }
});

// ---------- frontend + offline ----------
// HTML + service worker are never HTTP-cached (so UI updates propagate
// immediately); the service worker itself provides offline caching.
app.use(express.static(FRONTEND, {
  maxAge: "1h",
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html") || filePath.endsWith("sw.js") || filePath.endsWith("manifest.json")) {
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
    }
  },
}));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/export/")) return next();
  res.sendFile(path.join(FRONTEND, "index.html"));
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Shlokam offline clone on http://localhost:${PORT} (data pages: ${listPages().length})`));
}
module.exports = app;
