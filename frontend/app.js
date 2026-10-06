/* Shlokam offline SPA — local-first, live fallback */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const view = $('#view');
const state = { route:'home', show:{sanskrit:true,roman:true,translation:true,word_meaning:true} };

async function j(url){ const r = await fetch(url); if(!r.ok) throw new Error(url+' -> '+r.status); return r.json(); }
function esc(s){ return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;'); }
function toast(msg){ view.insertAdjacentHTML('afterbegin', `<div class="card"><b>${esc(msg)}</b></div>`); }

function applySettings(){
  document.body.dataset.size = $('#fontsize').value;
  $$('.settingsbar [data-field]').forEach(c => state.show[c.dataset.field] = c.checked);
  $$('.verse .f-sanskrit').forEach(e => e.classList.toggle('hidden', !state.show.sanskrit));
  $$('.verse .f-roman').forEach(e => e.classList.toggle('hidden', !state.show.roman));
  $$('.verse .f-translation').forEach(e => e.classList.toggle('hidden', !state.show.translation));
  $$('.verse .f-word_meaning').forEach(e => e.classList.toggle('hidden', !state.show.word_meaning));
}
document.addEventListener('change', e => { if(e.target.matches('.settingsbar input, #fontsize')) applySettings(); });

// tabs + search
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-route]'); if(!b) return;
  $$('#tabs button').forEach(x=>x.classList.remove('active')); b.classList.add('active');
  nav(b.dataset.route);
});
document.addEventListener('click', e => {
  const a = e.target.closest('[data-route]'); if(a && a.tagName==='A'){ e.preventDefault(); $$('#tabs button').forEach(x=>x.classList.toggle('active', x.dataset.route===a.dataset.route)); nav(a.dataset.route, a.dataset.arg); }
});
$('#qbtn').onclick = () => doSearch($('#q').value);
$('#q').addEventListener('keydown', e => { if(e.key==='Enter') doSearch($('#q').value); });
function nav(route, arg){ state.route=route; state.arg=arg; ({home, gita, texts, bhagavatam, deities, types, site, dictionary, api, page, chapter}[route]||home)(); window.scrollTo(0,0); }

// ---------- pages ----------
function liveUrlFor(slug){
  if(!slug) return 'https://shlokam.org/';
  if(slug==='root__home') return 'https://shlokam.org/';
  const parts = slug.split('__');
  if(parts.length===2) return `https://shlokam.org/${parts[0]}/${parts[1]}.htm`;
  return 'https://shlokam.org/';
}

async function home(){
  let health={offline_pages:0}, chapters={chapters:[]}, dictCount=null, typeCount=null;
  try{ health = await j('/api/health'); }catch{}
  try{ chapters = await j('/api/chapters'); }catch{}
  try{ dictCount = (await j('/api/dictionary')).count; }catch{}
  const nCh = (chapters.chapters||[]).length || 18;
  view.innerHTML = `
  <div class="card"><p class="kicker">SHLOKAM LIBRARY</p>
    <h1>Scriptures for study — online &amp; offline</h1>
    <p>Bhagavad Gita (${nCh} chapters) • Texts • Bhagavatam • Shlokas by deity &amp; type • Sanskrit dictionary.</p>
    <p><span id="homestatus">● ${health.offline_pages ? `${health.offline_pages.toLocaleString()} works available offline` : 'connecting…'}</span>${dictCount?` • ${dictCount.toLocaleString()} dictionary entries`:''}</p>
    <div class="toolbar">
      <button class="btn" data-nav="gita">Open Gita</button>
      <button class="btn" data-nav="texts">Open Texts</button>
      <button class="btn" data-nav="bhagavatam">Open Bhagavatam</button>
      <button class="btn secondary" data-nav="dictionary">Dictionary</button>
    </div>
    <div class="toolbar">
      <a class="btn ghost" href="/api/pdf-combined/gita">⬇ All Gita chapters — one PDF</a>
    </div>
  </div>
  <div class="grid">
    <div class="card"><h3>Bhagavad Gita</h3><p>18 chapters, 701 verses. Chapter view, single-page view, per-chapter PDF + combined PDF.</p><button class="btn" data-nav="gita">Browse</button></div>
    <div class="card"><h3>Texts (Upanishads…)</h3><p>Aparokshanubhuti, Brahma Sutras, Chandogya, Isha, Vivekachudamani, Yogasutra + 26 more.</p><button class="btn" data-nav="texts">Browse</button></div>
    <div class="card"><h3>Bhagavatam</h3><p>Canto → chapter → verses with word-meanings. Chapter PDF + print view.</p><button class="btn" data-nav="bhagavatam">Browse</button></div>
    <div class="card"><h3>Shlokas</h3><p>Browse by deity (Shiva, Vishnu, Devi…) and by type (Stotram, Ashtakam, Kavacham, Suktam…).</p><button class="btn" data-nav="deities">By deity</button> <button class="btn secondary" data-nav="types">By type</button></div>
  </div>`;
  $$('[data-nav]', view).forEach(b=>b.onclick=()=>nav(b.dataset.nav));
}

async function gita(){
  let data={chapters:[]};
  try{ data = await j('/api/chapters'); }catch{ toast('Could not load chapters. Check your connection and try again.'); }
  view.innerHTML = `<div class="card"><p class="kicker">BHAGAVAD GITA</p><h1>Chapters</h1>
    <div class="toolbar"><a class="btn" href="/api/pdf-combined/gita">⬇ Download ALL chapters — one PDF</a>
    <button class="btn secondary" id="single">📄 Single-page view (all chapters)</button></div></div>
    <div class="grid">${(data.chapters||[]).map(c=>`<div class="card"><h3>Ch ${c.number} — ${esc(c.yoga_name||c.title||'')}</h3><p>${c.verse_count} verses</p><p>${esc((c.description||'').slice(0,160))}…</p><button class="btn" data-ch="${c.number}">Read</button> <a class="btn ghost" href="/api/pdf/gita__chapter-${c.number}">PDF</a></div>`).join('')}</div>`;
  $('#single').onclick = () => singlePageGita(data.chapters||[]);
  $$('[data-ch]', view).forEach(b=>b.onclick=()=>chapter('gita', b.dataset.ch));
}
async function singlePageGita(chapters){
  view.innerHTML = `<div class="card"><h1>Gita — single page (all chapters)</h1><div class="toolbar"><button class="btn" onclick="window.print()">🖨 Print / Save as PDF</button><a class="btn ghost" href="/api/pdf-combined/gita">⬇ Server PDF instead</a><button class="btn secondary" id="back">← Chapters</button></div></div><div id="all"></div>`;
  $('#back').onclick = gita;
  const box = $('#all');
  for(const c of chapters){
    box.insertAdjacentHTML('beforeend', `<div class="card"><h2>Chapter ${c.number}</h2><p>loading…</p></div>`);
    const el = box.lastElementChild;
    try{
      const d = await j('/api/gita/chapter/'+c.number);
      el.innerHTML = `<h2>Chapter ${c.number} — ${esc(c.yoga_name||'')}</h2>` + renderVerses(d.verses||d.api?.verses||[], 'gita__chapter-'+c.number);
      applySettings();
    }catch{ el.innerHTML = `<h2>Chapter ${c.number}</h2><p>Not cached offline. <a href="https://shlokam.org/gita/chapter-${c.number}.htm" target="_blank">Open live</a></p>`; }
  }
}

async function texts(){
  let items=[];
  try{ items = await j('/api/texts'); }catch{ toast('Could not load texts. Check your connection and try again.'); }
  if(items && !Array.isArray(items)) items = items.texts || items.items || [];
  view.innerHTML = `<div class="card"><p class="kicker">TEXTS</p><h1>All Texts (${items.length})</h1><p>Upanishads, Gitas, Sutras, Stotras with Sanskrit + translation + word-meanings.</p></div>
  <div class="grid">${items.map(t=>`<div class="card"><h3>${esc(t.title)}</h3><p>${t.verse_count} verses</p><button class="btn" data-t="${esc(t.content_id)}" data-s="${esc(t.title)}">Read</button></div>`).join('')}</div>`;
  $$('[data-t]', view).forEach(b=>b.onclick=()=>openExplain(b.dataset.t, b.dataset.s));
}
async function bhagavatam(){
  view.innerHTML = `<div class="card"><p class="kicker">SRIMAD BHAGAVATAM</p><h1>Bhagavatam</h1>
  <p>Canto → chapter reading. Enter canto &amp; chapter, or browse cached pages.</p>
  <div class="toolbar">Canto <input id="canto" value="1" style="width:4em"> Chapter <input id="chap" value="1" style="width:4em"> <button class="btn" id="go">Open</button></div>
  <div id="cantos">loading cantos…</div>
  <div id="cached"></div></div>`;
  $('#go').onclick = () => openBhagavatam($('#canto').value, $('#chap').value);
  try{
    const c = await j('/api/bhagavatam/cantos');
    $('#cantos').innerHTML = `<h3>Cantos (${c.cantos.length})</h3>` + c.cantos.map(x=>`<div class="card"><h3>Canto ${x.canto} — ${x.chapters.length} chapters (${x.cached} cached)</h3><div>${x.chapters.map(ch=>`<button class="btn ghost" data-c="${x.canto}" data-h="${ch}">${ch}</button>`).join(' ')}</div></div>`).join('');
    $$('#cantos [data-c]').forEach(b=>b.onclick=()=>openBhagavatam(b.dataset.c, b.dataset.h));
  }catch{ $('#cantos').innerHTML = 'cantos unavailable'; }
  try{
    const idx = await j('/api/index');
    const keys = Object.keys(idx).filter(k=>k.startsWith('bhagavatam__')).slice(0,20);
    $('#cached').innerHTML = keys.length?`<p style="font-size:.85em">First cached: ${keys.slice(0,5).join(', ')}…</p>`:'';
  }catch{}
}
function openBhagavatam(canto, ch){
  // slug pattern: bhagavatam__canto-{c}-chapter-{h}
  page(`bhagavatam__canto-${canto}-chapter-${ch}`);
}
async function deities(){
  let d=[];
  try{ d = await j('/api/deities'); }catch{ toast('Could not load deities. Check your connection and try again.'); }
  view.innerHTML = `<div class="card"><p class="kicker">BROWSE BY DEITY</p><h1>Deities (${d.length})</h1></div><div class="grid">${d.map(x=>`<div class="card"><h3>${esc(x.name)}</h3><p>${x.count} shlokas</p><button class="btn" data-d="${esc(x.name)}">Open</button></div>`).join('')}</div>`;
  $$('[data-d]', view).forEach(b=>b.onclick=()=>deity(b.dataset.d));
}
async function deity(name){
  view.innerHTML = `<div class="card"><h1>${esc(name)}</h1><p>loading…</p></div>`;
  try{
    const d = await j('/api/deity/'+encodeURIComponent(name));
    const list = d.shlokas||d.items||[];
    view.innerHTML = `<div class="card"><p class="kicker">DEITY</p><h1>${esc(d.deity||name)}</h1><p>${list.length} shlokas</p><button class="btn secondary" id="back">← All deities</button></div>
    <div class="grid">${list.map(s=>`<div class="card"><h3>${esc(s.title||s.title_short||s.slug)}</h3><button class="btn" data-s="${esc(s.slug)}">Read</button></div>`).join('')}</div>`;
    $('#back').onclick = deities;
    $$('[data-s]', view).forEach(b=>b.onclick=()=>openShloka(b.dataset.s));
  }catch{ view.innerHTML = `<div class="card"><h1>${esc(name)}</h1><p>Couldn't load right now. Check your connection and try again, or use search.</p></div>`; }
}
function openShloka(slug){ page(slug.startsWith('shloka__') ? slug : 'shloka__'+slug); }
async function types(){
  view.innerHTML = `<div class="card"><p class="kicker">BROWSE BY TYPE</p><h1>Shloka types</h1><p>Same taxonomy as shlokam.org /shloka/types.htm — counts from offline cache.</p><div id="taggrid">loading…</div></div><div id="typelist"></div>`;
  try{
    const t = await j('/api/types');
    $('#taggrid').innerHTML = `<div class="grid">${t.tags.map(x=>`<div class="card"><h3>${esc(x.tag)}</h3><p>${x.count} shlokas</p><button class="btn" data-t="${esc(x.tag)}">Open</button></div>`).join('')}</div>`;
    $$('#taggrid [data-t]', view).forEach(b=>b.onclick=()=>openType(b.dataset.t));
  }catch{ $('#taggrid').innerHTML = 'Could not load types. Check your connection and try again.'; }
}
async function openType(tag){
  state.route='types';
  view.innerHTML = `<div class="card"><p class="kicker">TYPE</p><h1>${esc(tag)}</h1><p>loading…</p></div>`;
  try{
    const d = await j('/api/type/'+encodeURIComponent(tag));
    view.innerHTML = `<div class="card"><p class="kicker">TYPE</p><h1>${esc(d.tag)} (${d.count})</h1><button class="btn secondary" id="back">← All types</button></div>
    <div class="grid">${d.shlokas.map(s=>`<div class="card"><h3>${esc(s.title||s.slug)}</h3><p>${s.verses} verses</p><button class="btn" data-s="${esc(s.slug)}">Read</button></div>`).join('')}</div>`;
    $('#back').onclick = types;
    $$('[data-s]', view).forEach(b=>b.onclick=()=>page(b.dataset.s));
  }catch{ view.innerHTML = `<div class="card"><h1>${esc(tag)}</h1><p>Failed to load. Try search.</p></div>`; }
}
async function site(){
  view.innerHTML = `<div class="card"><p class="kicker">ABOUT</p><h1>About this library</h1>
  <p>Shlokam Library brings the Bhagavad Gita, Upanishads &amp; Vedanta texts, Srimad Bhagavatam and hundreds of
  stotras together with Sanskrit, transliteration, translation, word-meanings and a Sanskrit dictionary —
  readable online and saved for offline use.</p>
  <div id="sitestats">loading library stats…</div></div>
  <div class="card"><h3>Browse</h3>
  <div class="toolbar"><button class="btn" data-nav="gita">Gita</button><button class="btn" data-nav="texts">Texts</button><button class="btn" data-nav="bhagavatam">Bhagavatam</button><button class="btn" data-nav="deities">By deity</button><button class="btn" data-nav="types">By type</button><button class="btn secondary" data-nav="dictionary">Dictionary</button><button class="btn secondary" data-nav="api">API</button></div></div>
  <div class="card"><h3>Sources &amp; updates</h3>
  <ul><li>Scripture texts: <a href="https://shlokam.org" target="_blank" rel="noopener">shlokam.org</a></li>
  <li><a href="https://shlokam.org/info/whats-new.html" target="_blank" rel="noopener">Latest updates on shlokam.org</a></li></ul>
  <details><summary>Technical details</summary><div id="techdetails">loading…</div></details></div>`;
  $$('[data-nav]', view).forEach(b=>b.onclick=()=>nav(b.dataset.nav));
  try{
    const [h, idx, dict] = await Promise.all([
      j('/api/health').catch(()=>({})), j('/api/index').catch(()=>({})),
      j('/api/dictionary').catch(()=>({})),
    ]);
    const keys = Object.keys(idx);
    const n = (p) => keys.filter(k=>k.startsWith(p)).length;
    $('#sitestats').innerHTML = `<div class="grid">
      <div class="card"><h3>${(h.offline_pages||keys.length||0).toLocaleString()}</h3><p>works available offline</p></div>
      <div class="card"><h3>${n('gita__')}</h3><p>Gita pages</p></div>
      <div class="card"><h3>${n('text__')}</h3><p>Text pages</p></div>
      <div class="card"><h3>${n('bhagavatam__')}</h3><p>Bhagavatam pages</p></div>
      <div class="card"><h3>${n('shloka__')}</h3><p>Shloka pages</p></div>
      <div class="card"><h3>${(dict.count||0).toLocaleString()}</h3><p>dictionary entries</p></div>
    </div>`;
    const m = await j('/api/meta').catch(()=>null);
    $('#techdetails').innerHTML = m ? `<pre>${esc(JSON.stringify(m, null, 1))}</pre>` : '<p>Status unavailable.</p>';
  }catch{ $('#sitestats').innerHTML = '<p>Status unavailable.</p>'; }
}
async function dictionary(){
  view.innerHTML = `<div class="card"><p class="kicker">SANSKRIT DICTIONARY</p><h1>Sanskrit → English</h1>
  <p>Built from word-meanings across all scraped verses + Gita keywords. Search Devanagari, IAST, or English.</p>
  <div class="searchbox"><input id="dq" placeholder="e.g. कर्म, karma, dharma, मोक्ष"><button id="dqbtn">Look up</button></div>
  <div id="dout"></div></div>`;
  const run = async () => {
    const q = $('#dq').value.trim(); if(q.length<1) return;
    $('#dout').innerHTML = 'searching…';
    try{
      const r = await j('/api/dictionary/search?q='+encodeURIComponent(q));
      $('#dout').innerHTML = `<p>${r.count} results for <b>${esc(q)}</b></p>` + (r.results||[]).map(e=>`<div class="dict-entry"><div class="sa-word">${esc(e.sanskrit)}</div><div>${esc(e.english)}</div><div style="font-size:.8em;color:#666">sources: ${esc((e.sources||[]).slice(0,3).join(', '))}</div></div>`).join('') || '<p>No match. Try IAST without diacritics.</p>';
    }catch{ $('#dout').innerHTML = 'Dictionary is unavailable right now. Please try again.'; }
  };
  $('#dqbtn').onclick = run; $('#dq').onkeydown = e=>{ if(e.key==='Enter') run(); };
}
async function api(){
  view.innerHTML = `<div class="card"><p class="kicker">API ACCESS</p><h1>REST API</h1>
  <p>Local-first; falls back to live <code>https://app.shlokam.org</code> when offline cache misses.</p>
  <ul>
  <li><code>GET /api/health</code> • <code>/api/meta</code></li>
  <li><code>GET /api/texts</code> • <code>/api/deities</code> • <code>/api/topics</code> • <code>/api/chapters</code> • <code>/api/keywords</code></li>
  <li><code>GET /api/deity/:name</code> • <code>/api/topic/:slug</code> • <code>/api/explain?q=:id</code> (e.g. <a href="/api/explain?q=gita-2-47"><code>?q=gita-2-47</code></a>)</li>
  <li><code>GET /api/page/:slug</code> • <code>/api/gita/chapter/:n</code> • <code>/api/search?q=</code></li>
  <li><code>GET /api/types</code> • <code>/api/type/:tag</code> (e.g. <a href="/api/type/Stotram"><code>/api/type/Stotram</code></a>) • <code>/api/bhagavatam/cantos</code></li>
  <li><code>GET /api/dictionary/search?q=</code> (Sanskrit→English)</li>
  <li><code>GET /api/pdf/:slug</code> (chapter PDF) • <code>/api/pdf-combined/gita</code> (all-in-one) • <code>/export/:slug.html</code> (print view)</li>
  </ul><p>Example: <a href="/api/explain?q=gita-2-47"><code>/api/explain?q=gita-2-47</code></a> • <a href="/api/dictionary/search?q=karma"><code>/api/dictionary/search?q=karma</code></a></p></div>`;
}

// generic readers
async function openExplain(contentId, title){
  view.innerHTML = `<div class="card"><h1>${esc(title||contentId)}</h1><p>loading…</p></div>`;
  try{
    const d = await j('/api/explain?q='+encodeURIComponent(contentId));
    renderDoc(d, contentId);
  }catch{ view.innerHTML = `<div class="card"><p>Couldn't load ${esc(contentId)}. Check your connection and try again.</p><div class="toolbar"><button class="btn secondary" id="exback">← Back</button></div></div>`; $('#exback').onclick=()=>history.length?history.back():nav('home'); }
}
async function page(slug){
  view.innerHTML = `<div class="card"><p>loading ${esc(slug)}…</p></div>`;
  try{
    const d = await j('/api/page/'+encodeURIComponent(slug));
    renderDoc(d, slug);
  }catch{
    view.innerHTML = `<div class="card"><h1>Page unavailable offline</h1><p>This section isn't saved on this device yet. Check your connection and try again, or read it on the source site.</p><div class="toolbar"><a class="btn" href="${esc(liveUrlFor(slug))}" target="_blank" rel="noopener">Open live page</a><button class="btn secondary" id="pgback">← Back</button></div></div>`;
    $('#pgback').onclick = ()=>history.length?history.back():nav('home');
  }
}
async function chapter(kind, n){
  view.innerHTML = `<div class="card"><p>loading chapter ${esc(n)}…</p></div>`;
  let d;
  try{ d = await j('/api/gita/chapter/'+n); }
  catch{ view.innerHTML = `<div class="card"><p>Chapter ${esc(n)} isn't available right now. Check your connection and try again.</p></div>`; return; }
  renderDoc(d, 'gita__chapter-'+n);
}
function renderVerses(verses, slug){
  return verses.map((v,i)=>{
    const cid = v.content_id || (i+1);
    return `<div class="verse"><h3>${esc(typeof cid==='string'?cid:(v.verse??i+1))}</h3>
    ${v.sanskrit?`<div class="sa f-sanskrit">${v.sanskrit}</div>`:''}
    ${v.roman?`<div class="ro f-roman">${v.roman}</div>`:''}
    ${v.colloquial?`<div class="ro">${v.colloquial}</div>`:''}
    ${v.translation?`<div class="tr f-translation">${v.translation}</div>`:''}
    ${v.word_meaning?`<div class="wm f-word_meaning">${v.word_meaning}</div>`:''}
    ${v.verse_notes?`<div class="tr"><i>Notes:</i> ${v.verse_notes}</div>`:''}
    </div>`;
  }).join('');
}
function renderDoc(d, slug){
  const verses = d.verses || d.api?.verses || [];
  const s = slug || d.slug || '';
  view.innerHTML = `<div class="card"><p class="kicker">${esc(d.source||'')}</p><h1>${esc(d.title||s)}</h1>
  <p>${esc(d.description||'')}</p>
  <div class="toolbar">
    <a class="btn" href="/api/pdf/${encodeURIComponent(s)}">⬇ Chapter PDF</a>
    <a class="btn secondary" href="/export/${encodeURIComponent(s)}.html" target="_blank">📄 Single-page / print view</a>
    <button class="btn ghost" onclick="window.print()">🖨 Print</button>
    <button class="btn ghost" id="backbtn">← Back</button>
  </div>
  <p style="font-size:.85em;color:#666"><a href="/api/page/${encodeURIComponent(s)}">API</a> • <a href="/export/${encodeURIComponent(s)}.html" target="_blank" rel="noopener">print view</a></p></div>
  <div class="card"><div id="vv">${verses.length?renderVerses(verses,s):`<p>${esc(d.body_text||'No structured verses cached — see JSON.').slice(0,8000)}</p>`}</div></div>`;
  $('#backbtn').onclick = ()=>history.length?history.back():nav('home');
  applySettings();
}
async function doSearch(q){
  if(!q || q.trim().length<2){ toast('Type at least 2 characters'); return; }
  state.route='search';
  view.innerHTML = `<div class="card"><h1>Results for “${esc(q)}”</h1><p>searching offline + live…</p></div>`;
  try{
    const r = await j('/api/search?q='+encodeURIComponent(q));
    const items = r.results||[];
    view.innerHTML = `<div class="card"><h1>${items.length} results for “${esc(q)}”</h1>
    <div class="toolbar"><button class="btn secondary" id="dict">Also look up “${esc(q)}” in dictionary</button></div></div>` +
    items.slice(0,60).map(x=>{
      const key = x.slug || x.content_id || '';
      const sub = x.snippet || x.translation || x.roman || '';
      const badge = x._offline ? 'offline' : 'live';
      return `<div class="card"><h3>${esc(x.title||key)}</h3><p style="font-size:.8em;color:#666">${badge}${x.verses?` • ${x.verses} verses`:''}</p><p style="font-size:.85em">${esc(String(sub).slice(0,220))}</p><button class="btn" data-r="${esc(key)}" data-off="${x._offline?1:0}" data-s="${esc(x.page_url_token||x.url_token||'')}">Open</button></div>`;
    }).join('') || `<div class="card"><p>No results.</p></div>`;
    $('#dict').onclick = ()=>{ nav('dictionary'); setTimeout(()=>{ const dq=$('#dq'); if(dq){ dq.value=q; $('#dqbtn').click(); } },300); };
    $$('[data-r]', view).forEach(b=>b.onclick=()=>{
      const id = b.dataset.r;
      // Offline cached pages have slugs containing "__" — open directly.
      // Live API results carry content_ids (e.g. "gita-2-47") — use explain.
      if (id && id.includes('__')) page(id);
      else if (id) openExplain(id, id);
      else if (b.dataset.s) page(b.dataset.s);
    });
  }catch{ toast('Search failed. Check your connection and try again.'); }
}
// net status
async function net(){
  const el = $('#netstatus');
  const online = navigator.onLine;
  let pages = '?';
  try{ const h = await j('/api/health'); pages = h.offline_pages; }catch{}
  el.textContent = (online?'● online':'● offline') + ` • ${pages} cached`;
  el.style.color = online?'#0a6b00':'#a33';
  try{
    const ci = $('#cacheinfo');
    if (ci && typeof pages === 'number') ci.textContent = `${pages.toLocaleString()} works available offline`;
  }catch{}
}
setInterval(net, 10000); net();
home();
