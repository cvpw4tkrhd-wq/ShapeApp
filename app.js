'use strict';
/* ShapeApp – kost, styrka, kondition och hälsologg. All data lagras lokalt (IndexedDB). */
const APP_VERSION = '1.3.0';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clone = o => JSON.parse(JSON.stringify(o));
const sum = a => a.reduce((x, y) => x + (+y || 0), 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- format ---------- */
const nf0 = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 });
const f0 = v => v == null || isNaN(v) ? '–' : nf0.format(v);
const f1 = v => v == null || isNaN(v) ? '–' : nf1.format(v);
const f2 = v => v == null || isNaN(v) ? '–' : nf2.format(v);
const pnum = v => { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(',', '.').replace(/\s/g, '')); return isNaN(n) ? null : n; };

/* ---------- datum ---------- */
const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => dstr(new Date());
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return dstr(d); };
const weekStart = s => { const d = parseD(s); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return dstr(d); };
const isoWeek = s => { const d = parseD(s); d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7); const w1 = new Date(d.getFullYear(), 0, 4); return 1 + Math.round(((d - w1) / 864e5 - 3 + (w1.getDay() + 6) % 7) / 7); };
const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5);
const DAGAR = ['söndag', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag'];
const DAG_K = ['M', 'T', 'O', 'T', 'F', 'L', 'S'];
const MAN = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const fmtD = s => { if (!s) return 'Datum okänt'; const d = parseD(s); return `${d.getDate()} ${MAN[d.getMonth()]} ${d.getFullYear() !== new Date().getFullYear() ? d.getFullYear() : ''}`.trim(); };
const fmtDay = s => { if (s === today()) return 'Idag'; if (s === addDays(today(), -1)) return 'Igår'; const d = parseD(s); return `${DAGAR[d.getDay()][0].toUpperCase() + DAGAR[d.getDay()].slice(1)} ${d.getDate()} ${MAN[d.getMonth()]}`; };
const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/* ---------- lagring (IndexedDB med localStorage som reserv) ---------- */
const Store = {
  db: null,
  async open() {
    if (!('indexedDB' in window)) return;
    this.db = await new Promise((res) => {
      const r = indexedDB.open('shapeapp', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
  },
  async get(k) {
    if (!this.db) { const v = localStorage.getItem('shapeapp:' + k); return v ? JSON.parse(v) : null; }
    return new Promise(res => { const t = this.db.transaction('kv').objectStore('kv').get(k); t.onsuccess = () => res(t.result ?? null); t.onerror = () => res(null); });
  },
  async set(k, v) {
    if (!this.db) { localStorage.setItem('shapeapp:' + k, JSON.stringify(v)); return; }
    return new Promise(res => { const tx = this.db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = res; });
  },
  async del(k) {
    if (!this.db) { localStorage.removeItem('shapeapp:' + k); return; }
    return new Promise(res => { const tx = this.db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete = res; tx.onerror = res; });
  }
};

let S = null;          // användardata
let LOCAL = null;      // enhetsspecifikt (token, lösenfras) – exporteras aldrig
const UI = { tab: 'idag', kostDag: null, halsaVy: 'oversikt', traningVy: 'vecka', statPeriod: 12, statVy: 'kost', sheet: null };
let saveTimer = null;
function save(opts = {}) {
  S.andrad = new Date().toISOString();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await Store.set('state', S);
    if (!opts.noSync) Sync.schedule();
  }, 300);
}
async function saveLocal() { await Store.set('local', LOCAL); }

/* ---------- UI-hjälpare ---------- */
function toast(msg, ms = 2400) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}
const ICON = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17 19 7"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  walk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4" r="2"/><path d="M9 21l2-6 3 2v4M7 12l3-4 4 1 2 4 3 1M10 8l1 6"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l12-7z"/></svg>',
  warn: '⚠︎',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>'
};
function bar(val, max, minMark) {
  if (val == null || !max) return '<div class="bar"></div>';
  const p = clamp(val / max * 100, 0, 100);
  const m = minMark ? `<b style="left:${clamp(minMark / max * 100, 0, 100)}%"></b>` : '';
  return `<div class="bar"><i style="width:${p}%"></i>${m}</div>`;
}
function stack(parts) {
  const tot = sum(parts.map(p => p.v));
  if (!tot) return '<div class="stack"></div><div class="legend">' + parts.map(p => `<span style="--c:${p.c}">${esc(p.l)} –</span>`).join('') + '</div>';
  return `<div class="stack">${parts.map(p => `<i style="width:${p.v / tot * 100}%;background:${p.c}"></i>`).join('')}</div>
  <div class="legend">${parts.map(p => `<span style="--c:${p.c}">${esc(p.l)} ${f1(p.v)} ${p.u || 'g'}</span>`).join('')}</div>`;
}
function rangeTxt(r, unit = '') {
  if (!r || (r.min == null && r.max == null)) return 'inget mål';
  if (r.min != null && r.max != null && r.min !== r.max) return `${f0(r.min)}–${f0(r.max)}${unit}`;
  return `${f0(r.min ?? r.max)}${unit}`;
}
function goalBar(label, val, r, unit) {
  const max = r ? (r.max ?? r.min) : null;
  const st = val == null ? '' : (r && r.min != null && val >= r.min ? '<span class="chip ok">✓</span>' : '');
  return `<div class="row sb"><span>${label}</span><span class="small muted num">${f0(val)} / ${rangeTxt(r, ' ' + unit)} ${st}</span></div>${max ? bar(val, max, r.min !== r.max ? r.min : null) : '<div class="note">Inget mål satt – kan anges under Inställningar.</div>'}`;
}

/* ---------- sheets ---------- */
function openSheet(html, opts = {}) {
  const w = $('#sheet');
  w.className = 'sheet-wrap' + (opts.full ? ' full' : '');
  w.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  UI.sheet = opts.id || 'sheet';
  if (opts.onClose) w._onClose = opts.onClose; else w._onClose = null;
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  const w = $('#sheet'); if (w._onClose) { const f = w._onClose; w._onClose = null; f(); }
  w.className = 'sheet-wrap hidden'; w.innerHTML = ''; UI.sheet = null; document.body.style.overflow = '';
}
function sheetHead(title, extra = '') {
  return `<div class="sh"><h2>${esc(title)}</h2>${extra}<button class="icon-btn" data-a="closeSheet" aria-label="Stäng">${ICON.close}</button></div>`;
}
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });

function confirmBox(text, okLabel, onOk, danger = true) {
  openSheet(`${sheetHead('Bekräfta')}<div class="sbody"><p>${esc(text)}</p>
  <div class="btns"><button class="btn" data-a="closeSheet">Avbryt</button><button class="btn ${danger ? 'danger' : 'pri'}" id="cfOk">${esc(okLabel)}</button></div></div>`);
  $('#cfOk').onclick = () => { closeSheet(); onOk(); };
}

/* ---------- händelser ---------- */
const ACT = {};
document.addEventListener('click', e => {
  const a = e.target.closest('[data-a]');
  if (!a || a.disabled) return;
  const f = ACT[a.dataset.a];
  if (f) { e.preventDefault(); f(a, e); }
});
document.addEventListener('input', e => {
  const a = e.target.closest('[data-i]');
  if (a && ACT[a.dataset.i]) ACT[a.dataset.i](a, e);
});
document.addEventListener('change', e => {
  const a = e.target.closest('[data-c]');
  if (a && ACT[a.dataset.c]) ACT[a.dataset.c](a, e);
});
ACT.closeSheet = () => closeSheet();
ACT.tab = el => { UI.tab = el.dataset.t; closeSheet(); render(); window.scrollTo(0, 0); };

/* ---------- diagram (SVG, utan bibliotek) ---------- */
function lineChart(series, o = {}) {
  // series: [{pts:[{x:'YYYY-MM-DD', y}], color, label}] ; o.lines:[{y,label,dash}]
  const W = 320, H = o.h || 150, L = 30, R = 8, T = 10, B = 20;
  const all = series.flatMap(s => s.pts).filter(p => p.y != null && p.x);
  if (!all.length) return `<div class="empty">Inga värden ännu</div>`;
  const xs = all.map(p => parseD(p.x).getTime());
  let x0 = Math.min(...xs), x1 = Math.max(...xs); if (x0 === x1) { x0 -= 864e5 * 7; x1 += 864e5 * 7; }
  const ys = all.map(p => p.y).concat((o.lines || []).map(l => l.y));
  let y0 = o.yMin ?? Math.min(...ys), y1 = o.yMax ?? Math.max(...ys);
  const padY = (y1 - y0) * .12 || 1; y0 -= padY; y1 += padY;
  const sx = t => L + (t - x0) / (x1 - x0) * (W - L - R);
  const sy = v => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  let g = '';
  for (let i = 0; i <= 3; i++) { const v = y0 + (y1 - y0) * i / 3; g += `<line x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}" stroke="var(--line)" stroke-width=".7"/><text x="${L - 4}" y="${sy(v) + 3}" text-anchor="end">${f1(v)}</text>`; }
  (o.lines || []).forEach(l => { g += `<line x1="${L}" x2="${W - R}" y1="${sy(l.y)}" y2="${sy(l.y)}" stroke="${l.color || 'var(--warn)'}" stroke-width="1" stroke-dasharray="4 3"/><text x="${W - R}" y="${sy(l.y) - 3}" text-anchor="end" style="fill:${l.color || 'var(--warn)'}">${esc(l.label)}</text>`; });
  g += `<text x="${L}" y="${H - 4}">${fmtD(dstr(new Date(x0)))}</text><text x="${W - R}" y="${H - 4}" text-anchor="end">${fmtD(dstr(new Date(x1)))}</text>`;
  series.forEach(s => {
    const pts = s.pts.filter(p => p.y != null && p.x).sort((a, b) => a.x < b.x ? -1 : 1);
    if (pts.length > 1) g += `<polyline fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" points="${pts.map(p => `${sx(parseD(p.x).getTime())},${sy(p.y)}`).join(' ')}"/>`;
    pts.forEach(p => { g += `<circle cx="${sx(parseD(p.x).getTime())}" cy="${sy(p.y)}" r="3.2" fill="${p.hollow ? 'var(--card)' : s.color}" stroke="${s.color}" stroke-width="1.5"><title>${fmtD(p.x)}: ${f1(p.y)}</title></circle>`; });
  });
  const leg = series.length > 1 || o.legend ? `<div class="legend" style="margin-top:4px">${series.map(s => `<span style="--c:${s.color}">${esc(s.label)}</span>`).join('')}${o.legendExtra || ''}</div>` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || 'Diagram')}">${g}</svg>${leg}`;
}
function barChart(items, o = {}) {
  // items: [{label, v, v2?, mark?}] ; o.goal number ; o.color
  const W = 320, H = o.h || 140, L = 30, R = 6, T = 10, B = 20;
  if (!items.length) return '<div class="empty">Inga värden ännu</div>';
  const mx = Math.max(o.goal || 0, ...items.map(i => (i.v || 0) + (i.v2 || 0)), 1) * 1.1;
  const bw = (W - L - R) / items.length;
  const sy = v => T + (1 - v / mx) * (H - T - B);
  let g = '';
  for (let i = 0; i <= 2; i++) { const v = mx * i / 2; g += `<line x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}" stroke="var(--line)" stroke-width=".7"/><text x="${L - 4}" y="${sy(v) + 3}" text-anchor="end">${mx < 10 ? f1(v) : f0(v)}</text>`; }
  items.forEach((it, i) => {
    const x = L + i * bw + bw * .18, w = bw * .64;
    if (it.mark) g += `<rect x="${L + i * bw}" y="${T}" width="${bw}" height="${H - T - B}" fill="var(--soft)" opacity=".7"><title>${esc(it.mark)}</title></rect>`;
    if (it.v == null) { g += `<text x="${x + w / 2}" y="${H - B - 3}" text-anchor="middle">–</text>`; }
    else {
      g += `<rect x="${x}" y="${sy(it.v)}" width="${w}" height="${Math.max(0, sy(0) - sy(it.v))}" rx="2" fill="${o.color || 'var(--acc)'}"><title>${esc(it.label)}: ${f1(it.v)}</title></rect>`;
      if (it.v2) g += `<rect x="${x}" y="${sy(it.v + it.v2)}" width="${w}" height="${Math.max(0, sy(it.v) - sy(it.v + it.v2))}" rx="2" fill="${o.color2 || 'var(--sage)'}"><title>${esc(it.label)}: ${f1(it.v2)}</title></rect>`;
    }
    if (items.length <= 16 && (items.length <= 8 || i % 2 === 0)) g += `<text x="${L + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(it.label)}</text>`;
  });
  if (o.goal) g += `<line x1="${L}" x2="${W - R}" y1="${sy(o.goal)}" y2="${sy(o.goal)}" stroke="var(--warn)" stroke-dasharray="4 3"/><text x="${W - R}" y="${sy(o.goal) - 3}" text-anchor="end" style="fill:var(--warn)">${esc(o.goalLabel || 'mål')}</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || 'Stapeldiagram')}">${g}</svg>`;
}

/* ---------- standarddata ---------- */
const DEFAULT_EXCL = [{"id": "notter", "namn": "Nötter och mandel", "ord": ["nötter", "jordnöt", "hasselnöt", "valnöt", "cashew", "paranöt", "pekannöt", "pistage", "macadamia", "mandel", "marsipan", "nougat", "nöt, ", "pinjenöt", "nötkräm", "nötsmör"], "undantag": ["kokosnöt", "muskotnöt", "kokos", "mandelpotatis"], "grupper": [], "aktiv": true}, {"id": "fron", "namn": "Fröer (pumpa, solros, lin m.fl.)", "ord": ["pumpafrö", "pumpakärn", "solrosfrö", "solroskärn", "linfrö", "frön", "fröer", "fröbröd", "fröknäcke", "fröblandning", "hampafrö", "vallmofrö", "psyllium", "pinjekärn"], "undantag": ["chiafrö", "sesamfrö", "senapsfrö", "u. frön", "sesam"], "grupper": [], "aktiv": true}, {"id": "stenfrukt", "namn": "Stenfrukter", "ord": ["plommon", "sviskon", "persika", "persikor", "nektarin", "aprikos", "körsbär", "bigarrå", "mirabell"], "undantag": ["körsbärstomat"], "grupper": [], "aktiv": true}, {"id": "soja", "namn": "Soja", "ord": ["soja", "tofu", "tempeh", "edamame", "miso"], "undantag": [], "grupper": [], "aktiv": true}, {"id": "laktos", "namn": "Laktos", "ord": ["mjölk", "grädd", "yoghurt", "kvarg", "keso", "smör", "glass", "vassle", "laktos", "kesella", "mesost", "messmör", "ost", "fil ", "crème fraiche", "creme fraiche", "välling", "bechamel"], "undantag": ["laktosfri", "ostron", "rostad", "rostat", "rostbiff", "kokosmjölk", "havremjölk", "sojamjölk", "mandelmjölk", "rismjölk", "kokosgrädde", "havregrädde", "bröstmjölk", "jordnötssmör", "kakaosmör", "mandelsmör", "kostpreparat", "frost", "kompost", "havredryck", "växtbaserad", "sheasmör", "kokosfett", "smörgås", "toast", "frukost", "boston", "råkost", "alternativ till ost", "u. ost"], "grupper": ["Mjölk", "Naturell fil yoghurt", "Smaksatt fil yoghurt", "Färskost o kvarg", "Grädde creme fraiche", "Hård ost mm", "Dessertost", "Mesvaror", "Smältost", "Smör", "Glass", "Mjölkdryck chokladdryck milkshake smothie m yoghurt", "Välling", "Osträtter"], "aktiv": true}, {"id": "balj", "namn": "Bönor, ärtor, linser och groddar", "ord": ["böna", "bönor", "ärter", "ärtor", "ärtsopp", "ärtmjöl", "ärtprotein", "kikärt", "sockerärt", "sugarsnap", "linser", "linsbiff", "linssopp", "groddar", "grodd", "hummus", "falafel", "edamame", "jordnöt", "mungböna", "sojaböna"], "undantag": ["jordärtskocka", "kronärtskocka", "vetegrodd", "kaffeböna", "kaffebönor", "kakaoböna", "hjärt", "vaniljstång", "vaniljböna", "vete, grodd"], "grupper": ["Baljväxter (bönor, linser och ärter)"], "aktiv": true}];

const MUSKLER = ['Ben', 'Bröst', 'Rygg', 'Axlar', 'Armar', 'Bål'];
// typ: vikt (kg+reps), kropp (reps, ev. extra kg), tid (sekunder), viktTid (kg+sekunder)
const DEFAULT_OVN = [
  ['knaboj', 'Knäböj (skivstång)', 'Ben', '', 'vikt', 2.5],
  ['marklyft', 'Marklyft', 'Ben', '', 'vikt', 2.5],
  ['rdl', 'Rumänsk marklyft', 'Ben', '', 'vikt', 2.5],
  ['benpress', 'Benpress (maskin)', 'Ben', '', 'vikt', 5],
  ['bulgarisk', 'Bulgarisk split squat (hantlar)', 'Ben', '', 'vikt', 2],
  ['utfall', 'Utfallssteg (hantlar)', 'Ben', '', 'vikt', 2],
  ['bencurl', 'Bencurl (maskin)', 'Ben', '', 'vikt', 2.5],
  ['benspark', 'Benspark (maskin)', 'Ben', '', 'vikt', 2.5],
  ['vadpress', 'Vadpress (maskin)', 'Ben', '', 'vikt', 5],
  ['hoftlyft', 'Höftlyft (skivstång)', 'Ben', '', 'vikt', 5],
  ['bankpress', 'Bänkpress (skivstång)', 'Bröst', 'Mitt', 'vikt', 2.5],
  ['lutpress', 'Lutande hantelpress 30°', 'Bröst', 'Övre', 'vikt', 2],
  ['brostpress', 'Bröstpress (maskin)', 'Bröst', 'Mitt', 'vikt', 2.5],
  ['cross_upp', 'Kabelcross nerifrån och upp', 'Bröst', 'Övre', 'vikt', 2.5],
  ['cross_mitt', 'Kabelcross rakt fram', 'Bröst', 'Mitt', 'vikt', 2.5],
  ['cross_ned', 'Kabelcross uppifrån och ned', 'Bröst', 'Nedre', 'vikt', 2.5],
  ['dips', 'Dips (framåtlutad)', 'Bröst', 'Nedre', 'kropp', 2.5],
  ['latsdrag', 'Latsdrag (maskin)', 'Rygg', '', 'vikt', 2.5],
  ['kabelrodd', 'Sittande kabelrodd', 'Rygg', '', 'vikt', 2.5],
  ['hantelrodd', 'Hantelrodd', 'Rygg', '', 'vikt', 2],
  ['stangrodd', 'Skivstångsrodd', 'Rygg', '', 'vikt', 2.5],
  ['chins', 'Chins', 'Rygg', '', 'kropp', 2.5],
  ['axelpress_h', 'Axelpress (hantlar)', 'Axlar', '', 'vikt', 2],
  ['axelpress_m', 'Axelpress (maskin)', 'Axlar', '', 'vikt', 2.5],
  ['sidolyft', 'Sidolyft (hantlar)', 'Axlar', '', 'vikt', 1],
  ['facepull', 'Face pulls (kabel)', 'Axlar', '', 'vikt', 2.5],
  ['lutcurl', 'Lutande hantelcurl 60°', 'Armar', 'Biceps', 'vikt', 1],
  ['spidercurl', 'Spider curl 60°', 'Armar', 'Biceps', 'vikt', 1],
  ['hammarcurl', 'Hammarcurl (hantel)', 'Armar', 'Biceps', 'vikt', 1],
  ['tricepspress', 'Tricepspress (kabel)', 'Armar', 'Triceps', 'vikt', 2.5],
  ['franskpress', 'Fransk press', 'Armar', 'Triceps', 'vikt', 2],
  ['deadbug', 'Dead bug', 'Bål', '', 'kropp', 0],
  ['plankan', 'Plankan', 'Bål', '', 'tid', 0],
  ['sidoplanka', 'Sidoplanka', 'Bål', '', 'tid', 0],
  ['omvcrunch', 'Omvända crunches', 'Bål', '', 'kropp', 0],
  ['kabelcrunch', 'Kabelcrunch', 'Bål', '', 'vikt', 2.5],
  ['pallof', 'Pallof press', 'Bål', '', 'vikt', 2.5],
  ['knalyft', 'Hängande knälyft', 'Bål', '', 'kropp', 0],
  ['benlyft', 'Hängande benlyft', 'Bål', '', 'kropp', 0],
  ['farmers', "Farmer's walk", 'Bål', '', 'viktTid', 2]
].map(([id, namn, grupp, del, typ, steg]) => ({ id, namn, grupp, del, typ, steg, aktiv: true }));

const T = (oid, set, mal) => ({ oid, set, mal });
const DEFAULT_MALLAR = [
  { id: 'A', namn: 'Pass A', fokus: 'Övre bröst', ovn: [T('knaboj', 3, '6-8'), T('lutpress', 3, '8-10'), T('kabelrodd', 3, '8-10'), T('axelpress_h', 3, '8-10'), T('bencurl', 3, '10-12'), T('lutcurl', 3, '8-12'), T('tricepspress', 3, '10-12'), T('deadbug', 2, '8-10'), T('plankan', 2, '30-45')] },
  { id: 'B', namn: 'Pass B', fokus: 'Mitt bröst', ovn: [T('rdl', 3, '6-8'), T('bankpress', 3, '6-8'), T('latsdrag', 3, '8-10'), T('bulgarisk', 3, '8-10'), T('sidolyft', 3, '12-15'), T('spidercurl', 3, '8-12'), T('omvcrunch', 2, '10-12'), T('sidoplanka', 2, '20-30')] },
  { id: 'C', namn: 'Pass C', fokus: 'Nedre bröst', ovn: [T('benpress', 3, '10-12'), T('dips', 3, '6-10'), T('hantelrodd', 3, '8-10'), T('benspark', 3, '10-12'), T('facepull', 3, '12-15'), T('hammarcurl', 3, '8-12'), T('franskpress', 3, '10-12'), T('kabelcrunch', 2, '10-15'), T('pallof', 2, '10-12')] },
  { id: 'D', namn: 'Pass D', fokus: 'Valfritt: bröst och armar', ovn: [T('cross_upp', 3, '12-15'), T('cross_mitt', 2, '12-15'), T('cross_ned', 3, '12-15'), T('brostpress', 3, '8-10'), T('lutcurl', 2, '8-12'), T('spidercurl', 2, '8-12'), T('hammarcurl', 2, '8-12'), T('tricepspress', 3, '10-12'), T('knalyft', 2, '8-12')] }
];

const KOND_TYPER = ['Rask promenad', 'Promenad', 'Cykel', 'Crosstrainer', 'Löpning', 'Roddmaskin', 'Simning', 'Annat'];
const MALTYPER = ['Frukost', 'Mellanmål', 'Lunch', 'Middag', 'Kvällsmål'];


function defaultState() {
  const ws = weekStart(today());
  return {
    v: 1,
    skapad: new Date().toISOString(),
    profil: { namn: '', kon: '', alder: null, langd: null, vikt: null, notering: '' },
    mal: {
      protein: { min: null, max: null }, fett: { min: null, max: null }, kolh: { min: null, max: null }, kcal: { min: null, max: null },
      fiber: { min: 25, max: 35 }, frittSockerEP: 10, somn: { min: 7, max: 8 }, styrkaPass: { min: 3, max: 4 },
      kondTrappa: [{ fran: 1, min: 60, max: 90 }, { fran: 3, min: 90, max: 120 }, { fran: 5, min: 150, max: 150 }],
      kondStart: ws, promenadMin: 10, fasteglukos: null, hba1c: null, midja: null, vikt: null, vilaSek: 90
    },
    uteslut: clone(DEFAULT_EXCL).map(c => ({ ...c, aktiv: false })),
    egnaLivsmedel: [
      { id: 'e:kvarg', namn: 'Kvarg naturell laktosfri', n: [64, 10, 0.2, 0.1, 0, 0, 0, 0, 5.2, 3.2, 0, 0, 0, 0, 0.1], a: 1, taggar: [], kalla: 'Uppskattning från Livsmedelsverkets kvarg 0,2 % – kontrollera förpackningen' },
      { id: 'e:keso', namn: 'Keso/cottage cheese laktosfri', n: [100, 13.4, 4.3, 2.8, 1, 0.2, 0, 0, 1.9, 1.6, 0, 0, 0, 0, 0.7], a: 1, taggar: [], kalla: 'Uppskattning från Livsmedelsverkets cottage cheese 4 % – kontrollera förpackningen' }
    ],
    mallar: [
      { id: uid(), namn: 'Havregrynsfrukost', typ: 'Frukost', rader: [{ fid: 702, g: 60 }, { fid: 'e:kvarg', g: 200 }, { fid: 555, g: 75 }, { fid: 6157, g: 10 }] },
      { id: uid(), namn: 'Kyckling och fullkornsris', typ: 'Lunch', rader: [{ fid: 1170, g: 150 }, { fid: 2517, g: 180 }, { fid: 325, g: 120 }, { fid: 35, g: 10 }] },
      { id: uid(), namn: 'Lax, potatis och grönsaker', typ: 'Middag', rader: [{ fid: 1316, g: 150 }, { fid: 5153, g: 200 }, { fid: 305, g: 100 }, { fid: 325, g: 100 }, { fid: 833, g: 60 }] },
      { id: uid(), namn: 'Ägg och äpple', typ: 'Mellanmål', rader: [{ fid: 2205, g: 120 }, { fid: 588, g: 150 }] },
      { id: uid(), namn: 'Keso med blåbär', typ: 'Mellanmål', rader: [{ fid: 'e:keso', g: 150 }, { fid: 555, g: 75 }] },
      { id: uid(), namn: 'Yoghurt med chia', typ: 'Kvällsmål', rader: [{ fid: 7149, g: 200 }, { fid: 6157, g: 10 }] }
    ],
    maltider: [],
    anvandning: {},       // fid -> {n: antal, g: senaste gram, u/q: senaste enhet}
    enheter: {},          // fid -> {dl: g, msk: g, tsk: g, st: g}
    ovningar: clone(DEFAULT_OVN),
    passmallar: clone(DEFAULT_MALLAR),
    pass: [],
    aktivtPass: null,
    kondition: [],
    pauser: [],
    halsa: {
      lab: [],
      matt: [],
      somn: {}   // datum -> timmar
    },
    paminnelser: { promenad: true, veckouppfoljning: true, midja: true },
    veckonoter: {}
  };
}

/* ---------- livsmedelsdatabas ---------- */
// Näringsindex i snapshot-array n[]: per 100 g
const NI = { kcal: 0, prot: 1, fett: 2, matt: 3, enkel: 4, fler: 5, o3: 6, o3lc: 7, kolh: 8, socker: 9, tillsatt: 10, fritt: 11, fiber: 12, fullkorn: 13, salt: 14 };
const NKEYS = Object.keys(NI);
const FOOD = { byId: new Map(), list: [], groups: [], vocab: [], loaded: false, version: '' };
async function loadFoods() {
  try {
    const r = await fetch('./livsmedel.json');
    const d = await r.json();
    FOOD.groups = d.g; FOOD.vocab = d.r; FOOD.version = d.v;
    FOOD.list = d.f.map(f => ({ id: f[0], namn: f[1], grupp: d.g[f[2]], a: f[3], n: f.slice(4, 19), rav: f[19], lc: f[1].toLowerCase() }));
    FOOD.list.forEach(f => FOOD.byId.set(f.id, f));
    FOOD.loaded = true;
  } catch (e) { console.warn('Kunde inte ladda livsmedel.json', e); }
  refreshOwnFoods();
  buildExclusionIndex();
}
const BUILTIN = [{ id: 'b:vatten', namn: 'Vatten', grupp: 'Dryck', a: 0, n: new Array(15).fill(0), rav: [], lc: 'vatten', egen: false }];
function refreshOwnFoods() {
  for (const k of [...FOOD.byId.keys()]) if (String(k).startsWith('e:')) FOOD.byId.delete(k);
  BUILTIN.forEach(b => FOOD.byId.set(b.id, b));
  (S.egnaLivsmedel || []).forEach(e => FOOD.byId.set(e.id, { id: e.id, namn: e.namn, grupp: 'Egna livsmedel', a: e.a ?? 2, n: e.n, rav: [], lc: e.namn.toLowerCase(), egen: true, taggar: e.taggar || [], kalla: e.kalla }));
}
function getFood(fid) { return FOOD.byId.get(fid) || FOOD.byId.get(+fid) || null; }

/* ---------- uteslutna livsmedel ---------- */
let EXCL = new Map(); // fid -> {hide:[namn], warn:[namn]}
function catHit(cat, s) {
  s = s.toLowerCase();
  if ((cat.undantag || []).some(u => u && s.includes(u.toLowerCase()))) return false;
  return (cat.ord || []).some(k => k && s.includes(k.toLowerCase()));
}
function exclusionFor(f) {
  const res = { hide: [], warn: [] };
  for (const c of S.uteslut) {
    if (!c.aktiv) continue;
    if (f.egen) { if ((f.taggar || []).includes(c.id) || catHit(c, f.namn)) res.hide.push(c.namn); continue; }
    if ((c.grupper || []).includes(f.grupp) || catHit(c, f.namn)) { res.hide.push(c.namn); continue; }
    if ((f.rav || []).some(i => catHit(c, FOOD.vocab[i] || ''))) res.warn.push(c.namn);
  }
  return res;
}
function buildExclusionIndex() {
  EXCL = new Map();
  for (const f of FOOD.byId.values()) { const r = exclusionFor(f); if (r.hide.length || r.warn.length) EXCL.set(f.id, r); }
}
function exclInfo(fid) { return EXCL.get(fid) || EXCL.get(+fid) || null; }

/* ---------- näringsberäkning ---------- */
function rowNut(r) { // r: {n:[..per100], g}
  const out = {}; NKEYS.forEach((k, i) => out[k] = (r.n[i] || 0) * r.g / 100); return out;
}
function addNut(a, b) { NKEYS.forEach(k => a[k] = (a[k] || 0) + (b[k] || 0)); return a; }
function zeroNut() { const o = {}; NKEYS.forEach(k => o[k] = 0); o.protA = 0; o.protV = 0; o.protM = 0; return o; }
function portionFactor(m) {
  const p = m.portion; if (!p || !p.total || !p.ata || p.ata >= p.total) return 1;
  return p.ata / p.total;
}
function mealNut(m) {
  const t = zeroNut(), k = portionFactor(m);
  m.rader.forEach(r => { const n = rowNut(r); NKEYS.forEach(x => n[x] *= k); addNut(t, n); if (r.a === 1) t.protA += n.prot; else if (r.a === 0) t.protV += n.prot; else t.protM += n.prot; });
  return t;
}
function dayNut(datum) {
  const t = zeroNut(); let cnt = 0;
  S.maltider.filter(m => m.datum === datum).forEach(m => { const n = mealNut(m); NKEYS.concat(['protA', 'protV', 'protM']).forEach(k => t[k] += n[k]); cnt++; });
  t.antal = cnt; return t;
}
function snapRow(fid, g) {
  const f = getFood(fid); if (!f) return null;
  return { fid: f.id, namn: f.namn, g, n: f.n.slice(), a: f.a };
}
// Neutral bedömning av måltidens sammansättning – inte en GI-beräkning
function mealProfile(n) {
  if (n.kolh < 15) return { cls: 'out', t: 'Lite kolhydrater' };
  const fritt = Math.max(n.fritt, n.tillsatt);
  if (n.prot >= 15 && n.fiber >= 5) return { cls: 'ok', t: 'Kolhydrater med protein och fiber' + (fritt >= 10 ? ` · fritt socker ${f0(fritt)} g` : '') };
  if (n.prot < 10 && n.fiber < 3) return { cls: 'warn', t: 'Mest kolhydrater – lägg gärna till protein eller fiber' };
  if (n.fiber < 3) return { cls: 'info', t: 'Kolhydrater med protein, lite fiber' };
  if (n.prot < 15) return { cls: 'info', t: 'Kolhydrater med fiber, lite protein' };
  return { cls: 'info', t: 'Delvis balanserad' };
}

/* ---------- gemensamma beräkningar ---------- */
function activePause(datum = today()) {
  return S.pauser.find(p => p.fran <= datum && (!p.till || p.till >= datum)) || null;
}
function kondTarget(datum = today()) {
  const w = Math.floor(daysBetween(weekStart(S.mal.kondStart || today()), weekStart(datum)) / 7) + 1;
  const steps = [...S.mal.kondTrappa].sort((a, b) => a.fran - b.fran);
  let cur = steps[0]; steps.forEach(s => { if (w >= s.fran) cur = s; });
  return { vecka: Math.max(1, w), min: cur.min, max: cur.max };
}
// Kvalificerande kondition: måttlig eller hög intensitet. Varje loggning räknas en gång.
function weekKond(ws) {
  const we = addDays(ws, 6);
  const k = S.kondition.filter(x => x.datum >= ws && x.datum <= we);
  return {
    min: sum(k.filter(x => x.intensitet !== 'Lätt').map(x => x.min)),
    latt: sum(k.filter(x => x.intensitet === 'Lätt').map(x => x.min)),
    promenader: k.filter(x => x.efterMaltid).length,
    promMin: sum(k.filter(x => x.efterMaltid).map(x => x.min)),
    lista: k
  };
}
function weekPass(ws) { const we = addDays(ws, 6); return S.pass.filter(p => p.datum >= ws && p.datum <= we); }
function latest(arr) { const d = arr.filter(x => x.datum).sort((a, b) => a.datum < b.datum ? 1 : -1); return d[0] || arr.find(x => !x.datum) || null; }
function mattLatest(typ) { return latest(S.halsa.matt.filter(m => m.typ === typ)); }
function refStatus(v, lo, hi) {
  if (v == null) return { cls: 'out', t: 'Ej mätt' };
  if (hi != null && v > hi) return { cls: 'warn', t: 'Över ref.' };
  if (lo != null && v < lo) return { cls: 'warn', t: 'Under ref.' };
  if (lo == null && hi == null) return { cls: 'out', t: 'Inget ref.' };
  return { cls: 'ok', t: 'Inom ref.' };
}
function sleepAvg(endDate, days = 7) {
  const v = []; for (let i = 0; i < days; i++) { const s = S.halsa.somn[addDays(endDate, -i)]; if (s != null) v.push(s); }
  return v.length ? sum(v) / v.length : null;
}

/* ---------- render ---------- */
function setHeader(title, sub) { $('#title').textContent = title; $('#subtitle').textContent = sub || ''; }
function render() {
  $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.t === UI.tab));
  const m = $('#main');
  if (!['idag', 'kost', 'traning', 'halsa'].includes(UI.tab)) UI.tab = 'idag';
  document.body.dataset.sec = UI.tab;
  const views = { idag: viewOversikt, kost: viewKostSek, traning: viewTraningSek, halsa: viewHalsa };
  m.innerHTML = views[UI.tab]();
  const tc = getComputedStyle(document.body).getPropertyValue('--acc').trim(); const meta = $('meta[name="theme-color"]'); if (meta && tc) meta.content = tc;
}

/* ---------- IDAG ---------- */
function reminders() {
  const r = [], t = today(), dow = new Date().getDay();
  const pr = S.paminnelser;
  if (pr.midja && !mattLatest('midja')) r.push({ t: 'Mät midjemåttet (se instruktion under Hälsa)', a: 'addMatt', d: 'midja' });
  if (pr.promenad && !activePause()) {
    const idag = S.kondition.filter(k => k.datum === t && k.efterMaltid).length;
    const meals = S.maltider.filter(m => m.datum === t && (m.typ === 'Lunch' || m.typ === 'Middag')).length;
    if (meals > idag) r.push({ t: `Promenad ${S.mal.promenadMin}–15 min efter måltiden?`, a: 'quickWalk' });
  }
  if (pr.veckouppfoljning && (dow === 0 || dow === 1) && !S.veckonoter[weekStart(addDays(t, dow === 1 ? -1 : 0))]) r.push({ t: 'Dags för veckouppföljning', a: 'goReview' });
  return r;
}
ACT.setSleep = el => {
  let v = el.dataset.v;
  if (v === 'ask') { const x = prompt('Timmar sömn i natt (t.ex. 6,75)'); v = pnum(x); if (v == null) return; }
  v = +v; const t = today();
  if (S.halsa.somn[t] === v) delete S.halsa.somn[t]; else S.halsa.somn[t] = v;
  save(); render();
};
ACT.goReview = () => { UI.tab = 'idag'; UI.ovVy = 'vecka'; render(); };

/* ---------- KOST ---------- */
function viewKost() {
  const dag = UI.kostDag || today();
  setHeader('Kost', `Vecka ${isoWeek(dag)}`);
  const n = dayNut(dag);
  const meals = S.maltider.filter(m => m.datum === dag).sort((a, b) => (a.tid || '') < (b.tid || '') ? -1 : 1);
  const frittE = n.kcal ? Math.max(n.fritt, n.tillsatt) * 4 / n.kcal * 100 : null;
  let h = `<div class="daynav"><button class="icon-btn" data-a="kostDag" data-d="-1" aria-label="Föregående dag">${ICON.left}</button>
    <div class="d">${fmtDay(dag)}</div>
    <button class="icon-btn" data-a="kostDag" data-d="1" aria-label="Nästa dag" ${dag >= today() ? 'disabled style="opacity:.3"' : ''}>${ICON.right}</button></div>`;
  h += `<div class="card"><div class="macros">
      <div><div class="v num">${f0(n.kcal)}</div><div class="l">kcal</div></div>
      <div><div class="v num">${f0(n.prot)}</div><div class="l">protein</div></div>
      <div><div class="v num">${f0(n.kolh)}</div><div class="l">kolh</div></div>
      <div><div class="v num">${f0(n.fett)}</div><div class="l">fett</div></div>
      <div><div class="v num">${f0(n.fiber)}</div><div class="l">fiber</div></div></div>
    ${goalBar('Protein', n.prot, S.mal.protein, 'g')}${goalBar('Fiber', n.fiber, S.mal.fiber, 'g')}
    ${S.mal.kcal.max ? goalBar('Energi', n.kcal, S.mal.kcal, 'kcal') : ''}${S.mal.kolh.max ? goalBar('Kolhydrater', n.kolh, S.mal.kolh, 'g') : ''}
    ${goalBar('Fett', n.fett, S.mal.fett, 'g')}</div>`;
  h += `<div class="btns" style="margin-bottom:12px"><button class="btn pri" data-a="newMeal">${ICON.plus} Logga måltid</button><button class="btn" data-a="manageMallar">Mina måltider</button><button class="btn" data-a="photoMeal" aria-label="Fota måltid">📷</button></div>`;
  if (!meals.length) h += `<div class="empty">Inga måltider loggade ${dag === today() ? 'idag' : 'denna dag'}.<br>Välj en sparad måltid eller sök bland livsmedel.</div>`;
  else h += `<div class="list">${meals.map(m => { const mn = mealNut(m); const p = mealProfile(mn); return `<button class="li" data-a="editMeal" data-id="${m.id}">
      <div class="t"><div><b>${esc(m.typ)}</b> <span class="faint small">${esc(m.tid || '')}</span>${m.namn ? ` · ${esc(m.namn)}` : ''}${portionFactor(m) < 1 ? ` <span class="chip out">${f0(portionFactor(m) * 100)} % av sats</span>` : ''}</div>
      <div class="small muted num">${f0(mn.kcal)} kcal · P ${f0(mn.prot)} · K ${f0(mn.kolh)} · F ${f0(mn.fett)} · fiber ${f0(mn.fiber)}</div>
      <div style="margin-top:4px"><span class="chip ${p.cls}">${esc(p.t)}</span></div></div></button>`; }).join('')}</div>`;
  if (n.antal) {
    h += `<div class="sec">Fördelning ${dag === today() ? 'idag' : fmtDay(dag).toLowerCase()}</div>`;
    h += `<div class="card"><h3>Fettyper</h3>${stack([{ l: 'Mättat', v: n.matt, c: 'var(--c-n)' }, { l: 'Enkelomättat', v: n.enkel, c: 'var(--c-a)' }, { l: 'Fleromättat', v: n.fler, c: 'var(--c-b)' }])}
      <div class="note">Omega-3 totalt ${f1(n.o3)} g, varav långkedjiga (EPA/DHA/DPA) ${f2(n.o3lc)} g.</div></div>`;
    h += `<div class="card"><h3>Proteinkällor</h3>${stack([{ l: 'Animaliskt', v: n.protA, c: 'var(--c-a)' }, { l: 'Vegetabiliskt', v: n.protV, c: 'var(--c-b)' }, { l: 'Blandat/okänt', v: n.protM, c: 'var(--c-m)' }])}</div>`;
    h += `<div class="card"><h3>Kolhydrater och socker</h3>
      <div class="kv"><span>Kolhydrater totalt</span><span class="num">${f0(n.kolh)} g</span></div>
      <div class="kv"><span>– varav sockerarter</span><span class="num">${f1(n.socker)} g</span></div>
      <div class="kv"><span>– varav tillsatt socker</span><span class="num">${f1(n.tillsatt)} g</span></div>
      <div class="kv"><span>Fritt socker</span><span class="num">${f1(Math.max(n.fritt, n.tillsatt))} g${frittE != null ? ` (${f1(frittE)} E%)` : ''} ${frittE != null ? `<span class="chip ${frittE <= S.mal.frittSockerEP ? 'ok' : 'warn'}">mål &lt; ${S.mal.frittSockerEP} E%</span>` : ''}</span></div>
      <div class="kv"><span>Fiber</span><span class="num">${f1(n.fiber)} g</span></div>
      <div class="kv"><span>Fullkorn</span><span class="num">${f0(n.fullkorn)} g</span></div>
      <div class="kv"><span>Salt</span><span class="num">${f1(n.salt)} g</span></div>
      <div class="note">Sockerarter = naturligt och tillsatt. Fritt socker = tillsatt socker plus socker i juice, honung m.m. Värdena är uppskattningar.</div></div>`;
    if (n.fiber < (S.mal.fiber.min || 30) && dag === today()) h += fiberTips(S.mal.fiber.min - n.fiber);
  }
  h += `<div class="sec">Snabbval och planering</div><div class="list">
    <button class="li" data-a="manageMallar"><div class="t"><div>Mina måltider</div><div class="small muted">${S.mallar.length} st · bygg av vägda ingredienser, logga med ett tryck</div></div>${ICON.right.replace('<svg', '<svg width="18" height="18"')}</button>
    <button class="li" data-a="manageOwnFoods"><div class="t"><div>Egna livsmedel</div><div class="small muted">${S.egnaLivsmedel.length} st · från förpackningens näringsdeklaration</div></div>${ICON.right.replace('<svg', '<svg width="18" height="18"')}</button>
    <button class="li" data-a="shoppingList"><div class="t"><div>Inköpslista</div><div class="small muted">Välj sparade måltider och antal</div></div>${ICON.right.replace('<svg', '<svg width="18" height="18"')}</button>
    <button class="li" data-a="openExcl"><div class="t"><div>Livsmedel jag inte äter</div><div class="small muted">${S.uteslut.filter(c => c.aktiv).map(c => c.namn).join(', ')}</div></div>${ICON.right.replace('<svg', '<svg width="18" height="18"')}</button></div>`;
  return h;
}
function fiberTips(missing) {
  const tips = [['Chiafrö', 6157, 10], ['Havregryn fullkorn', 702, 40], ['Hårt bröd råg (knäcke)', 162, 25], ['Hallon', 0, 100], ['Broccoli', 325, 150], ['Potatis kokt med skal', 5153, 200]];
  const sugg = tips.map(([namn, id, g]) => { const f = getFood(id) || FOOD.list.find(x => x.lc.startsWith(namn.toLowerCase())); return f ? { f, g, fib: f.n[NI.fiber] * g / 100 } : null; }).filter(Boolean).filter(x => !exclInfo(x.f.id)?.hide.length).slice(0, 4);
  if (!sugg.length) return '';
  return `<div class="card soft"><h3>Fiber kvar till målet: ${f0(missing)} g</h3><div class="small muted" style="margin-bottom:6px">Förslag som passar dina uteslutna livsmedel:</div>
    ${sugg.map(s => `<div class="kv"><span>${esc(s.f.namn)} ${s.g} g</span><span>+${f1(s.fib)} g fiber</span></div>`).join('')}</div>`;
}
ACT.kostDag = el => { const d = addDays(UI.kostDag || today(), +el.dataset.d); if (d > today()) return; UI.kostDag = d; render(); };

/* ---------- måltidseditor ---------- */
let MEAL = null; // arbetskopia – loggad måltid eller (mallMode) en måltid i "Mina måltider"
let MEALSRC = { q: '', mode: 'snabb', showHidden: false };
const ENHETER = [['g', 'g'], ['dl', 'dl'], ['msk', 'msk'], ['tsk', 'tsk'], ['st', 'st']];
const ENHET_STD = { dl: 100, msk: 15, tsk: 5 };
const QUICK = { g: [10, 25, 50, 100], dl: [0.5, 1, 1.5, 2], msk: [1, 2, 3], tsk: [1, 2], st: [1, 2, 3] };
function guessType() { const h = new Date().getHours(); return h < 10 ? 'Frukost' : h < 11 ? 'Mellanmål' : h < 14 ? 'Lunch' : h < 17 ? 'Mellanmål' : h < 20 ? 'Middag' : 'Kvällsmål'; }
const qtyTxt = r => r.u && r.u !== 'g' ? `${f1(r.q)} ${r.u}` : `${f0(r.g)} g`;
function rowFromStored(r) { const s = snapRow(r.fid, r.g); if (!s) return null; if (r.u && r.u !== 'g') Object.assign(s, { u: r.u, q: r.q, conv: r.conv }); return s; }
const rowToStored = r => r.u && r.u !== 'g' ? { fid: r.fid, g: r.g, u: r.u, q: r.q, conv: r.conv } : { fid: r.fid, g: r.g };
ACT.newMeal = () => { MEAL = { id: null, datum: UI.tab === 'kost' ? (UI.kostDag || today()) : today(), tid: nowTime(), typ: guessType(), namn: '', rader: [] }; MEALSRC = { q: '', mode: 'snabb', showHidden: false }; openMealEditor(); };
ACT.editMeal = el => { const m = S.maltider.find(x => x.id === el.dataset.id); if (!m) return; MEAL = clone(m); MEALSRC = { q: '', mode: 'rader', showHidden: false }; openMealEditor(); };
function openMealEditor() {
  const mm = MEAL.mallMode;
  const title = mm ? (MEAL.id ? 'Redigera måltid' : 'Ny måltid i Mina måltider') : (MEAL.id ? 'Redigera loggad måltid' : 'Logga måltid');
  const foot = mm
    ? `${MEAL.id ? '<button class="btn danger" data-a="delMallEd">Ta bort</button>' : ''}<button class="btn" data-a="logFromMall">Logga nu</button><button class="btn pri" data-a="saveMallEd">Spara måltid</button>`
    : `${MEAL.id ? '<button class="btn danger" data-a="delMeal">Ta bort</button>' : ''}<button class="btn" data-a="saveAsMall">Spara i Mina måltider</button><button class="btn pri" data-a="saveMeal">Spara</button>`;
  openSheet(`${sheetHead(title)}<div class="sbody" id="mealBody"></div><div class="sf"><div class="btns">${foot}</div></div>`, { full: true, id: 'meal' });
  renderMealBody();
}
function mealRowsHtml() {
  if (!MEAL.rader.length) return `<div class="empty">Inga ingredienser ännu – sök och väg dem nedan.</div>`;
  return `<div class="list">${MEAL.rader.map((r, i) => { const x = exclInfo(r.fid); const unit = r.u && r.u !== 'g'; return `<div class="food" style="cursor:default">
    <div class="grow"><div class="n">${esc(r.namn)} ${x ? `<span class="chip ${x.hide.length ? 'bad' : 'warn'}" title="${esc([...x.hide, ...x.warn].join(', '))}">${ICON.warn}</span>` : ''}</div>
    <div class="m num" id="rm${i}">${rowMeta(r)}</div></div>
    <div class="qty"><input type="text" inputmode="decimal" value="${String(unit ? r.q : r.g).replace('.', ',')}" data-i="rowG" data-ix="${i}" aria-label="Mängd" onfocus="this.select()"><span class="small muted">${unit ? r.u : 'g'}</span>
    <button class="icon-btn" data-a="rowDel" data-ix="${i}" aria-label="Ta bort">${ICON.close}</button></div></div>`; }).join('')}</div>`;
}
function rowMeta(r) { return `${r.u && r.u !== 'g' ? f0(r.g) + ' g · ' : ''}${f0(r.n[0] * r.g / 100)} kcal · P ${f1(r.n[1] * r.g / 100)} · K ${f1(r.n[8] * r.g / 100)} · F ${f1(r.n[2] * r.g / 100)} · fib ${f1(r.n[12] * r.g / 100)}`; }
function mealSumHtml() {
  const n = mealNut(MEAL); const p = mealProfile(n), mm = MEAL.mallMode;
  return `<div class="card" style="margin-bottom:10px">${mm && portionFactor(MEAL) === 1 && MEAL.portion?.total ? '<div class="xs muted" style="margin-bottom:4px">Hela satsen</div>' : ''}<div class="macros">
    <div><div class="v num">${f0(n.kcal)}</div><div class="l">kcal</div></div><div><div class="v num">${f0(n.prot)}</div><div class="l">protein</div></div>
    <div><div class="v num">${f0(n.kolh)}</div><div class="l">kolh</div></div><div><div class="v num">${f0(n.fett)}</div><div class="l">fett</div></div>
    <div><div class="v num">${f1(n.fiber)}</div><div class="l">fiber</div></div></div>
    ${MEAL.rader.length ? `<span class="chip ${p.cls}">${esc(p.t)}</span>` : ''}
    ${!mm && portionFactor(MEAL) < 1 ? `<div class="note">Din portion: ${f0(MEAL.portion.ata)} av ${f0(MEAL.portion.total)} g (${f0(portionFactor(MEAL) * 100)} %) – värdena ovan gäller portionen.</div>` : ''}
    ${MEAL.rader.length ? `<div class="note">${MEAL.rader.length} ingredienser · råvaror totalt ${f0(sum(MEAL.rader.map(r => r.g)))} g${mm && MEAL.portion?.total ? ` · färdig rätt ${f0(MEAL.portion.total)} g` : ''}</div>` : ''}</div>`;
}
function renderMealBody() {
  const b = $('#mealBody'); if (!b) return;
  const mm = MEAL.mallMode;
  const mall = !mm && MEAL.fromMall ? S.mallar.find(m => m.id === MEAL.fromMall) : null;
  b.innerHTML = (mm ? `<label class="f" style="margin-top:0">Namn på måltiden</label><input type="text" id="mallNamn" value="${esc(MEAL.namn || '')}" placeholder="t.ex. Havregrynsgröt med chia" data-i="mealNamn" style="margin-bottom:10px">` : '')
    + `<div class="seg" style="margin-bottom:8px">${MALTYPER.map(t => `<button class="${t === MEAL.typ ? 'on' : ''}" data-a="mealType" data-v="${t}" style="font-size:12px;padding:7px 2px">${t}</button>`).join('')}</div>`
    + (mm ? '' : `<div class="inrow"><div><input type="date" value="${MEAL.datum}" max="${today()}" data-c="mealField" data-k="datum" aria-label="Datum"></div>
    <div><input type="time" value="${MEAL.tid}" data-c="mealField" data-k="tid" aria-label="Tid"></div></div>`)
    + `<button class="btn block" data-a="aiPhoto" style="margin-top:10px">📷 Fota måltid – AI föreslår innehåll</button>
    <div id="mealSum" style="margin-top:12px">${mealSumHtml()}</div>
    <div id="mealRows">${mealRowsHtml()}</div>
    ${mall ? `<label class="row" style="margin:-4px 2px 12px;gap:8px"><input type="checkbox" data-c="updMall" ${MEAL.updMall ? 'checked' : ''} style="width:20px;height:20px"><span class="small">Uppdatera "${esc(mall.namn)}" i Mina måltider med de här mängderna</span></label>` : ''}
    <div class="seg">${[['snabb', 'Mina måltider'], ['ofta', 'Ofta'], ['sok', 'Sök']].map(([k, l]) => `<button class="${MEALSRC.mode === k || (MEALSRC.mode === 'rader' && k === 'snabb') ? 'on' : ''}" data-a="mealMode" data-m="${k}">${l}</button>`).join('')}</div>
    <div id="weighCard" class="hidden"></div>
    <div id="mealPick"></div>
    <details class="card" ${MEAL.portion ? 'open' : ''} style="margin-top:12px"><summary>${mm ? 'Satsens färdiga vikt' : 'Del av en sats'}</summary>
      <div class="small muted" style="margin-top:6px">${mm ? 'Lagar du en hel sats? Ange vad den färdiga rätten brukar väga. När du loggar anger du bara vikten på din portion.' : 'Lagar du en hel sats, t.ex. en gryta? Väg alla råvaror ovan, väg sedan den färdiga rätten och din portion.'}</div>
      <div class="inrow"><div><label class="f">Färdig rätt totalt (g)</label><input type="text" inputmode="decimal" value="${MEAL.portion?.total ?? ''}" data-i="portionF" data-k="total"></div>
      ${mm ? '' : `<div><label class="f">Min portion (g)</label><input type="text" inputmode="decimal" value="${MEAL.portion?.ata ?? ''}" data-i="portionF" data-k="ata"></div>`}</div>
      <div class="note">Lämna tomt om du äter allt. Vatten som kokar bort påverkar inte näringen – bara hur stor andel du äter.</div></details>`;
  renderMealPick();
}
function refreshMealParts() { const s = $('#mealSum'); if (s) s.innerHTML = mealSumHtml(); }
function foodLine(f, extra = '') {
  const x = exclInfo(f.id);
  const flag = x ? (x.hide.length ? `<span class="chip bad">${esc(x.hide.join(', '))}</span>` : `<span class="chip warn">${ICON.warn} kan innehålla ${esc(x.warn.join(', ').toLowerCase())}</span>`) : '';
  return `<div class="food" data-a="addFood" data-fid="${f.id}">
    <div class="grow"><div class="n">${esc(f.namn)}</div><div class="m num">${f0(f.n[0])} kcal · P ${f1(f.n[1])} · K ${f1(f.n[8])} · F ${f1(f.n[2])} · fib ${f1(f.n[12])} /100 g ${extra}</div>${flag ? `<div style="margin-top:3px">${flag}</div>` : ''}</div>
    <span class="chip out">${ICON.plus.replace('<svg', '<svg width="14" height="14"')}</span></div>`;
}
function searchFoods(q, showHidden) {
  const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  const res = [];
  for (const f of FOOD.byId.values()) {
    if (!toks.every(t => f.lc.includes(t))) continue;
    const x = exclInfo(f.id); if (x && x.hide.length && !showHidden) continue;
    let sc = 0;
    if (f.egen) sc -= 1000;
    sc -= (S.anvandning[f.id]?.n || 0) * 20;
    if (f.lc === q.toLowerCase().trim()) sc -= 600;
    if (f.lc.startsWith(toks[0])) sc -= 200;
    if (x && x.warn.length) sc += 150;
    sc += f.lc.length;
    res.push([sc, f]);
  }
  return res.sort((a, b) => a[0] - b[0]).slice(0, 60).map(r => r[1]);
}
function mallNut(m) { return mealNut({ rader: m.rader.map(rowFromStored).filter(Boolean) }); }
const sortedMallar = () => [...S.mallar].sort((a, b) => (b.anv || 0) - (a.anv || 0) || a.namn.localeCompare(b.namn, 'sv'));
function renderMealPick() {
  const el = $('#mealPick'); if (!el) return;
  const mode = MEALSRC.mode === 'rader' ? 'snabb' : MEALSRC.mode;
  if (mode === 'snabb') {
    const list = sortedMallar().filter(m => !MEAL.mallMode || m.id !== MEAL.id);
    el.innerHTML = list.length ? `<div class="list">${list.map(m => { const n = mallNut(m); return `<button class="li" data-a="useMall" data-id="${m.id}"><div class="t"><div>${esc(m.namn)}</div><div class="small muted num">${f0(n.kcal)} kcal · P ${f0(n.prot)} · K ${f0(n.kolh)} · fiber ${f0(n.fiber)} · ${m.rader.length} ingredienser</div></div><span class="chip out">${ICON.plus.replace('<svg', '<svg width="14" height="14"')}</span></button>`; }).join('')}</div><div class="note">Ett tryck lägger till hela måltiden. Justera sedan mängderna ovan.</div>`
      : '<div class="empty">Inga sparade måltider ännu. Sök fram ingredienserna, väg dem och spara i Mina måltider.</div>';
  } else if (mode === 'ofta') {
    const top = Object.entries(S.anvandning).sort((a, b) => b[1].n - a[1].n).slice(0, 30).map(([fid, u]) => ({ f: getFood(isNaN(fid) ? fid : +fid), u })).filter(x => x.f);
    el.innerHTML = top.length ? `<div class="list">${top.map(x => foodLine(x.f, `· senast ${x.u.u && x.u.u !== 'g' ? f1(x.u.q) + ' ' + x.u.u : f0(x.u.g) + ' g'}`)).join('')}</div>` : '<div class="empty">Här samlas ingredienser du använder ofta.</div>';
  } else {
    el.innerHTML = `<input type="search" placeholder="Sök, t.ex. havregryn, chia, mjölk" value="${esc(MEALSRC.q)}" data-i="mealSearch" id="mealQ" autocomplete="off">
      <div class="row sb" style="margin:8px 2px"><span class="small muted">Visa även uteslutna</span><label class="tog"><input type="checkbox" ${MEALSRC.showHidden ? 'checked' : ''} data-c="mealShowHidden"><span></span></label></div>
      <div id="mealRes"></div><button class="btn block" data-a="newOwnFood" style="margin-top:8px">${ICON.plus} Nytt eget livsmedel</button>
      <div class="note">Källa: Livsmedelsverkets livsmedelsdatabas (CC BY 4.0). Uteslutna livsmedel döljs; ${ICON.warn} betyder att en ingrediens kan matcha din lista. Kontrollera alltid förpackningen.</div>`;
    renderMealRes();
  }
}
function renderMealRes() {
  const el = $('#mealRes'); if (!el) return;
  if (!FOOD.loaded) { el.innerHTML = '<div class="empty">Livsmedelsdatabasen kunde inte laddas. Egna livsmedel fungerar ändå.</div>'; }
  const r = searchFoods(MEALSRC.q, MEALSRC.showHidden);
  el.innerHTML = MEALSRC.q ? (r.length ? `<div class="list">${r.map(f => foodLine(f)).join('')}</div>` : '<div class="empty">Inga träffar. Prova ett kortare ord.</div>') : '';
}
ACT.mealMode = el => { MEALSRC.mode = el.dataset.m; $$('#mealBody .seg button[data-a="mealMode"]').forEach(b => b.classList.toggle('on', b === el)); renderMealPick(); if (MEALSRC.mode === 'sok') setTimeout(() => { const q = $('#mealQ'); if (q) { q.focus(); q.scrollIntoView({ block: 'start', behavior: 'smooth' }); } }, 60); };
ACT.mealSearch = el => { if (MEALSRC.pending) ACT.weighCancel(); MEALSRC.q = el.value; clearTimeout(ACT._ms); ACT._ms = setTimeout(renderMealRes, 120); };
ACT.mealShowHidden = el => { MEALSRC.showHidden = el.checked; renderMealRes(); };
ACT.mealField = el => { MEAL[el.dataset.k] = el.value; };
ACT.mealNamn = el => { MEAL.namn = el.value; };
ACT.updMall = el => { MEAL.updMall = el.checked; };
ACT.portionF = el => {
  const p = MEAL.portion || {}; p[el.dataset.k] = pnum(el.value);
  MEAL.portion = p.total || p.ata ? p : null; refreshMealParts();
};
ACT.mealType = el => { MEAL.typ = el.dataset.v; $$('[data-a="mealType"]').forEach(b => b.classList.toggle('on', b === el)); };

/* ---------- väg/mät en ingrediens ---------- */
ACT.addFood = el => {
  const fid = isNaN(el.dataset.fid) ? el.dataset.fid : +el.dataset.fid;
  const f = getFood(fid); if (!f) return;
  const last = S.anvandning[fid];
  MEALSRC.pending = fid; MEALSRC.unit = last?.u || 'g';
  const x = exclInfo(fid);
  const card = $('#weighCard');
  card.innerHTML = `<div class="card" style="border-color:var(--acc)">
    <div class="row sb"><div class="grow"><div class="b">${esc(f.namn)}</div><div class="xs muted">per 100 g: ${f0(f.n[0])} kcal · P ${f1(f.n[1])} · K ${f1(f.n[8])} · F ${f1(f.n[2])} · fiber ${f1(f.n[12])}</div></div>
    <button class="icon-btn" data-a="weighCancel" aria-label="Avbryt">${ICON.close}</button></div>
    ${x && x.hide.length ? `<div class="chip bad" style="margin-top:6px">${esc(x.hide.join(', '))}</div>` : x ? `<div class="chip warn" style="margin-top:6px">${ICON.warn} kan innehålla ${esc(x.warn.join(', ').toLowerCase())}</div>` : ''}
    <div class="seg" id="unitSeg" style="margin:10px 0 8px">${ENHETER.map(([k, l]) => `<button class="${k === MEALSRC.unit ? 'on' : ''}" data-a="weighUnit" data-u="${k}">${l}</button>`).join('')}</div>
    <div class="row" style="gap:8px"><input type="text" inputmode="decimal" autocomplete="off" id="weighG" value="" placeholder="Mängd" data-i="weighInput" style="font-size:22px;font-weight:600;text-align:right;flex:1"><span class="b" id="weighUnitLbl" style="min-width:44px"></span></div>
    <div id="convRow" class="row hidden" style="gap:8px;margin-top:8px"><span class="small" id="convLbl" style="flex:1"></span><input type="text" inputmode="decimal" id="weighConv" data-i="weighInput" style="width:90px;text-align:right"><span class="small">g</span></div>
    <div class="note hidden" id="convNote"></div>
    <div class="btns" id="weighQuick" style="margin-top:8px"></div>
    <div id="weighPrev" class="small muted num" style="margin:8px 0"></div>
    <button class="btn pri block" data-a="weighAdd">Lägg till</button></div>`;
  card.classList.remove('hidden');
  setWeighUnit(MEALSRC.unit, last);
  const inp = $('#weighG'); inp.focus(); inp.select();
  card.scrollIntoView({ block: 'start', behavior: 'smooth' });
};
function setWeighUnit(u, last) {
  MEALSRC.unit = u; const fid = MEALSRC.pending;
  $$('#unitSeg button').forEach(b => b.classList.toggle('on', b.dataset.u === u));
  $('#weighUnitLbl').textContent = u === 'g' ? 'gram' : u;
  const conv = (S.enheter[fid] || {})[u] ?? ENHET_STD[u] ?? '';
  $('#convRow').classList.toggle('hidden', u === 'g');
  $('#convLbl').textContent = `1 ${u} väger`;
  $('#weighConv').value = u === 'g' ? '' : String(conv).replace('.', ',');
  const note = $('#convNote'); const known = (S.enheter[fid] || {})[u] != null;
  note.classList.toggle('hidden', u === 'g');
  note.textContent = known ? 'Sparad omräkning för det här livsmedlet – ändra om den inte stämmer.' : u === 'st' ? 'Väg en bit en gång och skriv in vikten – den sparas för nästa gång.' : `Standard ${ENHET_STD[u]} g (som vatten). Torra varor väger mindre – t.ex. havregryn ca 35 g/dl. Justeringen sparas för det här livsmedlet.`;
  if (last && (last.u || 'g') === u) $('#weighG').value = String(u === 'g' ? last.g : last.q).replace('.', ',');
  $('#weighQuick').innerHTML = QUICK[u].map(v => `<button class="btn sm" style="white-space:nowrap" data-a="weighQuick" data-g="${v}">${f1(v)} ${u}</button>`).join('');
  updateWeighPrev();
}
ACT.weighUnit = el => { setWeighUnit(el.dataset.u); $('#weighG').focus(); };
function weighGrams() {
  const q = pnum($('#weighG')?.value); if (!q) return null;
  if (MEALSRC.unit === 'g') return { g: q };
  const conv = pnum($('#weighConv').value); if (!conv) return { q, need: true };
  return { g: q * conv, q, conv };
}
function updateWeighPrev() {
  const f = getFood(MEALSRC.pending), el = $('#weighPrev'); if (!f || !el) return;
  const w = weighGrams();
  el.innerHTML = !w ? 'Ange mängden du vägt eller mätt upp.' : w.need ? `Ange hur mycket 1 ${MEALSRC.unit} väger.` : `${MEALSRC.unit !== 'g' ? f1(w.q) + ' ' + MEALSRC.unit + ' = ' : ''}${f0(w.g)} g ger ${f0(f.n[0] * w.g / 100)} kcal · protein ${f1(f.n[1] * w.g / 100)} g · kolh ${f1(f.n[8] * w.g / 100)} g · fett ${f1(f.n[2] * w.g / 100)} g · fiber ${f1(f.n[12] * w.g / 100)} g`;
}
ACT.weighInput = () => updateWeighPrev();
ACT.weighQuick = el => { $('#weighG').value = el.dataset.g.replace('.', ','); updateWeighPrev(); };
ACT.weighCancel = () => { MEALSRC.pending = null; const c = $('#weighCard'); c.innerHTML = ''; c.classList.add('hidden'); };
ACT.weighAdd = () => {
  const w = weighGrams();
  if (!w) { toast('Ange en mängd'); $('#weighG').focus(); return; }
  if (w.need) { toast(`Ange vad 1 ${MEALSRC.unit} väger`); $('#weighConv').focus(); return; }
  const r = snapRow(MEALSRC.pending, Math.round(w.g * 10) / 10); if (!r) return;
  if (MEALSRC.unit !== 'g') { Object.assign(r, { u: MEALSRC.unit, q: w.q, conv: w.conv }); S.enheter[r.fid] = { ...(S.enheter[r.fid] || {}), [MEALSRC.unit]: w.conv }; save({ noSync: true }); }
  MEAL.rader.push(r); ACT.weighCancel();
  $('#mealRows').innerHTML = mealRowsHtml(); refreshMealParts();
  toast(`${r.namn} ${qtyTxt(r)} tillagd`, 1400);
  const q = $('#mealQ'); if (q) { q.focus(); q.select(); }
};
ACT.useMall = el => {
  const m = S.mallar.find(x => x.id === el.dataset.id); if (!m) return;
  m.rader.forEach(r => { const s = rowFromStored(r); if (s) MEAL.rader.push(s); });
  if (!MEAL.mallMode) { if (!MEAL.namn) MEAL.namn = m.namn; if (!MEAL.fromMall) MEAL.fromMall = m.id; if (m.portion?.total && !MEAL.portion) MEAL.portion = { total: m.portion.total, ata: null }; }
  renderMealBody(); toast(`${m.namn} tillagd`, 1200);
};
ACT.rowG = el => {
  const v = pnum(el.value); if (v == null) return; const i = +el.dataset.ix, r = MEAL.rader[i];
  if (r.u && r.u !== 'g') { r.q = v; r.g = Math.round(v * r.conv * 10) / 10; } else r.g = v;
  const m = $('#rm' + i); if (m) m.innerHTML = rowMeta(r); refreshMealParts();
};
ACT.rowDel = el => { MEAL.rader.splice(+el.dataset.ix, 1); $('#mealRows').innerHTML = mealRowsHtml(); refreshMealParts(); };
function noteUsage(rows) { rows.forEach(r => { const u = S.anvandning[r.fid] || { n: 0 }; u.n++; u.g = r.g; if (r.u && r.u !== 'g') { u.u = r.u; u.q = r.q; } else { delete u.u; delete u.q; } S.anvandning[r.fid] = u; }); }

/* ---------- spara loggad måltid ---------- */
ACT.saveMeal = () => {
  if (!MEAL.rader.length) { toast('Lägg till minst en ingrediens'); return; }
  noteUsage(MEAL.rader);
  const isNew = !MEAL.id;
  if (MEAL.fromMall) {
    const m = S.mallar.find(x => x.id === MEAL.fromMall);
    if (m) { if (isNew) m.anv = (m.anv || 0) + 1; if (MEAL.updMall) { m.rader = MEAL.rader.map(rowToStored); if (MEAL.portion?.total) m.portion = { total: MEAL.portion.total }; } }
  }
  const updated = MEAL.updMall; delete MEAL.updMall;
  if (isNew) { MEAL.id = uid(); S.maltider.push(MEAL); } else { const i = S.maltider.findIndex(x => x.id === MEAL.id); S.maltider[i] = MEAL; }
  save(); closeSheet(); UI.kostDag = MEAL.datum; render(); toast(updated ? 'Måltiden sparad och Mina måltider uppdaterad' : 'Måltiden sparad');
};
ACT.delMeal = () => confirmBox('Ta bort den loggade måltiden?', 'Ta bort', () => { S.maltider = S.maltider.filter(x => x.id !== MEAL.id); save(); render(); });
ACT.saveAsMall = () => {
  if (!MEAL.rader.length) { toast('Lägg till ingredienser först'); return; }
  const namn = prompt('Namn i Mina måltider', MEAL.namn || MEAL.typ); if (!namn) return;
  const m = { id: uid(), namn: namn.trim(), typ: MEAL.typ, rader: MEAL.rader.map(rowToStored), portion: MEAL.portion?.total ? { total: MEAL.portion.total } : null, anv: 1 };
  S.mallar.push(m); MEAL.namn = m.namn; MEAL.fromMall = m.id; save(); toast(`"${m.namn}" sparad i Mina måltider`);
};

/* ---------- Mina måltider ---------- */
ACT.manageMallar = () => {
  const list = sortedMallar();
  openSheet(`${sheetHead('Mina måltider')}<div class="sbody">
    <p class="small muted" style="margin-top:0">Bygg dina vanliga måltider av ingredienser du väger eller mäter. Logga dem sedan med ett tryck och justera mängderna vid behov.</p>
    <button class="btn pri block" data-a="newMall" style="margin-bottom:12px">${ICON.plus} Ny måltid</button>
    ${list.length ? `<div class="list">${list.map(m => { const n = mallNut(m); return `<div class="li" style="cursor:default;align-items:flex-start">
      <button class="t" data-a="editMall" data-id="${m.id}" style="background:none;border:0;text-align:left;padding:0;cursor:pointer;color:inherit;font:inherit">
        <div><b>${esc(m.namn)}</b> <span class="chip out">${esc(m.typ || '')}</span></div>
        <div class="small muted num">${f0(n.kcal)} kcal · P ${f0(n.prot)} · K ${f0(n.kolh)} · F ${f0(n.fett)} · fiber ${f1(n.fiber)}</div>
        <div class="xs faint">${m.rader.map(r => esc((getFood(r.fid)?.namn || '?').split(/[ ,]/)[0]) + ' ' + qtyTxt(r)).join(' · ')}${m.portion?.total ? ` · sats ${f0(m.portion.total)} g` : ''}${m.anv ? ` · loggad ${m.anv} ggr` : ''}</div></button>
      <button class="btn sm pri" data-a="logMall" data-id="${m.id}" style="flex:0 0 auto">Logga</button></div>`; }).join('')}</div>` : '<div class="empty">Inga måltider ännu. Tryck "Ny måltid" och lägg till ingredienserna en i taget.</div>'}</div>`, { id: 'mallar' });
};
ACT.newMall = () => { MEAL = { mallMode: true, id: null, namn: '', typ: guessType(), rader: [], portion: null }; MEALSRC = { q: '', mode: 'sok', showHidden: false }; openMealEditor(); setTimeout(() => $('#mallNamn')?.focus(), 80); };
ACT.editMall = el => {
  const m = S.mallar.find(x => x.id === el.dataset.id); if (!m) return;
  MEAL = { mallMode: true, id: m.id, namn: m.namn, typ: m.typ || guessType(), rader: m.rader.map(rowFromStored).filter(Boolean), portion: m.portion ? { ...m.portion } : null };
  MEALSRC = { q: '', mode: 'sok', showHidden: false }; openMealEditor();
};
function mallFromEditor() {
  const namn = (MEAL.namn || '').trim();
  if (!namn) { toast('Ge måltiden ett namn'); $('#mallNamn')?.focus(); return null; }
  if (!MEAL.rader.length) { toast('Lägg till minst en ingrediens'); return null; }
  const old = MEAL.id ? S.mallar.find(x => x.id === MEAL.id) : null;
  const m = { id: MEAL.id || uid(), namn, typ: MEAL.typ, rader: MEAL.rader.map(rowToStored), portion: MEAL.portion?.total ? { total: MEAL.portion.total } : null, anv: old?.anv || 0 };
  if (old) S.mallar[S.mallar.indexOf(old)] = m; else S.mallar.push(m);
  save(); return m;
}
ACT.saveMallEd = () => { const m = mallFromEditor(); if (!m) return; closeSheet(); render(); ACT.manageMallar(); toast(`"${m.namn}" sparad`); };
function logFromMallObj(m) {
  MEAL = { id: null, datum: UI.tab === 'kost' ? (UI.kostDag || today()) : today(), tid: nowTime(), typ: m.typ || guessType(), namn: m.namn, fromMall: m.id, rader: m.rader.map(rowFromStored).filter(Boolean), portion: m.portion?.total ? { total: m.portion.total, ata: null } : null };
  MEALSRC = { q: '', mode: 'rader', showHidden: false }; openMealEditor();
  if (MEAL.portion) toast('Ange vikten på din portion under "Del av en sats"', 3000);
}
ACT.logFromMall = () => { const m = mallFromEditor(); if (m) logFromMallObj(m); };
ACT.logMall = el => { const m = S.mallar.find(x => x.id === el.dataset.id); if (m) logFromMallObj(m); };
ACT.delMallEd = () => confirmBox(`Ta bort "${MEAL.namn}" från Mina måltider? Redan loggade måltider påverkas inte.`, 'Ta bort', () => { S.mallar = S.mallar.filter(m => m.id !== MEAL.id); save(); render(); ACT.manageMallar(); });

/* ---------- inköpslista ---------- */
let SHOP = {};
ACT.shoppingList = () => {
  const body = () => {
    const tot = {};
    S.mallar.forEach(m => { const k = SHOP[m.id] || 0; if (k) m.rader.forEach(r => { tot[r.fid] = (tot[r.fid] || 0) + r.g * k; }); });
    const rows = Object.entries(tot).map(([fid, g]) => ({ namn: getFood(isNaN(fid) ? fid : +fid)?.namn || '?', g })).sort((a, b) => a.namn.localeCompare(b.namn, 'sv'));
    return `<div class="list">${S.mallar.map(m => `<div class="food" style="cursor:default"><div class="grow n">${esc(m.namn)}</div>
      <div class="qty"><button class="btn sm" data-a="shopAdj" data-id="${m.id}" data-d="-1">−</button><span class="num b" style="min-width:24px;text-align:center">${SHOP[m.id] || 0}</span><button class="btn sm" data-a="shopAdj" data-id="${m.id}" data-d="1">+</button></div></div>`).join('')}</div>
      <div class="sec">Att handla (råvaruvikt enligt databasen)</div>
      ${rows.length ? `<div class="card" id="shopTxt">${rows.map(r => `<div class="kv"><span>${esc(r.namn)}</span><span class="num">${r.g >= 1000 ? f1(r.g / 1000) + ' kg' : f0(r.g) + ' g'}</span></div>`).join('')}</div>
      <button class="btn block" data-a="shopCopy">Kopiera lista</button>` : '<div class="empty">Välj antal portioner ovan.</div>'}
      <div class="note">Mängderna utgår från tillagad vikt där livsmedlet är tillagat (t.ex. kokt ris) – justera vid inköp.</div>`;
  };
  ACT._shopBody = body;
  openSheet(`${sheetHead('Inköpslista')}<div class="sbody" id="shopBody">${body()}</div>`);
};
ACT.shopAdj = el => { SHOP[el.dataset.id] = Math.max(0, (SHOP[el.dataset.id] || 0) + +el.dataset.d); $('#shopBody').innerHTML = ACT._shopBody(); };
ACT.shopCopy = async () => { const t = $$('#shopTxt .kv').map(k => k.innerText.replace('\n', ' – ').replace('\t', ' – ')).join('\n'); try { await navigator.clipboard.writeText(t); toast('Listan kopierad'); } catch { toast('Kunde inte kopiera'); } };

/* ---------- egna livsmedel ---------- */
const OWN_FIELDS = [['kcal', 'Energi (kcal)'], ['prot', 'Protein (g)'], ['fett', 'Fett (g)'], ['matt', '– varav mättat (g)'], ['enkel', '– varav enkelomättat (g)'], ['fler', '– varav fleromättat (g)'], ['o3', 'Omega-3 (g)'], ['kolh', 'Kolhydrater (g)'], ['socker', '– varav sockerarter (g)'], ['tillsatt', 'Tillsatt socker (g)'], ['fiber', 'Fiber (g)'], ['fullkorn', 'Fullkorn (g)'], ['salt', 'Salt (g)']];
let OWN = null;
ACT.manageOwnFoods = () => {
  openSheet(`${sheetHead('Egna livsmedel')}<div class="sbody">
    ${S.egnaLivsmedel.length ? `<div class="list">${S.egnaLivsmedel.map(e => `<button class="li" data-a="editOwnFood" data-id="${e.id}"><div class="t"><div>${esc(e.namn)}</div><div class="small muted num">${f0(e.n[0])} kcal · P ${f1(e.n[1])} · K ${f1(e.n[8])} · F ${f1(e.n[2])} /100 g</div></div></button>`).join('')}</div>` : '<div class="empty">Inga egna livsmedel ännu.</div>'}
    <button class="btn pri block" data-a="newOwnFood">${ICON.plus} Nytt eget livsmedel</button></div>`);
};
ACT.newOwnFood = () => { OWN = { id: 'e:' + uid(), namn: '', n: new Array(15).fill(0), a: 2, taggar: [], kalla: 'Egen (förpackning)', ny: true }; ownFoodForm(); };
ACT.editOwnFood = el => { OWN = clone(S.egnaLivsmedel.find(e => e.id === el.dataset.id)); ownFoodForm(); };
function ownFoodForm() {
  const back = UI.sheet === 'meal';
  if (back) ACT._mealBackup = MEAL;
  openSheet(`${sheetHead(OWN.ny ? 'Nytt eget livsmedel' : 'Redigera livsmedel')}<div class="sbody">
    <label class="f">Namn</label><input type="text" id="ownName" value="${esc(OWN.namn)}" placeholder="Proteinbröd, Arla laktosfri kvarg">
    <div class="note">Ange värden per 100 g från förpackningens näringsdeklaration.</div>
    <div class="grid2">${OWN_FIELDS.map(([k, l]) => `<div><label class="f">${l}</label><input type="number" inputmode="decimal" step="any" data-own="${k}" value="${OWN.n[NI[k]] || ''}"></div>`).join('')}</div>
    <label class="f">Proteinkälla</label><select id="ownA"><option value="1" ${OWN.a === 1 ? 'selected' : ''}>Animaliskt</option><option value="0" ${OWN.a === 0 ? 'selected' : ''}>Vegetabiliskt</option><option value="2" ${OWN.a === 2 ? 'selected' : ''}>Blandat/okänt</option></select>
    <label class="f">Innehåller</label>${S.uteslut.map(c => `<label class="row" style="padding:6px 0"><input type="checkbox" data-owntag="${c.id}" ${OWN.taggar.includes(c.id) ? 'checked' : ''}> ${esc(c.namn)}</label>`).join('')}
    <div class="note">Källa: ${esc(OWN.kalla || 'Egen')}</div></div>
    <div class="sf"><div class="btns">${!OWN.ny ? '<button class="btn danger" data-a="delOwnFood">Ta bort</button>' : ''}<button class="btn pri" data-a="saveOwnFood">Spara</button></div></div>`, { id: 'own', onClose: back ? () => { MEAL = ACT._mealBackup; setTimeout(() => { openMealEditor(); }, 0); } : null });
}
ACT.saveOwnFood = () => {
  const namn = $('#ownName').value.trim(); if (!namn) { toast('Ange ett namn'); return; }
  OWN.namn = namn; $$('[data-own]').forEach(i => { OWN.n[NI[i.dataset.own]] = pnum(i.value) || 0; });
  OWN.n[NI.fritt] = OWN.n[NI.tillsatt];
  OWN.a = +$('#ownA').value; OWN.taggar = $$('[data-owntag]').filter(i => i.checked).map(i => i.dataset.owntag);
  const isNew = OWN.ny; delete OWN.ny;
  if (isNew) S.egnaLivsmedel.push(OWN); else S.egnaLivsmedel[S.egnaLivsmedel.findIndex(e => e.id === OWN.id)] = OWN;
  refreshOwnFoods(); buildExclusionIndex(); save();
  if (ACT._mealBackup && isNew) { ACT._mealBackup.rader.push(snapRow(OWN.id, 100)); }
  closeSheet(); ACT._mealBackup = null; if (UI.sheet !== 'meal') { render(); } toast('Sparat');
};
ACT.delOwnFood = () => confirmBox(`Ta bort "${OWN.namn}"? Loggade måltider påverkas inte.`, 'Ta bort', () => { S.egnaLivsmedel = S.egnaLivsmedel.filter(e => e.id !== OWN.id); refreshOwnFoods(); buildExclusionIndex(); save(); render(); });

/* ---------- uteslutna livsmedel ---------- */
ACT.openExcl = () => {
  openSheet(`${sheetHead('Livsmedel jag inte äter')}<div class="sbody">
    <div class="note" style="margin-bottom:8px">Sökningen döljer livsmedel vars namn eller livsmedelsgrupp matchar. Om bara en ingrediens matchar visas livsmedlet med en varning. Sökord och undantag kan redigeras – separera med komma.</div>
    ${S.uteslut.map((c, i) => `<details class="card"><summary><span class="row sb" style="display:inline-flex;width:calc(100% - 20px)"><span>${esc(c.namn)}</span><span class="chip ${c.aktiv ? 'ok' : 'out'}">${c.aktiv ? 'På' : 'Av'}</span></span></summary>
      <label class="row sb" style="margin-top:10px"><span>Aktiv</span><span class="tog"><input type="checkbox" data-exa="${i}" ${c.aktiv ? 'checked' : ''}><span></span></span></label>
      <label class="f">Namn</label><input type="text" data-exn="${i}" value="${esc(c.namn)}">
      <label class="f">Sökord</label><textarea data-exo="${i}">${esc(c.ord.join(', '))}</textarea>
      <label class="f">Undantag (matchas inte)</label><textarea data-exu="${i}">${esc((c.undantag || []).join(', '))}</textarea>
      ${(c.grupper || []).length ? `<div class="note">Även hela grupper: ${esc(c.grupper.join(', '))}</div>` : ''}
      <button class="btn danger sm" data-a="exclDel" data-ix="${i}" style="margin-top:8px">Ta bort kategori</button></details>`).join('')}
    <button class="btn block" data-a="exclAdd">${ICON.plus} Ny kategori</button></div>
    <div class="sf"><button class="btn pri block" data-a="exclSave">Spara</button></div>`);
};
function readExclForm() {
  S.uteslut.forEach((c, i) => {
    const a = $(`[data-exa="${i}"]`); if (!a) return;
    c.aktiv = a.checked; c.namn = $(`[data-exn="${i}"]`).value.trim() || c.namn;
    c.ord = $(`[data-exo="${i}"]`).value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    c.undantag = $(`[data-exu="${i}"]`).value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  });
}
ACT.exclAdd = () => { readExclForm(); S.uteslut.push({ id: uid(), namn: 'Ny kategori', ord: [], undantag: [], grupper: [], aktiv: true }); ACT.openExcl(); };
ACT.exclDel = el => { readExclForm(); S.uteslut.splice(+el.dataset.ix, 1); ACT.openExcl(); };
ACT.exclSave = () => { readExclForm(); buildExclusionIndex(); save(); closeSheet(); render(); toast('Sparat'); };

/* ---------- TRÄNING ---------- */
const ovn = id => S.ovningar.find(o => o.id === id);
const repTop = mal => { const m = String(mal || '').match(/(\d+)\s*[-–]\s*(\d+)/); return m ? +m[2] : (parseInt(mal) || null); };
function lastPerf(oid, excludeId) {
  const ps = S.pass.filter(p => p.id !== excludeId && p.ovn.some(e => e.oid === oid && e.set.some(s => s.klar))).sort((a, b) => (a.datum + (a.start || '')) < (b.datum + (b.start || '')) ? 1 : -1);
  if (!ps.length) return null;
  const p = ps[0]; const e = p.ovn.find(e => e.oid === oid);
  return { datum: p.datum, set: e.set.filter(s => s.klar), rpe: e.rpe, smarta: e.smarta, passId: p.id };
}
function fmtSet(o, s) {
  if (!s) return '';
  if (o.typ === 'tid') return `${f0(s.sek)} s`;
  if (o.typ === 'viktTid') return `${f1(s.kg)} kg · ${f0(s.sek)} s`;
  if (o.typ === 'kropp') return `${f0(s.reps)}${s.kg ? ' +' + f1(s.kg) + ' kg' : ''}`;
  return `${f1(s.kg)} kg × ${f0(s.reps)}`;
}
function afterPause(datum) { // första passet efter en avslutad paus
  const p = S.pauser.filter(x => x.till && x.till < datum).sort((a, b) => a.till < b.till ? 1 : -1)[0];
  if (!p) return false;
  return !S.pass.some(x => x.datum > p.till && x.datum < datum);
}
function progressionHint(o, mal, last) {
  if (!last || last.smarta || !o) return null;
  if (activePause() || afterPause(today())) return null;
  const top = repTop(mal);
  if (o.typ === 'tid') return last.set.every(s => s.sek >= (top || 999)) ? '+5 s' : null;
  if (!top) return null;
  const allTop = last.set.length && last.set.every(s => (s.reps || 0) >= top);
  if (!allTop || (last.rpe && last.rpe > 8)) return null;
  if (o.typ === 'kropp') return '+1–2 reps eller extra vikt';
  return o.steg ? `+${f1(o.steg)} kg` : null;
}
function viewTraning() {
  const t = today(), ws = weekStart(t), pause = activePause();
  setHeader('Träning', `Vecka ${isoWeek(t)}`);
  const kt = kondTarget(t), wk = weekKond(ws), wp = weekPass(ws);
  let h = '';
  if (S.aktivtPass) h += `<div class="banner info row sb"><span>Pågående: <b>${esc(S.aktivtPass.namn)}</b></span><button class="btn sm pri" data-a="resumePass">Fortsätt</button></div>`;
  h += `<div class="week">${[0, 1, 2, 3, 4, 5, 6].map(i => { const d = addDays(ws, i); const s = S.pass.some(p => p.datum === d), k = S.kondition.some(x => x.datum === d), pz = activePause(d) && d <= t; return `<div class="d ${d === t ? 'today' : ''}">${DAG_K[i]}<div class="dots">${s ? '<i class="dot s"></i>' : ''}${k ? '<i class="dot k"></i>' : ''}${pz ? '<i class="dot p"></i>' : ''}${!s && !k && !pz ? '<i class="dot"></i>' : ''}</div></div>`; }).join('')}</div>
  <div class="legend" style="margin:-6px 2px 12px"><span style="--c:var(--acc)">Styrka</span><span style="--c:transparent;display:inline-flex;align-items:center"><i class="dot k" style="margin-right:5px;margin-left:-13px"></i>Kondition</span><span style="--c:var(--faint)">Paus</span></div>`;
  if (pause) h += `<div class="banner warn"><b>Pausläge</b> sedan ${fmtD(pause.fran)} – ${esc(pause.orsak)}.<br>Veckomål och viktökningsförslag är pausade. Kosten påverkas inte.<div style="margin-top:8px"><button class="btn sm" data-a="endPause">Avsluta paus</button></div></div>`;
  else {
    h += `<div class="card"><div class="row sb"><span>Styrkepass</span><span class="num small muted">${wp.length} / ${rangeTxt(S.mal.styrkaPass)}</span></div>${bar(wp.length, S.mal.styrkaPass.max, S.mal.styrkaPass.min)}
      <div class="row sb" style="margin-top:6px"><span>Kondition (måttlig+)</span><span class="num small muted">${f0(wk.min)} / ${kt.min === kt.max ? kt.max : kt.min + '–' + kt.max} min</span></div>${bar(wk.min, kt.max, kt.min !== kt.max ? kt.min : null)}
      <div class="note">Upptrappning vecka ${kt.vecka}. Promenader efter måltid: ${wk.promenader} st (${f0(wk.promMin)} min). Lätt aktivitet som inte räknas: ${f0(wk.latt)} min.</div></div>`;
    if (afterPause(t)) h += `<div class="banner info">Första passet efter paus – börja gärna lite lättare än förra gången.</div>`;
  }
  h += `<div class="btns" style="margin-bottom:12px"><button class="btn pri" data-a="startPassPick">${ICON.play} Starta pass</button><button class="btn" data-a="addKond">${ICON.plus} Kondition</button></div>`;
  h += `<div class="btns" style="margin-bottom:6px"><button class="btn sm" data-a="quickWalk">${ICON.walk} Promenad efter måltid</button>${pause ? '' : '<button class="btn sm" data-a="startPause">Pausläge</button>'}</div>`;
  const recent = [...S.pass.map(p => ({ k: 's', d: p.datum, t: p.start || '', p })), ...S.kondition.map(k => ({ k: 'k', d: k.datum, t: '', p: k }))].sort((a, b) => (a.d + a.t) < (b.d + b.t) ? 1 : -1).slice(0, 15);
  h += `<div class="sec">Senaste aktiviteter</div>`;
  h += recent.length ? `<div class="list">${recent.map(r => r.k === 's' ? `<button class="li" data-a="viewPass" data-id="${r.p.id}"><div class="t"><div><b>${esc(r.p.namn)}</b> <span class="faint small">${fmtDay(r.d)}</span></div><div class="small muted">${r.p.ovn.filter(e => e.set.some(s => s.klar)).length} övningar · ${sum(r.p.ovn.map(e => e.set.filter(s => s.klar).length))} set · volym ${f0(passVolume(r.p))} kg${r.p.min ? ` · ${r.p.min} min` : ''}</div></div></button>`
    : `<button class="li" data-a="editKond" data-id="${r.p.id}"><div class="t"><div><b>${esc(r.p.typ)}</b> <span class="faint small">${fmtDay(r.d)}</span></div><div class="small muted">${r.p.min} min · ${esc(r.p.intensitet)}${r.p.efterMaltid ? ' · efter måltid' : ''}</div></div></button>`).join('')}</div>` : '<div class="empty">Inga aktiviteter ännu.</div>';
  h += `<div class="sec">Program</div><div class="list">
    <button class="li" data-a="manageMallarPass"><div class="t"><div>Passmallar</div><div class="small muted">${S.passmallar.map(m => m.namn).join(', ')}</div></div></button>
    <button class="li" data-a="manageOvn"><div class="t"><div>Övningsbibliotek</div><div class="small muted">${S.ovningar.filter(o => o.aktiv).length} övningar i ${MUSKLER.length} muskelgrupper</div></div></button>
    <button class="li" data-a="pauseHistory"><div class="t"><div>Pausperioder</div><div class="small muted">${S.pauser.length} st</div></div></button></div>`;
  return h;
}
function passVolume(p) {
  return sum(p.ovn.map(e => { const o = ovn(e.oid); if (!o || o.typ === 'tid' || o.typ === 'viktTid') return 0; return sum(e.set.filter(s => s.klar).map(s => (s.kg || 0) * (s.reps || 0))); }));
}

/* ---------- pausläge ---------- */
ACT.startPause = () => {
  openSheet(`${sheetHead('Starta pausläge')}<div class="sbody"><p class="small muted">Under pausen räknas inga träningsmål och appen föreslår inga viktökningar. Kostloggen fungerar som vanligt.</p>
    <label class="f">Orsak</label><select id="pzO"><option>Sjukdom</option><option>Skada</option><option>Vila/återhämtning</option><option>Resa</option><option>Annat</option></select>
    <label class="f">Från</label><input type="date" id="pzF" value="${today()}">
    <label class="f">Anteckning</label><input type="text" id="pzN" placeholder="Valfritt"></div>
    <div class="sf"><button class="btn pri block" data-a="savePause">Starta paus</button></div>`);
};
ACT.savePause = () => { S.pauser.push({ id: uid(), fran: $('#pzF').value || today(), till: null, orsak: $('#pzO').value, not: $('#pzN').value }); save(); closeSheet(); render(); toast('Pausläge på'); };
ACT.endPause = () => { const p = activePause(); if (!p) return; p.till = today() > p.fran ? addDays(today(), -1) : p.fran; save(); render(); toast('Pausen avslutad – välkommen tillbaka'); };
ACT.pauseHistory = () => openSheet(`${sheetHead('Pausperioder')}<div class="sbody">${S.pauser.length ? `<div class="list">${[...S.pauser].reverse().map(p => `<div class="li" style="cursor:default"><div class="t"><div>${esc(p.orsak)}</div><div class="small muted">${fmtD(p.fran)} – ${p.till ? fmtD(p.till) : 'pågår'}${p.not ? ' · ' + esc(p.not) : ''}</div></div><button class="icon-btn" data-a="delPause" data-id="${p.id}">${ICON.trash}</button></div>`).join('')}</div>` : '<div class="empty">Inga pauser.</div>'}</div>`);
ACT.delPause = el => { S.pauser = S.pauser.filter(p => p.id !== el.dataset.id); save(); ACT.pauseHistory(); render(); };

/* ---------- kondition ---------- */
let KOND = null;
ACT.quickWalk = () => { KOND = { id: null, datum: today(), typ: 'Rask promenad', min: 15, intensitet: 'Måttlig', efterMaltid: true, not: '' }; kondForm(); };
ACT.addKond = () => { KOND = { id: null, datum: today(), typ: 'Rask promenad', min: 30, intensitet: 'Måttlig', efterMaltid: false, not: '' }; kondForm(); };
ACT.editKond = el => { KOND = clone(S.kondition.find(k => k.id === el.dataset.id)); kondForm(); };
function kondForm() {
  openSheet(`${sheetHead(KOND.id ? 'Redigera kondition' : (KOND.efterMaltid ? 'Promenad efter måltid' : 'Logga kondition'))}<div class="sbody">
    <label class="f">Typ</label><select id="kTyp">${KOND_TYPER.map(t => `<option ${t === KOND.typ ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <label class="f">Minuter</label><div class="btns">${[10, 15, 20, 30, 35, 45, 60].map(m => `<button class="btn sm ${KOND.min === m ? 'pri' : ''}" data-a="kMin" data-v="${m}">${m}</button>`).join('')}</div>
    <input type="number" inputmode="numeric" id="kMin" value="${KOND.min}" style="margin-top:8px">
    <label class="f">Intensitet</label><div class="seg" id="kInt">${['Lätt', 'Måttlig', 'Hög'].map(i => `<button class="${KOND.intensitet === i ? 'on' : ''}" data-a="kInt" data-v="${i}">${i}</button>`).join('')}</div>
    <div class="note" style="margin-top:-6px">Måttlig = lätt andfådd men kan föra ett samtal. Lätt aktivitet räknas inte mot konditionsmålet.</div>
    <label class="row sb" style="margin-top:12px"><span>Efter måltid</span><span class="tog"><input type="checkbox" id="kEM" ${KOND.efterMaltid ? 'checked' : ''}><span></span></span></label>
    <div class="inrow"><div><label class="f">Datum</label><input type="date" id="kDat" value="${KOND.datum}" max="${today()}"></div></div>
    <label class="f">Anteckning</label><input type="text" id="kNot" value="${esc(KOND.not || '')}" placeholder="Valfritt"></div>
    <div class="sf"><div class="btns">${KOND.id ? '<button class="btn danger" data-a="delKond">Ta bort</button>' : ''}<button class="btn pri" data-a="saveKond">Spara</button></div></div>`);
}
ACT.kMin = el => { $('#kMin').value = el.dataset.v; $$('[data-a="kMin"]').forEach(b => b.classList.toggle('pri', b === el)); };
ACT.kInt = el => { KOND.intensitet = el.dataset.v; $$('#kInt button').forEach(b => b.classList.toggle('on', b === el)); };
ACT.saveKond = () => {
  const min = pnum($('#kMin').value); if (!min) { toast('Ange minuter'); return; }
  Object.assign(KOND, { typ: $('#kTyp').value, min, datum: $('#kDat').value || today(), efterMaltid: $('#kEM').checked, not: $('#kNot').value });
  if (KOND.id) S.kondition[S.kondition.findIndex(k => k.id === KOND.id)] = KOND; else { KOND.id = uid(); S.kondition.push(KOND); }
  save(); closeSheet(); render(); toast('Sparat');
};
ACT.delKond = () => confirmBox('Ta bort aktiviteten?', 'Ta bort', () => { S.kondition = S.kondition.filter(k => k.id !== KOND.id); save(); render(); });

/* ---------- starta och logga pass ---------- */
ACT.startPassPick = () => {
  if (S.aktivtPass) { ACT.resumePass(); return; }
  // föreslå nästa mall i ordning A→B→C
  const lastMall = [...S.pass].sort((a, b) => a.datum < b.datum ? 1 : -1).find(p => p.mallId)?.mallId;
  const order = S.passmallar.filter(m => !/valfritt/i.test(m.fokus || '')).map(m => m.id);
  const next = order.length ? order[(order.indexOf(lastMall) + 1) % order.length] : null;
  openSheet(`${sheetHead('Starta pass')}<div class="sbody">${activePause() ? '<div class="banner warn">Du är i pausläge. Att starta ett pass avslutar inte pausen automatiskt.</div>' : ''}
    <div class="list">${S.passmallar.map(m => `<button class="li" data-a="startPass" data-id="${m.id}"><div class="t"><div><b>${esc(m.namn)}</b> ${m.id === next ? '<span class="chip ok">Nästa</span>' : ''}</div><div class="small muted">${esc(m.fokus || '')} · ${m.ovn.map(x => esc(ovn(x.oid)?.namn || '?')).slice(0, 4).join(', ')}${m.ovn.length > 4 ? ' …' : ''}</div></div></button>`).join('')}
    <button class="li" data-a="startPass" data-id=""><div class="t"><div><b>Fritt pass</b></div><div class="small muted">Välj övningar under passet</div></div></button></div></div>`);
};
function buildExercise(oid, set, mal) {
  const o = ovn(oid); const last = lastPerf(oid);
  const n = set || last?.set.length || 3;
  const sets = [];
  for (let i = 0; i < n; i++) {
    const src = last ? (last.set[i] || last.set[last.set.length - 1]) : null;
    sets.push({ kg: src?.kg ?? null, reps: src?.reps ?? null, sek: src?.sek ?? null, klar: false, pre: !!src });
  }
  return { oid, mal: mal || '', set: sets, rpe: null, smarta: false, not: '', hint: progressionHint(o, mal, last), forra: last ? { datum: last.datum, txt: last.set.map(s => fmtSet(o, s)).join(', '), rpe: last.rpe } : null };
}
ACT.startPass = el => {
  const m = S.passmallar.find(x => x.id === el.dataset.id);
  S.aktivtPass = { id: uid(), mallId: m?.id || null, namn: m ? m.namn : 'Fritt pass', datum: today(), start: nowTime(), startTs: Date.now(), ovn: m ? m.ovn.map(x => buildExercise(x.oid, x.set, x.mal)) : [], cur: 0, not: '' };
  save({ noSync: true }); openPass();
};
ACT.resumePass = () => openPass();
function openPass() {
  openSheet(`<div class="sh"><div class="grow"><h2>${esc(S.aktivtPass.namn)}</h2><div class="small muted" id="passClock"></div></div><button class="btn sm" data-a="finishPass">Avsluta</button><button class="icon-btn" data-a="minimizePass" aria-label="Minimera">${ICON.close}</button></div><div class="sbody" id="passBody"></div>`, { full: true, id: 'pass' });
  renderPass(); tickPassClock();
}
function tickPassClock() {
  clearInterval(tickPassClock._i);
  tickPassClock._i = setInterval(() => { const c = $('#passClock'); if (!c || !S.aktivtPass) { clearInterval(tickPassClock._i); return; } const m = Math.floor((Date.now() - S.aktivtPass.startTs) / 60000); c.textContent = `${m} min · ${sum(S.aktivtPass.ovn.map(e => e.set.filter(s => s.klar).length))} set klara`; }, 1000);
}
ACT.minimizePass = () => { closeSheet(); render(); };
function setInputs(o, s, ei, si) {
  const cls = s.pre && !s.klar ? 'pre' : '';
  const kg = `<input type="number" inputmode="decimal" step="any" class="${cls}" value="${s.kg ?? ''}" placeholder="kg" data-i="setVal" data-e="${ei}" data-s="${si}" data-k="kg">`;
  const reps = `<input type="number" inputmode="numeric" class="${cls}" value="${s.reps ?? ''}" placeholder="reps" data-i="setVal" data-e="${ei}" data-s="${si}" data-k="reps">`;
  const sek = `<input type="number" inputmode="numeric" class="${cls}" value="${s.sek ?? ''}" placeholder="sek" data-i="setVal" data-e="${ei}" data-s="${si}" data-k="sek">`;
  if (o.typ === 'tid') return `<span class="faint xs" style="text-align:center">–</span>${sek}`;
  if (o.typ === 'viktTid') return kg + sek;
  if (o.typ === 'kropp') return `${kg.replace('placeholder="kg"', 'placeholder="+kg"')}${reps}`;
  return kg + reps;
}
function renderPass() {
  const P = S.aktivtPass, b = $('#passBody'); if (!b || !P) return;
  if (!P.ovn.length) { b.innerHTML = `<div class="empty">Lägg till en övning för att börja.</div><button class="btn pri block" data-a="addExercise">${ICON.plus} Lägg till övning</button>`; return; }
  P.cur = clamp(P.cur, 0, P.ovn.length - 1);
  const e = P.ovn[P.cur], o = ovn(e.oid) || { namn: '?', typ: 'vikt' };
  const heads = { vikt: ['Kg', 'Reps'], kropp: ['+kg', 'Reps'], tid: ['', 'Sek'], viktTid: ['Kg', 'Sek'] }[o.typ];
  b.innerHTML = `<div class="exnav">${P.ovn.map((x, i) => { const oo = ovn(x.oid); const done = x.set.length && x.set.every(s => s.klar); return `<button class="${i === P.cur ? 'on' : ''} ${done ? 'done' : ''}" data-a="passGo" data-ix="${i}">${done ? '✓ ' : ''}${esc(oo?.namn.replace(/ \(.*\)/, '') || '?')}</button>`; }).join('')}</div>
  <div class="card">
    <div class="row sb"><div class="grow"><h2>${esc(o.namn)}</h2><div class="small muted">${esc(o.grupp)}${o.del ? ' · ' + esc(o.del) : ''}${e.mal ? ` · mål ${esc(e.mal)} ${o.typ === 'tid' || o.typ === 'viktTid' ? 's' : 'reps'}` : ''}</div></div>
    <button class="btn sm" data-a="swapExercise">Byt</button></div>
    <div class="small" style="margin:8px 0 2px">${e.forra ? `Förra (${fmtD(e.forra.datum)}): <b>${esc(e.forra.txt)}</b>${e.forra.rpe ? ` · RPE ${e.forra.rpe}` : ''}` : `<span class="faint">Första gången – fyll i ${o.typ === 'tid' ? 'sekunder' : o.typ === 'kropp' ? 'reps' : 'vikt och ' + (o.typ === 'viktTid' ? 'sekunder' : 'reps')}.</span>`}</div>
    ${e.hint ? `<div style="margin:4px 0"><span class="chip info">Förslag: ${esc(e.hint)}</span> <span class="xs faint">fylls inte i automatiskt</span></div>` : ''}
    <div class="set hd"><span>Set</span><span style="text-align:center">${heads[0]}</span><span style="text-align:center">${heads[1]}</span><span></span></div>
    ${e.set.map((s, si) => `<div class="set"><span class="b">${si + 1}</span>${setInputs(o, s, P.cur, si)}<button class="chk ${s.klar ? 'on' : ''}" data-a="setDone" data-s="${si}" aria-label="Klart">${ICON.check}</button></div>`).join('')}
    <div class="btns" style="margin-top:10px">${o.typ !== 'tid' ? `<button class="btn sm" data-a="adjKg" data-d="-1">−${f1(o.steg || 2.5)} kg</button><button class="btn sm" data-a="adjKg" data-d="1">+${f1(o.steg || 2.5)} kg</button>` : '<button class="btn sm" data-a="adjSek" data-d="-5">−5 s</button><button class="btn sm" data-a="adjSek" data-d="5">+5 s</button>'}
      <button class="btn sm" data-a="addSet">+ Set</button>${e.set.length > 1 ? '<button class="btn sm" data-a="delSet">− Set</button>' : ''}</div>
    <div class="note">Tonade värden är hämtade från förra passet. Tryck ✓ för att bekräfta eller ändra först. ± ändrar nästa ej klara set.</div>
    <label class="f">Ansträngning (RPE) för övningen</label>
    <div class="rpe">${[6, 7, 8, 9, 10].map(r => `<button class="${e.rpe === r ? 'on' : ''}" data-a="setRpe" data-v="${r}">${r}</button>`).join('')}</div>
    <div class="note">6 = lätt, 8 = 2 reps kvar, 10 = max.</div>
    <label class="row sb" style="margin-top:10px"><span>Smärta/obehag</span><span class="tog"><input type="checkbox" data-c="setPain" ${e.smarta ? 'checked' : ''}><span></span></span></label>
    ${e.smarta ? '<div class="note">Ingen viktökning föreslås nästa gång. Avbryt övningen om det gör ont.</div>' : ''}
  </div>
  <div class="btns">${P.cur > 0 ? `<button class="btn" data-a="passGo" data-ix="${P.cur - 1}">${ICON.left} Föregående</button>` : ''}${P.cur < P.ovn.length - 1 ? `<button class="btn pri" data-a="passGo" data-ix="${P.cur + 1}">Nästa ${ICON.right}</button>` : `<button class="btn pri" data-a="finishPass">Avsluta pass</button>`}</div>
  <div class="btns" style="margin-top:8px"><button class="btn sm" data-a="addExercise">${ICON.plus} Övning</button><button class="btn sm danger" data-a="removeExercise">Ta bort övning</button></div>
  <label class="f">Anteckning för passet</label><textarea data-i="passNote" placeholder="Valfritt">${esc(P.not || '')}</textarea>`;
}
ACT.passGo = el => { S.aktivtPass.cur = +el.dataset.ix; save({ noSync: true }); renderPass(); $('#sheet .sbody').scrollTop = 0; };
ACT.setVal = el => {
  const s = S.aktivtPass.ovn[+el.dataset.e].set[+el.dataset.s];
  s[el.dataset.k] = pnum(el.value); s.pre = false; el.classList.remove('pre');
  save({ noSync: true });
};
ACT.setDone = el => {
  const e = S.aktivtPass.ovn[S.aktivtPass.cur], s = e.set[+el.dataset.s], o = ovn(e.oid);
  const need = o.typ === 'tid' ? s.sek != null : o.typ === 'viktTid' ? (s.sek != null) : o.typ === 'kropp' ? s.reps != null : (s.kg != null && s.reps != null);
  if (!s.klar && !need) { toast('Fyll i värden först'); return; }
  s.klar = !s.klar; if (s.klar) s.pre = false;
  save({ noSync: true }); renderPass();
  if (s.klar) startRest();
};
ACT.adjKg = el => {
  const e = S.aktivtPass.ovn[S.aktivtPass.cur], o = ovn(e.oid), st = (o.steg || 2.5) * +el.dataset.d;
  const targets = e.set.filter(s => !s.klar); if (!targets.length) return;
  targets.forEach(s => { s.kg = Math.max(o.typ === 'kropp' ? -200 : 0, Math.round(((s.kg || 0) + st) * 100) / 100); s.pre = false; });
  save({ noSync: true }); renderPass();
};
ACT.adjSek = el => { const e = S.aktivtPass.ovn[S.aktivtPass.cur]; e.set.filter(s => !s.klar).forEach(s => { s.sek = Math.max(0, (s.sek || 0) + +el.dataset.d); s.pre = false; }); save({ noSync: true }); renderPass(); };
ACT.addSet = () => { const e = S.aktivtPass.ovn[S.aktivtPass.cur]; const l = e.set[e.set.length - 1] || {}; e.set.push({ kg: l.kg ?? null, reps: l.reps ?? null, sek: l.sek ?? null, klar: false, pre: true }); save({ noSync: true }); renderPass(); };
ACT.delSet = () => { const e = S.aktivtPass.ovn[S.aktivtPass.cur]; e.set.pop(); save({ noSync: true }); renderPass(); };
ACT.setRpe = el => { const e = S.aktivtPass.ovn[S.aktivtPass.cur]; e.rpe = e.rpe === +el.dataset.v ? null : +el.dataset.v; save({ noSync: true }); renderPass(); };
ACT.setPain = el => { S.aktivtPass.ovn[S.aktivtPass.cur].smarta = el.checked; save({ noSync: true }); renderPass(); };
ACT.passNote = el => { S.aktivtPass.not = el.value; save({ noSync: true }); };
function exercisePicker(title, filterGroup, cb) {
  const list = S.ovningar.filter(o => o.aktiv && (!filterGroup || o.grupp === filterGroup));
  const grouped = MUSKLER.map(g => [g, list.filter(o => o.grupp === g)]).filter(x => x[1].length);
  ACT._pick = cb;
  const back = UI.sheet === 'picker' ? ACT._pickBack : UI.sheet === 'pass' && S.aktivtPass ? openPass : UI.sheet === 'pm' ? pmForm : null;
  ACT._pickBack = back;
  openSheet(`${sheetHead(title)}<div class="sbody">${grouped.map(([g, os]) => `<div class="sec">${g}</div><div class="list">${os.map(o => `<button class="li" data-a="pickEx" data-id="${o.id}"><div class="t"><div>${esc(o.namn)}</div><div class="small muted">${o.del ? esc(o.del) + ' · ' : ''}${(() => { const l = lastPerf(o.id); return l ? 'Förra: ' + esc(l.set.map(s => fmtSet(o, s)).join(', ')) : 'Ej loggad'; })()}</div></div></button>`).join('')}</div>`).join('')}
    ${filterGroup ? `<button class="btn block" data-a="pickAll">Visa alla muskelgrupper</button>` : ''}</div>`, { id: 'picker', onClose: back ? () => setTimeout(back, 0) : null });
  ACT._pickTitle = title;
}
ACT.pickEx = el => { const f = ACT._pick; f(el.dataset.id); closeSheet(); };
ACT.pickAll = () => { $('#sheet')._onClose = null; exercisePicker(ACT._pickTitle, null, ACT._pick); };
ACT.addExercise = () => exercisePicker('Lägg till övning', null, id => { const P = S.aktivtPass; P.ovn.push(buildExercise(id, null, '')); P.cur = P.ovn.length - 1; save({ noSync: true }); });
ACT.swapExercise = () => {
  const P = S.aktivtPass, e = P.ovn[P.cur], o = ovn(e.oid);
  exercisePicker(`Byt ${o?.namn || ''}`, o?.grupp, id => { const ne = buildExercise(id, e.set.length, e.mal); P.ovn[P.cur] = ne; save({ noSync: true }); toast('Övningen bytt för det här passet'); });
};
ACT.removeExercise = () => { const P = S.aktivtPass; P.ovn.splice(P.cur, 1); P.cur = Math.max(0, P.cur - 1); save({ noSync: true }); renderPass(); };
ACT.finishPass = () => {
  const P = S.aktivtPass; const done = sum(P.ovn.map(e => e.set.filter(s => s.klar).length));
  const pending = sum(P.ovn.map(e => e.set.filter(s => !s.klar && (s.kg != null || s.reps != null || s.sek != null) && !s.pre).length));
  openSheet(`${sheetHead('Avsluta pass')}<div class="sbody"><p>${done} set är markerade som klara.${pending ? ` ${pending} ifyllda set är inte bockade och sparas inte.` : ''}</p>
    <div class="btns"><button class="btn" data-a="resumePass">Fortsätt passet</button>${done ? '<button class="btn pri" data-a="savePass">Spara pass</button>' : ''}</div>
    <button class="btn danger block" data-a="discardPass" style="margin-top:10px">Kasta passet</button></div>`);
};
ACT.savePass = () => {
  const P = S.aktivtPass;
  const p = { id: P.id, mallId: P.mallId, namn: P.namn, datum: P.datum, start: P.start, min: Math.round((Date.now() - P.startTs) / 60000), not: P.not,
    ovn: P.ovn.map(e => ({ oid: e.oid, mal: e.mal, rpe: e.rpe, smarta: e.smarta, set: e.set.filter(s => s.klar).map(s => ({ kg: s.kg, reps: s.reps, sek: s.sek, klar: true })) })).filter(e => e.set.length) };
  S.pass.push(p); S.aktivtPass = null; stopRest(); save(); closeSheet(); UI.tab = 'traning'; render();
  toast(`Bra jobbat! ${sum(p.ovn.map(e => e.set.length))} set, volym ${f0(passVolume(p))} kg`, 3500);
};
ACT.discardPass = () => confirmBox('Kasta passet? Inget sparas.', 'Kasta', () => { S.aktivtPass = null; stopRest(); save(); render(); });

/* ---------- vilotimer ---------- */
let REST = null;
function startRest() {
  stopRest(); const sec = S.mal.vilaSek || 90; REST = { end: Date.now() + sec * 1000 };
  const el = $('#timer'); el.classList.remove('hidden');
  const tick = () => {
    if (!REST) return; const left = Math.round((REST.end - Date.now()) / 1000);
    if (left <= 0) { el.innerHTML = `Vila klar <button data-a="stopRest">OK</button>`; try { navigator.vibrate?.(300); } catch { } clearInterval(REST.i); return; }
    el.innerHTML = `Vila ${Math.floor(left / 60)}:${pad(left % 60)} <button data-a="restAdd">+30 s</button><button data-a="stopRest">Hoppa över</button>`;
  };
  tick(); REST.i = setInterval(tick, 500);
}
function stopRest() { if (REST) clearInterval(REST.i); REST = null; $('#timer').classList.add('hidden'); }
ACT.stopRest = stopRest;
ACT.restAdd = () => { if (REST) REST.end += 30000; };

/* ---------- visa / redigera sparat pass ---------- */
ACT.viewPass = el => {
  const p = S.pass.find(x => x.id === el.dataset.id); if (!p) return;
  openSheet(`${sheetHead(p.namn)}<div class="sbody"><div class="small muted" style="margin-bottom:8px">${fmtDay(p.datum)} ${p.start || ''}${p.min ? ` · ${p.min} min` : ''} · volym ${f0(passVolume(p))} kg</div>
    <div class="list">${p.ovn.map(e => { const o = ovn(e.oid) || { namn: '?', typ: 'vikt' }; return `<div class="li" style="cursor:default"><div class="t"><div>${esc(o.namn)}${e.smarta ? ' <span class="chip warn">smärta</span>' : ''}</div><div class="small muted">${esc(e.set.map(s => fmtSet(o, s)).join(', '))}${e.rpe ? ` · RPE ${e.rpe}` : ''}</div></div></div>`; }).join('')}</div>
    ${p.not ? `<div class="card soft small">${esc(p.not)}</div>` : ''}
    <div class="inrow"><div><label class="f">Datum</label><input type="date" id="vpD" value="${p.datum}"></div></div></div>
    <div class="sf"><div class="btns"><button class="btn danger" data-a="delPass" data-id="${p.id}">Ta bort</button><button class="btn" data-a="editPassAgain" data-id="${p.id}">Redigera set</button><button class="btn pri" data-a="savePassDate" data-id="${p.id}">Spara</button></div></div>`);
};
ACT.savePassDate = el => { const p = S.pass.find(x => x.id === el.dataset.id); p.datum = $('#vpD').value || p.datum; save(); closeSheet(); render(); };
ACT.delPass = el => confirmBox('Ta bort passet?', 'Ta bort', () => { S.pass = S.pass.filter(x => x.id !== el.dataset.id); save(); render(); });
ACT.editPassAgain = el => {
  if (S.aktivtPass) { toast('Avsluta pågående pass först'); return; }
  const p = S.pass.find(x => x.id === el.dataset.id);
  S.pass = S.pass.filter(x => x.id !== p.id);
  S.aktivtPass = { id: p.id, mallId: p.mallId, namn: p.namn, datum: p.datum, start: p.start, startTs: Date.now() - (p.min || 0) * 60000, not: p.not, cur: 0,
    ovn: p.ovn.map(e => { const last = lastPerf(e.oid, p.id); const o = ovn(e.oid); return { ...e, set: e.set.map(s => ({ ...s, klar: true, pre: false })), hint: null, forra: last ? { datum: last.datum, txt: last.set.map(s => fmtSet(o, s)).join(', '), rpe: last.rpe } : null }; }) };
  save({ noSync: true }); openPass();
};

/* ---------- övningsbibliotek ---------- */
let OVN = null;
ACT.manageOvn = () => {
  openSheet(`${sheetHead('Övningsbibliotek')}<div class="sbody">${MUSKLER.map(g => `<div class="sec">${g}</div><div class="list">${S.ovningar.filter(o => o.grupp === g).map(o => `<button class="li" data-a="editOvn" data-id="${o.id}"><div class="t"><div style="${o.aktiv ? '' : 'opacity:.5'}">${esc(o.namn)}${o.aktiv ? '' : ' (arkiverad)'}</div><div class="small muted">${o.del ? esc(o.del) + ' · ' : ''}${({ vikt: 'Vikt × reps', kropp: 'Kroppsvikt', tid: 'Tid', viktTid: 'Vikt × tid' })[o.typ]}${o.steg ? ' · steg ' + f1(o.steg) + ' kg' : ''}</div></div></button>`).join('')}</div>`).join('')}
    <button class="btn pri block" data-a="newOvn">${ICON.plus} Ny övning</button></div>`);
};
ACT.newOvn = () => { OVN = { id: uid(), namn: '', grupp: 'Bröst', del: '', typ: 'vikt', steg: 2.5, aktiv: true, ny: true }; ovnForm(); };
ACT.editOvn = el => { OVN = clone(ovn(el.dataset.id)); ovnForm(); };
function ovnForm() {
  openSheet(`${sheetHead(OVN.ny ? 'Ny övning' : 'Redigera övning')}<div class="sbody">
    <label class="f">Namn</label><input type="text" id="oN" value="${esc(OVN.namn)}">
    <div class="inrow"><div><label class="f">Muskelgrupp</label><select id="oG">${MUSKLER.map(g => `<option ${g === OVN.grupp ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
    <div><label class="f">Del/fokus</label><input type="text" id="oD" value="${esc(OVN.del || '')}" placeholder="Övre, Biceps …"></div></div>
    <div class="inrow"><div><label class="f">Typ</label><select id="oT">${[['vikt', 'Vikt × reps'], ['kropp', 'Kroppsvikt (+kg)'], ['tid', 'Tid (sek)'], ['viktTid', 'Vikt × tid']].map(([k, l]) => `<option value="${k}" ${k === OVN.typ ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div><label class="f">Viktsteg (kg)</label><input type="number" inputmode="decimal" step="any" id="oS" value="${OVN.steg ?? ''}"></div></div>
    ${!OVN.ny ? `<label class="row sb" style="margin-top:12px"><span>Aktiv (avmarkera för att arkivera – historiken sparas)</span><span class="tog"><input type="checkbox" id="oA" ${OVN.aktiv ? 'checked' : ''}><span></span></span></label>` : ''}</div>
    <div class="sf"><button class="btn pri block" data-a="saveOvn">Spara</button></div>`);
}
ACT.saveOvn = () => {
  const namn = $('#oN').value.trim(); if (!namn) { toast('Ange namn'); return; }
  Object.assign(OVN, { namn, grupp: $('#oG').value, del: $('#oD').value.trim(), typ: $('#oT').value, steg: pnum($('#oS').value) || 0, aktiv: $('#oA') ? $('#oA').checked : true });
  const isNew = OVN.ny; delete OVN.ny;
  if (isNew) S.ovningar.push(OVN); else S.ovningar[S.ovningar.findIndex(o => o.id === OVN.id)] = OVN;
  save(); ACT.manageOvn(); render();
};

/* ---------- passmallar ---------- */
let PM = null;
ACT.manageMallarPass = () => {
  openSheet(`${sheetHead('Passmallar')}<div class="sbody"><div class="list">${S.passmallar.map(m => `<button class="li" data-a="editPM" data-id="${m.id}"><div class="t"><div><b>${esc(m.namn)}</b> <span class="small muted">${esc(m.fokus || '')}</span></div><div class="small muted">${m.ovn.map(x => esc(ovn(x.oid)?.namn || '?') + ' ' + x.set + '×' + esc(x.mal)).join(' · ')}</div></div></button>`).join('')}</div>
  <button class="btn pri block" data-a="newPM">${ICON.plus} Ny passmall</button></div>`);
};
ACT.newPM = () => { PM = { id: uid(), namn: 'Nytt pass', fokus: '', ovn: [], ny: true }; pmForm(); };
ACT.editPM = el => { PM = clone(S.passmallar.find(m => m.id === el.dataset.id)); pmForm(); };
function pmForm() {
  openSheet(`${sheetHead(PM.ny ? 'Ny passmall' : 'Redigera passmall')}<div class="sbody" id="pmBody">${pmBody()}</div>
  <div class="sf"><div class="btns">${!PM.ny ? '<button class="btn danger" data-a="delPM">Ta bort</button>' : ''}<button class="btn pri" data-a="savePM">Spara</button></div></div>`, { id: 'pm' });
}
function pmBody() {
  return `<div class="inrow"><div><label class="f">Namn</label><input type="text" value="${esc(PM.namn)}" data-i="pmF" data-k="namn"></div><div><label class="f">Fokus</label><input type="text" value="${esc(PM.fokus || '')}" data-i="pmF" data-k="fokus"></div></div>
  <label class="f">Övningar (set × reps/sek)</label><div class="list">${PM.ovn.map((x, i) => `<div class="food" style="cursor:default;flex-wrap:wrap"><div class="grow n">${esc(ovn(x.oid)?.namn || '?')}</div>
    <div class="qty"><input type="number" inputmode="numeric" value="${x.set}" data-i="pmSet" data-ix="${i}" style="width:52px"><span>×</span><input type="text" value="${esc(x.mal)}" data-i="pmMal" data-ix="${i}" style="width:70px">
    <button class="icon-btn" data-a="pmMove" data-ix="${i}" data-d="-1" aria-label="Upp">↑</button><button class="icon-btn" data-a="pmMove" data-ix="${i}" data-d="1" aria-label="Ned">↓</button><button class="icon-btn" data-a="pmDel" data-ix="${i}">${ICON.close}</button></div></div>`).join('') || '<div class="empty">Inga övningar</div>'}</div>
  <button class="btn block" data-a="pmAdd">${ICON.plus} Lägg till övning</button>`;
}
ACT.pmF = el => PM[el.dataset.k] = el.value;
ACT.pmSet = el => PM.ovn[+el.dataset.ix].set = parseInt(el.value) || 1;
ACT.pmMal = el => PM.ovn[+el.dataset.ix].mal = el.value;
ACT.pmMove = el => { const i = +el.dataset.ix, j = i + +el.dataset.d; if (j < 0 || j >= PM.ovn.length) return; [PM.ovn[i], PM.ovn[j]] = [PM.ovn[j], PM.ovn[i]]; $('#pmBody').innerHTML = pmBody(); };
ACT.pmDel = el => { PM.ovn.splice(+el.dataset.ix, 1); $('#pmBody').innerHTML = pmBody(); };
ACT.pmAdd = () => { exercisePicker('Lägg till i mall', null, id => { PM.ovn.push({ oid: id, set: 3, mal: '8-12' }); }); };
ACT.savePM = () => { const isNew = PM.ny; delete PM.ny; if (isNew) S.passmallar.push(PM); else S.passmallar[S.passmallar.findIndex(m => m.id === PM.id)] = PM; save(); ACT.manageMallarPass(); render(); };
ACT.delPM = () => confirmBox(`Ta bort ${PM.namn}? Loggade pass påverkas inte.`, 'Ta bort', () => { S.passmallar = S.passmallar.filter(m => m.id !== PM.id); save(); render(); });

/* ---------- HÄLSA (vikt, midjemått, blodtryck och puls) ---------- */
const MATT_TYPER = { vikt: ['Vikt', 'kg'], midja: ['Midjemått', 'cm'], bt: ['Blodtryck och puls', 'mmHg'] };
const mattList = () => S.halsa.matt.filter(m => MATT_TYPER[m.typ]);
function pulsLatest() { return latest(S.halsa.matt.filter(m => m.typ === 'bt' && m.puls)); }
function viewHalsa() {
  setHeader('Hälsa', 'Kropp och sömn');
  if (!['oversikt', 'trender', 'matt'].includes(UI.halsaVy)) UI.halsaVy = 'oversikt';
  const v = UI.halsaVy;
  let h = `<div class="seg">${[['oversikt', 'Översikt'], ['trender', 'Trender'], ['matt', 'Mätningar']].map(([k, l]) => `<button class="${v === k ? 'on' : ''}" data-a="halsaVy" data-v="${k}">${l}</button>`).join('')}</div>`;
  h += `<div class="btns" style="margin-bottom:12px">${Object.entries(MATT_TYPER).map(([k, [l]]) => `<button class="btn sm" data-a="addMatt" data-d="${k}">${ICON.plus} ${k === 'bt' ? 'Blodtryck/puls' : l}</button>`).join('')}</div>`;
  if (v === 'oversikt') h += halsaOversikt();
  if (v === 'trender') h += halsaTrender();
  if (v === 'matt') h += halsaMatt();
  return h;
}
ACT.halsaVy = el => { UI.halsaVy = el.dataset.v; render(); };
function diffTxt(typ, unit) {
  const d = S.halsa.matt.filter(m => m.typ === typ && m.datum).sort((a, b) => a.datum < b.datum ? 1 : -1);
  if (d.length < 2) return '';
  const ch = d[0].v - d[1].v;
  return ` · ${ch > 0 ? '+' : ''}${f1(ch)} ${unit} sedan ${fmtD(d[1].datum)}`;
}
function halsaOversikt() {
  const vikt = mattLatest('vikt'), midja = mattLatest('midja'), bt = latest(S.halsa.matt.filter(m => m.typ === 'bt' && m.sys)), puls = pulsLatest();
  const card = (titel, val, enhet, st, sub, d) => `<button class="card" style="text-align:left;width:100%;cursor:pointer" data-a="addMatt" data-d="${d}">
    <div class="row sb"><span class="small muted">${titel}</span>${st ? `<span class="chip ${st.cls}">${st.t}</span>` : ''}</div>
    <div style="font-size:22px;font-weight:600;margin-top:2px" class="num">${val != null ? val + ` <span class="small muted">${enhet}</span>` : '<span class="faint" style="font-size:16px">Ej mätt</span>'}</div>
    <div class="xs faint">${sub}</div></button>`;
  const dt = m => m ? (m.datum ? fmtD(m.datum) : 'Datum okänt') : '';
  let h = '<div class="grid2">';
  h += card('Vikt', vikt ? f1(vikt.v) : null, 'kg', null, dt(vikt) + diffTxt('vikt', 'kg'), 'vikt');
  h += card('Midjemått', midja ? f1(midja.v) : null, 'cm', midja ? (midja.v >= 102 ? { cls: 'warn', t: '≥ 102' } : midja.v >= 94 ? { cls: 'warn', t: '≥ 94' } : { cls: 'ok', t: '< 94' }) : null, midja ? dt(midja) + diffTxt('midja', 'cm') : 'Riskgränser 94/102 cm', 'midja');
  h += card('Blodtryck', bt ? `${bt.sys}/${bt.dia}` : null, 'mmHg', bt ? (bt.sys >= 140 || bt.dia >= 90 ? { cls: 'warn', t: '≥ 140/90' } : { cls: 'ok', t: '< 140/90' }) : null, dt(bt), 'bt');
  h += card('Vilopuls', puls ? f0(puls.puls) : null, 'slag/min', null, dt(puls), 'bt');
  const sa = sleepAvg(today()), sn = S.halsa.somn[today()];
  h += `<button class="card" style="text-align:left;width:100%;cursor:pointer" data-a="sleepLog"><div class="row sb"><span class="small muted">Sömn i natt</span></div><div style="font-size:22px;font-weight:600;margin-top:2px" class="num">${sn != null ? f1(sn) + ' <span class="small muted">h</span>' : '<span class="faint" style="font-size:16px">Ej loggad</span>'}</div><div class="xs faint">Tryck för att logga</div></button>`;
  h += `<button class="card" style="text-align:left;width:100%;cursor:pointer" data-a="sleepLog"><div class="row sb"><span class="small muted">Sömn 7 nätter</span>${sa != null && S.mal.somn.min != null ? `<span class="chip ${sa >= S.mal.somn.min ? 'ok' : 'warn'}">${sa >= S.mal.somn.min ? 'Inom mål' : 'Under mål'}</span>` : ''}</div><div style="font-size:22px;font-weight:600;margin-top:2px" class="num">${sa != null ? f1(sa) + ' <span class="small muted">h</span>' : '<span class="faint" style="font-size:16px">–</span>'}</div><div class="xs faint">Mål ${rangeTxt(S.mal.somn, ' h')}</div></button>`;
  h += '</div>';
  h += `<details class="card"><summary>Så mäter du</summary><div class="small" style="margin-top:8px">
    <p><b>Vikt:</b> på morgonen efter toalettbesök, före frukost, i samma kläder. Dagsvariationer på 1–2 kg är normala – titta på trenden.</p>
    <p><b>Midjemått:</b> mitt emellan nedersta revbenet och höftbenskammen, efter en normal utandning, stående och utan att dra åt måttbandet. För män med europeisk bakgrund används ofta 94 respektive 102 cm som riskgränser – tillämpligheten beror på individen.</p>
    <p><b>Blodtryck och puls:</b> sitt still 5 minuter med armen i hjärthöjd, inget kaffe, ingen nikotin eller träning 30 minuter innan. Mät gärna två gånger och logga det andra värdet.</p></div></details>`;
  const missing = [['Midjemått', !!mattLatest('midja')], ['Vikt med datum', S.halsa.matt.some(m => m.typ === 'vikt' && m.datum)], ['Blodtryck med datum', S.halsa.matt.some(m => m.typ === 'bt' && m.datum)]].filter(x => !x[1]);
  if (missing.length) h += `<div class="sec">Att mäta</div><div class="card small">${missing.map(([t]) => `<div class="kv"><span>${t}</span><span class="chip out">Saknas</span></div>`).join('')}</div>`;
  h += `<p class="note" style="text-align:center">Statusmarkeringarna är allmänna riktvärden, ingen bedömning. Vid frågor om blodtryck eller hälsa – kontakta vården.</p>`;
  return h;
}
function halsaTrender() {
  const vk = S.halsa.matt.filter(m => m.typ === 'vikt' && m.datum).map(m => ({ x: m.datum, y: m.v }));
  const mj = S.halsa.matt.filter(m => m.typ === 'midja' && m.datum).map(m => ({ x: m.datum, y: m.v }));
  const bt = S.halsa.matt.filter(m => m.typ === 'bt' && m.datum && m.sys);
  const pu = S.halsa.matt.filter(m => m.typ === 'bt' && m.datum && m.puls).map(m => ({ x: m.datum, y: m.puls }));
  const few = (a, s) => a.length < 2 ? `<div class="note">${a.length ? 'Ett värde – trenden visas när fler finns.' : 'Inga daterade värden ännu.'} ${s || ''}</div>` : '';
  return `<div class="card"><h3>Vikt (kg)</h3>${lineChart([{ pts: vk, color: 'var(--acc)', label: 'Vikt' }], { aria: 'Vikt över tid' })}${few(vk, 'Värden utan datum visas inte.')}</div>
    <div class="card"><h3>Midjemått (cm)</h3>${lineChart([{ pts: mj, color: 'var(--acc)', label: 'Midja' }], { lines: [{ y: 94, label: '94' }, { y: 102, label: '102', color: 'var(--bad)' }], aria: 'Midjemått över tid' })}${few(mj)}</div>
    <div class="card"><h3>Blodtryck (mmHg)</h3>${lineChart([{ pts: bt.map(b => ({ x: b.datum, y: b.sys })), color: 'var(--acc)', label: 'Systoliskt' }, { pts: bt.map(b => ({ x: b.datum, y: b.dia })), color: 'var(--c-b)', label: 'Diastoliskt' }], { aria: 'Blodtryck över tid' })}${few(bt, 'Värden utan datum visas inte.')}</div>
    <div class="card"><h3>Vilopuls (slag/min)</h3>${lineChart([{ pts: pu, color: 'var(--acc)', label: 'Puls' }], { aria: 'Vilopuls över tid' })}${few(pu)}</div>
    <div class="card"><h3>Sömn senaste 60 nätterna (h)</h3>${(() => { const pts = Object.entries(S.halsa.somn).filter(([d]) => daysBetween(d, today()) <= 60).map(([x, y]) => ({ x, y })); return lineChart([{ pts, color: 'var(--acc)', label: 'Sömn' }], { lines: S.mal.somn.min != null ? [{ y: S.mal.somn.min, label: 'mål', color: 'var(--ok)' }] : [], aria: 'Sömn över tid' }) + few(pts); })()}</div>`;
}
function halsaMatt() {
  const list = [...mattList()].sort((a, b) => (b.datum || '') < (a.datum || '') ? -1 : 1);
  const val = m => m.typ === 'bt' ? `${m.sys ? `${m.sys}/${m.dia}` : ''}${m.puls ? ` <span class="xs muted">puls ${m.puls}</span>` : ''}` : f1(m.v) + ' <span class="xs muted">' + MATT_TYPER[m.typ][1] + '</span>';
  const nights = Object.entries(S.halsa.somn).sort((a, b) => a[0] < b[0] ? 1 : -1).slice(0, 21);
  const sleepHtml = `<div class="sec">Sömn <button class="btn ghost sm" data-a="sleepLog">${ICON.plus} Logga</button></div>${nights.length ? `<div class="list">${nights.map(([d, v]) => `<button class="li" data-a="sleepLog" data-d="${d}"><div class="t"><div>${fmtDay(d)}</div></div><div class="num b">${f1(v)} <span class="xs muted">h</span></div></button>`).join('')}</div>` : '<div class="empty">Ingen sömn loggad.</div>'}`;
  return `<div class="sec">Kroppsmått</div>` + (list.length ? `<div class="list">${list.map(m => `<button class="li" data-a="editMatt" data-id="${m.id}"><div class="t"><div>${MATT_TYPER[m.typ][0]}</div><div class="xs muted">${m.datum ? fmtD(m.datum) : 'Datum okänt'}${m.forh ? ' · ' + esc(m.forh) : ''}${m.not ? ' · ' + esc(m.not) : ''}</div></div><div class="num b">${val(m)}</div></button>`).join('')}</div>` : '<div class="empty">Inga mätningar ännu.</div>') + sleepHtml;
}
let MT = null;
ACT.addMatt = el => { const typ = MATT_TYPER[el?.dataset?.d] ? el.dataset.d : 'vikt'; MT = { id: null, typ, datum: today(), v: null, sys: null, dia: null, puls: null, forh: typ === 'bt' ? 'Sittande vila 5 min' : typ === 'vikt' ? 'Morgon, före frukost' : '', not: '' }; mattForm(); };
ACT.editMatt = el => { MT = clone(S.halsa.matt.find(m => m.id === el.dataset.id)); mattForm(); };
function mattForm() {
  const [namn, enh] = MATT_TYPER[MT.typ];
  openSheet(`${sheetHead((MT.id ? 'Redigera ' + namn.toLowerCase() : namn))}<div class="sbody">
    ${MT.typ === 'bt' ? `<div class="grid3"><div><label class="f">Systoliskt</label><input type="number" inputmode="numeric" id="mS" value="${MT.sys ?? ''}"></div><div><label class="f">Diastoliskt</label><input type="number" inputmode="numeric" id="mDi" value="${MT.dia ?? ''}"></div><div><label class="f">Puls</label><input type="number" inputmode="numeric" id="mP" value="${MT.puls ?? ''}"></div></div>
      <div class="note">Du kan logga bara puls om du inte mätt blodtrycket.</div>`
      : `<label class="f">${namn} (${enh})</label><input type="text" inputmode="decimal" id="mV" value="${MT.v ?? ''}">`}
    ${MT.typ === 'midja' ? '<div class="note">Mitt emellan nedersta revben och höftbenskam, efter normal utandning.</div>' : ''}
    <label class="f">Datum</label><input type="date" id="mD" value="${MT.datum || ''}" max="${today()}">
    <label class="f">Mätförhållanden</label><input type="text" id="mFh" value="${esc(MT.forh || '')}">
    <label class="f">Anteckning</label><input type="text" id="mN" value="${esc(MT.not || '')}"></div>
    <div class="sf"><div class="btns">${MT.id ? '<button class="btn danger" data-a="delMatt">Ta bort</button>' : ''}<button class="btn pri" data-a="saveMatt">Spara</button></div></div>`);
  setTimeout(() => ($('#mV') || $('#mS'))?.focus(), 50);
}
ACT.saveMatt = () => {
  if (MT.typ === 'bt') {
    MT.sys = pnum($('#mS').value); MT.dia = pnum($('#mDi').value); MT.puls = pnum($('#mP').value);
    if (!!MT.sys !== !!MT.dia) { toast('Ange både systoliskt och diastoliskt'); return; }
    if (!MT.sys && !MT.puls) { toast('Ange blodtryck eller puls'); return; }
  } else { MT.v = pnum($('#mV').value); if (MT.v == null) { toast('Ange ett värde'); return; } }
  MT.datum = $('#mD').value || null; MT.forh = $('#mFh').value.trim(); MT.not = $('#mN').value.trim();
  if (MT.id) S.halsa.matt[S.halsa.matt.findIndex(m => m.id === MT.id)] = MT; else { MT.id = uid(); S.halsa.matt.push(MT); }
  if (MT.typ === 'vikt' && MT.datum && (!S.profil.vikt || MT.datum >= (mattLatest('vikt')?.datum || ''))) S.profil.vikt = MT.v;
  save(); closeSheet(); render(); toast('Sparat');
};
ACT.delMatt = () => confirmBox('Ta bort mätningen?', 'Ta bort', () => { S.halsa.matt = S.halsa.matt.filter(m => m.id !== MT.id); save(); render(); });

/* ---------- STATISTIK ---------- */
function weeksBack(n) { const ws = weekStart(today()); const a = []; for (let i = n - 1; i >= 0; i--) a.push(addDays(ws, -7 * i)); return a; }
function weekNutAvg(ws) {
  const days = []; for (let i = 0; i < 7; i++) { const d = addDays(ws, i); if (d > today()) break; const n = dayNut(d); if (n.antal) days.push(n); }
  if (!days.length) return null;
  const a = zeroNut(); days.forEach(n => NKEYS.concat(['protA', 'protV', 'protM']).forEach(k => a[k] += n[k] / days.length)); a.dagar = days.length; return a;
}
function weekPaused(ws) { for (let i = 0; i < 7; i++) if (activePause(addDays(ws, i))) return true; return false; }
function e1rm(s) { return s.kg && s.reps ? s.kg * (1 + s.reps / 30) : null; }
function statKost() {
  const ws = weeksBack(UI.statPeriod); const avg = ws.map(w => ({ w, n: weekNutAvg(w) }));
  const lbl = w => 'v' + isoWeek(w);
  const any = avg.some(a => a.n);
  if (!any) return '<div class="empty">Logga måltider för att se trender här. Veckor utan loggning visas som tomma, inte som noll.</div>';
  const per = avg.filter(a => a.n); const tot = zeroNut(); per.forEach(a => NKEYS.concat(['protA', 'protV', 'protM']).forEach(k => tot[k] += a.n[k] / per.length));
  const frittE = tot.kcal ? Math.max(tot.fritt, tot.tillsatt) * 4 / tot.kcal * 100 : null;
  return `<div class="card"><h3>Protein per dag (snitt/vecka)</h3>${barChart(avg.map(a => ({ label: lbl(a.w), v: a.n ? a.n.prot : null })), { goal: S.mal.protein.min, goalLabel: 'mål ' + S.mal.protein.min })}</div>
  <div class="card"><h3>Fiber per dag (snitt/vecka)</h3>${barChart(avg.map(a => ({ label: lbl(a.w), v: a.n ? a.n.fiber : null })), { goal: S.mal.fiber.min, goalLabel: 'mål ' + S.mal.fiber.min, color: 'var(--c-b)' })}</div>
  <div class="card"><h3>Energi per dag (snitt/vecka)</h3>${barChart(avg.map(a => ({ label: lbl(a.w), v: a.n ? a.n.kcal : null })), { goal: S.mal.kcal.min || null, color: '#8DA394' })}<div class="note">Bara loggade dagar räknas. Exakt energibehov är inte fastställt.</div></div>
  <div class="card"><h3>Snitt för perioden</h3>
    <div class="kv"><span>Protein</span><span class="num">${f0(tot.prot)} g/dag</span></div><div class="kv"><span>Fiber</span><span class="num">${f0(tot.fiber)} g/dag</span></div>
    <div class="kv"><span>Fritt socker</span><span class="num">${f1(Math.max(tot.fritt, tot.tillsatt))} g/dag${frittE != null ? ` (${f1(frittE)} E%)` : ''}</span></div>
    <div class="kv"><span>Fullkorn</span><span class="num">${f0(tot.fullkorn)} g/dag</span></div><div class="kv"><span>Omega-3</span><span class="num">${f1(tot.o3)} g/dag</span></div>
    <h3 style="margin-top:10px">Fettyper</h3>${stack([{ l: 'Mättat', v: tot.matt, c: 'var(--c-n)' }, { l: 'Enkelomättat', v: tot.enkel, c: 'var(--c-a)' }, { l: 'Fleromättat', v: tot.fler, c: 'var(--c-b)' }])}
    <h3 style="margin-top:10px">Protein</h3>${stack([{ l: 'Animaliskt', v: tot.protA, c: 'var(--c-a)' }, { l: 'Vegetabiliskt', v: tot.protV, c: 'var(--c-b)' }, { l: 'Blandat', v: tot.protM, c: 'var(--c-m)' }])}
    <div class="note">Baserat på ${sum(per.map(a => a.n.dagar))} loggade dagar.</div></div>`;
}
function statTraning() {
  const ws = weeksBack(UI.statPeriod); const lbl = w => 'v' + isoWeek(w);
  const kond = ws.map(w => ({ label: lbl(w), v: weekKond(w).min, mark: weekPaused(w) ? 'Paus' : null }));
  const vol = ws.map(w => ({ label: lbl(w), v: sum(weekPass(w).map(passVolume)), mark: weekPaused(w) ? 'Paus' : null }));
  const cnt = ws.map(w => ({ label: lbl(w), v: weekPass(w).length, mark: weekPaused(w) ? 'Paus' : null }));
  const lastW = weekStart(today());
  const sets = {}; MUSKLER.forEach(m => sets[m] = [0, 0]);
  [addDays(lastW, -7), lastW].forEach((w, i) => weekPass(w).forEach(p => p.ovn.forEach(e => { const o = ovn(e.oid); if (o) sets[o.grupp][i] += e.set.length; })));
  const usedEx = [...new Set(S.pass.flatMap(p => p.ovn.map(e => e.oid)))].filter(id => ['vikt', 'kropp'].includes(ovn(id)?.typ));
  const sel = UI.statEx && usedEx.includes(UI.statEx) ? UI.statEx : usedEx[0];
  let rm = [];
  if (sel) rm = S.pass.filter(p => p.ovn.some(e => e.oid === sel)).map(p => ({ x: p.datum, y: Math.max(...p.ovn.find(e => e.oid === sel).set.map(s => e1rm(s) || 0)) })).filter(p => p.y > 0);
  return `<div class="card"><h3>Kondition per vecka (min, måttlig+)</h3>${barChart(kond, { goal: kondTarget().max, goalLabel: 'mål', color: '#C98B2B' })}<div class="note">Grå bakgrund = pausvecka.</div></div>
  <div class="card"><h3>Styrkepass per vecka</h3>${barChart(cnt, { goal: S.mal.styrkaPass.min, goalLabel: 'mål ' + S.mal.styrkaPass.min })}</div>
  <div class="card"><h3>Träningsvolym per vecka (kg × reps)</h3>${barChart(vol, {})}</div>
  <div class="card"><h3>Set per muskelgrupp</h3><table class="tbl"><tr><th>Grupp</th><th>Förra veckan</th><th>Denna vecka</th></tr>${MUSKLER.map(m => `<tr><td>${m}</td><td class="num">${sets[m][0]}</td><td class="num">${sets[m][1]}</td></tr>`).join('')}</table></div>
  <div class="card"><h3>Uppskattat max (1RM)</h3>${usedEx.length ? `<select data-c="statEx" style="margin-bottom:8px">${usedEx.map(id => `<option value="${id}" ${id === sel ? 'selected' : ''}>${esc(ovn(id).namn)}</option>`).join('')}</select>${lineChart([{ pts: rm, color: 'var(--acc)', label: '1RM' }], { aria: 'Uppskattat max' })}<div class="note">Beräknat med Epleys formel från bästa set per pass – en uppskattning, inte ett test.</div>` : '<div class="empty">Logga pass för att se styrkeutveckling.</div>'}</div>`;
}
ACT.statEx = el => { UI.statEx = el.value; render(); };
function statVecka() {
  // senaste hela veckan (måndag–söndag), eller innevarande om det är söndag
  const t = today(); const dow = (parseD(t).getDay() + 6) % 7;
  const ws = dow === 6 ? weekStart(t) : addDays(weekStart(t), -7);
  const we = addDays(ws, 6);
  const n = weekNutAvg(ws), k = weekKond(ws), p = weekPass(ws), paus = weekPaused(ws), kt = kondTarget(ws);
  const sl = sleepAvg(we, 7);
  const rows = [];
  const row = (l, val, goal, ok) => rows.push(`<div class="kv"><span>${l}</span><span class="num">${val} <span class="faint">/ ${goal}</span> ${ok == null ? '<span class="chip out">okänt</span>' : ok ? '<span class="chip ok">✓</span>' : '<span class="chip warn">under</span>'}</span></div>`);
  row('Protein (snitt/dag)', n ? f0(n.prot) + ' g' : '–', rangeTxt(S.mal.protein, ' g'), n && S.mal.protein.min != null ? n.prot >= S.mal.protein.min : null);
  row('Fiber (snitt/dag)', n ? f0(n.fiber) + ' g' : '–', rangeTxt(S.mal.fiber, ' g'), n && S.mal.fiber.min != null ? n.fiber >= S.mal.fiber.min : null);
  row('Sömn (snitt)', sl != null ? f1(sl) + ' h' : '–', rangeTxt(S.mal.somn, ' h'), sl != null && S.mal.somn.min != null ? sl >= S.mal.somn.min : null);
  if (!paus) {
    row('Styrkepass', p.length, rangeTxt(S.mal.styrkaPass), p.length >= S.mal.styrkaPass.min);
    row('Kondition', f0(k.min) + ' min', (kt.min === kt.max ? kt.max : kt.min + '–' + kt.max) + ' min', k.min >= kt.min);
    row('Promenader efter måltid', k.promenader + ' st', 'valfritt', null);
  }
  const sug = [];
  if (n && S.mal.fiber.min != null && n.fiber < S.mal.fiber.min) sug.push('Fiber: lägg till en fiberkälla per dag, t.ex. 10 g chiafrö i gröten, knäckebröd av råg eller en extra portion grönsaker/bär.');
  if (n && S.mal.protein.min != null && n.prot < S.mal.protein.min) sug.push('Protein: lägg till en proteinkälla vid frukost eller mellanmål, t.ex. laktosfri kvarg, ägg eller keso.');
  if (n && n.kcal && Math.max(n.fritt, n.tillsatt) * 4 / n.kcal * 100 > S.mal.frittSockerEP) sug.push('Fritt socker låg över målet – byt en söt dryck eller ett mellanmål mot frukt/bär med protein.');
  if (!paus && k.min < kt.min) sug.push(`Kondition: ${f0(kt.min - k.min)} min kvar till veckomålet – t.ex. en rask promenad på ${Math.min(35, Math.max(15, Math.round((kt.min - k.min) / 2)))} min två dagar.`);
  if (!paus && p.length < S.mal.styrkaPass.min) sug.push('Styrka: planera in passen i kalendern för nästa vecka – A, B och C räcker.');
  if (sl != null && sl < S.mal.somn.min) sug.push('Sömn: sikta på en fast läggtid; kort sömn kan påverka blodsockret.');
  if (!n) sug.push('Ingen kost loggad förra veckan – börja med att logga frukost och lunch.');
  const note = S.veckonoter[ws] || {};
  return `<div class="card"><div class="row sb"><h3>Vecka ${isoWeek(ws)}</h3><span class="small muted">${fmtD(ws)} – ${fmtD(we)}</span></div>
    ${paus ? '<div class="banner warn" style="margin:6px 0">Pausvecka – träningsmålen jämförs inte.</div>' : ''}${rows.join('')}</div>
    <div class="card soft"><h3>Förslag (max två små ändringar)</h3>${sug.length ? sug.slice(0, 2).map(s => `<p class="small" style="margin:6px 0">• ${esc(s)}</p>`).join('') : '<p class="small">Veckan nådde målen – fortsätt som du gör.</p>'}
    <div class="note">Förslagen är generella och ersätter inte vårdens råd. Inga diagnoser, inga medicinjusteringar och ingen viktminskning föreslås automatiskt.</div></div>
    <div class="card"><h3>Din reflektion</h3><label class="f">Hur kändes återhämtning, energi och hunger?</label><textarea id="vnT">${esc(note.text || '')}</textarea>
    <label class="f">Fokus nästa vecka</label><input type="text" id="vnF" value="${esc(note.fokus || '')}" placeholder="t.ex. chia i gröten varje morgon">
    <button class="btn pri block" data-a="saveVecka" data-w="${ws}" style="margin-top:10px">Markera veckan som uppföljd</button>${note.klar ? `<div class="note">Uppföljd ${fmtD(note.klar)}.</div>` : ''}</div>`;
}
ACT.saveVecka = el => { S.veckonoter[el.dataset.w] = { text: $('#vnT').value, fokus: $('#vnF').value, klar: today() }; save(); render(); toast('Veckan uppföljd'); };

/* ---------- AI-fotoanalys av måltid (Claude API, egen nyckel på enheten) ---------- */
const AI_MODELS = [['claude-sonnet-5-5', 'Sonnet – balans mellan precision och pris (rekommenderas)'], ['claude-haiku-5-5', 'Haiku – snabbast och billigast'], ['claude-opus-5-5', 'Opus – mest noggrann, dyrast']];
const aiCfg = () => LOCAL.ai || (LOCAL.ai = { key: '', model: 'claude-sonnet-5-5', max: 60, usage: { month: '', n: 0 } });
const monthKey = () => today().slice(0, 7);
function aiUsage() { const c = aiCfg(); if (c.usage.month !== monthKey()) c.usage = { month: monthKey(), n: 0 }; return c.usage; }
const AI_SYSTEM = `Du är en noggrann nutritionsassistent. Du får ett foto av en måltid.
Identifiera varje synlig livsmedelskomponent och uppskatta dess vikt i gram så som den ligger på tallriken (ätbar del, tillagad om den är tillagad).
Räkna även med troliga dolda komponenter, t.ex. stekfett, olja, smör eller sås, som egna rader med säkerhet "låg".
För varje komponent: ange ett kort svenskt sökord som matchar namn i Livsmedelsverkets livsmedelsdatabas, t.ex. "lax stekt", "potatis kokt", "ris fullkorn kokt", "broccoli kokt", "olivolja", "kycklingfilé stekt".
Om användaren skriver en kommentar (t.ex. vikt eller ingredienser) ska den gå före din bedömning.
Svara ENBART med giltig JSON, utan annan text, enligt:
{"ratt":"kort namn på rätten","ingredienser":[{"namn":"visningsnamn","sok":"sökord","gram":120,"sakerhet":"hög|medel|låg"}],"kommentar":"kort notering om osäkerheter, max 2 meningar"}
Om bilden inte visar mat: {"ratt":"","ingredienser":[],"kommentar":"Ingen mat hittades i bilden."}`;

let AIDRAFT = null, AIABORT = null;
ACT.photoMeal = () => { ACT.newMeal(); ACT.aiPhoto(); };
ACT.aiPhoto = () => {
  const c = aiCfg();
  if (!c.key) {
    openSheet(`${sheetHead('Fota måltid')}<div class="sbody"><p>För att analysera foton behöver appen en API-nyckel till Claude. Den sparas bara på den här enheten.</p>
      <button class="btn pri block" data-a="setAi">Lägg in API-nyckel</button></div>`, { onClose: () => setTimeout(openMealEditor, 0) });
    return;
  }
  if (aiUsage().n >= c.max) { toast(`Månadsgränsen på ${c.max} analyser är nådd – ändra under Inställningar → AI-fotoanalys`, 4500); return; }
  let inp = $('#aiFile');
  if (!inp) { inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.id = 'aiFile'; inp.className = 'hidden'; document.body.appendChild(inp); }
  inp.value = '';
  inp.onchange = () => { const f = inp.files[0]; if (f) aiStart(f); };
  inp.click();
};
async function shrinkImage(file, max = 1280) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Kunde inte läsa bilden')); i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.82);
  } finally { URL.revokeObjectURL(url); }
}
async function aiStart(file) {
  const mealBackup = MEAL;
  openSheet(`${sheetHead('Analyserar bilden …')}<div class="sbody"><div id="aiPrev" style="margin-bottom:10px"></div>
    <label class="f">Kommentar till analysen (valfritt)</label><input type="text" id="aiNote" placeholder="t.ex. laxen ca 150 g, stekt i smör">
    <div class="btns" style="margin-top:10px"><button class="btn pri" data-a="aiRun">Analysera</button></div>
    <div id="aiStatus" class="note"></div></div>`, { id: 'ai', onClose: () => { if (AIABORT) AIABORT.abort(); MEAL = mealBackup; setTimeout(openMealEditor, 0); } });
  try {
    const dataUrl = await shrinkImage(file);
    AIDRAFT = { img: dataUrl, ratt: '', kommentar: '', rows: [] };
    $('#aiPrev').innerHTML = `<img src="${dataUrl}" alt="Foto av måltiden" style="width:100%;max-height:260px;object-fit:cover;border-radius:12px">`;
    $('#sheet .sh h2').textContent = 'Fota måltid';
  } catch (e) { $('#aiStatus').textContent = e.message; }
}
ACT.aiRun = async () => {
  if (!AIDRAFT?.img) return;
  const c = aiCfg(), st = $('#aiStatus'), btn = $('[data-a="aiRun"]');
  btn.disabled = true; btn.textContent = 'Analyserar …'; st.textContent = 'Skickar bilden till Claude. Det tar oftast 5–20 sekunder.';
  AIABORT = new AbortController();
  try {
    const note = $('#aiNote').value.trim();
    const excl = S.uteslut.filter(x => x.aktiv).map(x => x.namn).join(', ');
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AIABORT.signal,
      headers: { 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: c.model, max_tokens: 1500, system: AI_SYSTEM, messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: AIDRAFT.img.split(',')[1] } },
        { type: 'text', text: `Analysera måltiden.${note ? ' Användarens kommentar: ' + note : ''}${excl ? ' (Användaren äter inte: ' + excl + ' – nämn i kommentaren om något sådant syns.)' : ''}` }] }] })
    });
    const u = aiUsage(); u.n++; await saveLocal();
    if (!r.ok) throw await aiError(r);
    const j = await r.json();
    const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    AIDRAFT.ratt = parsed.ratt || ''; AIDRAFT.kommentar = parsed.kommentar || '';
    AIDRAFT.rows = (parsed.ingredienser || []).map(x => {
      const m = aiMatch(x); const ex = m && exclInfo(m.id)?.hide.length; return { namn: x.namn, sok: x.sok || x.namn, gram: Math.round(+x.gram || 0), sak: x.sakerhet || '', fid: m ? m.id : null, inc: !!m && !ex && (x.sakerhet !== 'låg' || +x.gram <= 30) };
    });
    renderAiReview();
  } catch (e) {
    if (e.name === 'AbortError') return;
    st.innerHTML = `<span style="color:var(--bad)">${esc(e instanceof SyntaxError ? 'Svaret gick inte att tolka. Försök igen.' : e.message)}</span>`;
    btn.disabled = false; btn.textContent = 'Försök igen';
  } finally { AIABORT = null; }
};
async function aiError(r) {
  let msg = ''; try { msg = (await r.json()).error?.message || ''; } catch { }
  if (/CORS/i.test(msg)) return new Error('Organisationen tillåter inte anrop direkt från webbläsaren. Kontrollera inställningarna i Anthropics konsol.');
  const m = { 400: 'Anropet nekades (400).', 401: 'API-nyckeln är ogiltig. Kontrollera den under Inställningar → AI-fotoanalys.', 402: 'Kontot saknar kredit. Fyll på i Anthropics konsol.', 403: 'Nyckeln saknar behörighet.', 404: 'Modellen hittades inte – välj en annan modell under Inställningar.', 413: 'Bilden är för stor.', 429: 'För många anrop just nu – vänta en stund.', 529: 'Tjänsten är överbelastad – försök igen om en stund.' }[r.status] || `Fel ${r.status}.`;
  return new Error(m + (msg && r.status !== 401 ? ` (${msg})` : ''));
}
function aiMatch(x) {
  const tries = [x.sok, x.namn, (x.sok || '').split(' ')[0]].filter(Boolean);
  for (const q of tries) { const r = searchFoods(q, true); if (r.length) return r[0]; }
  return null;
}
function renderAiReview() {
  const rows = AIDRAFT.rows;
  const tot = zeroNut(); rows.filter(r => r.inc && r.fid != null).forEach(r => { const f = getFood(r.fid); if (f) addNut(tot, rowNut({ n: f.n, g: r.gram })); });
  $('#sheet .sbody').innerHTML = `<img src="${AIDRAFT.img}" alt="" style="width:100%;max-height:180px;object-fit:cover;border-radius:12px">
    ${AIDRAFT.ratt ? `<h2 style="margin:10px 0 2px">${esc(AIDRAFT.ratt)}</h2>` : ''}${AIDRAFT.kommentar ? `<div class="small muted">${esc(AIDRAFT.kommentar)}</div>` : ''}
    <div class="banner info" style="margin-top:10px">Vikterna är AI-uppskattningar och kan avvika mycket. Justera innan du lägger till.</div>
    ${rows.length ? `<div class="list">${rows.map((r, i) => { const f = r.fid != null ? getFood(r.fid) : null; const x = f ? exclInfo(f.id) : null; return `<div class="food" style="cursor:default;flex-wrap:wrap;align-items:flex-start">
      <input type="checkbox" ${r.inc ? 'checked' : ''} data-c="aiInc" data-ix="${i}" style="width:22px;height:22px;margin-top:2px" aria-label="Ta med">
      <div class="grow"><div class="n">${esc(r.namn)} ${r.sak ? `<span class="chip ${r.sak === 'hög' ? 'ok' : r.sak === 'låg' ? 'warn' : 'out'}">${esc(r.sak)}</span>` : ''}</div>
        <div class="m">${f ? '→ ' + esc(f.namn) : '<span style="color:var(--bad)">Ingen träff i databasen</span>'} ${x && x.hide.length ? `<span class="chip bad">${esc(x.hide.join(', '))}</span>` : ''}</div>
        <details style="margin-top:4px"><summary class="xs" style="color:var(--acc);cursor:pointer">Byt livsmedel</summary>
          <input type="search" value="${esc(r.sok)}" data-i="aiSearch" data-ix="${i}" style="margin-top:6px"><div id="aiRes${i}"></div></details></div>
      <div class="qty"><input type="text" inputmode="decimal" value="${r.gram}" data-i="aiGram" data-ix="${i}" aria-label="Gram" onfocus="this.select()"><span class="small muted">g</span></div></div>`; }).join('')}</div>`
      : '<div class="empty">Inga livsmedel hittades i bilden.</div>'}
    <div class="card" id="aiTot"><div class="macros"><div><div class="v num">${f0(tot.kcal)}</div><div class="l">kcal</div></div><div><div class="v num">${f0(tot.prot)}</div><div class="l">protein</div></div><div><div class="v num">${f0(tot.kolh)}</div><div class="l">kolh</div></div><div><div class="v num">${f0(tot.fett)}</div><div class="l">fett</div></div><div><div class="v num">${f1(tot.fiber)}</div><div class="l">fiber</div></div></div></div>
    <div class="btns"><button class="btn" data-a="aiPhotoAgain">Ny bild</button><button class="btn pri" data-a="aiAccept">Lägg till markerade</button></div>
    <div class="note">Analyser denna månad: ${aiUsage().n} av ${aiCfg().max}. Bilden sparas inte.</div>`;
}
ACT.aiInc = el => { AIDRAFT.rows[+el.dataset.ix].inc = el.checked; renderAiReview(); };
ACT.aiGram = el => { const v = pnum(el.value); if (v != null) AIDRAFT.rows[+el.dataset.ix].gram = v; const tot = zeroNut(); AIDRAFT.rows.filter(r => r.inc && r.fid != null).forEach(r => { const f = getFood(r.fid); if (f) addNut(tot, rowNut({ n: f.n, g: r.gram })); }); const vs = $$('#aiTot .v'); [tot.kcal, tot.prot, tot.kolh, tot.fett].forEach((v, i) => vs[i].textContent = f0(v)); vs[4].textContent = f1(tot.fiber); };
ACT.aiSearch = el => {
  const i = +el.dataset.ix; clearTimeout(ACT._ais); ACT._ais = setTimeout(() => {
    const res = searchFoods(el.value, true).slice(0, 8);
    $('#aiRes' + i).innerHTML = res.map(f => `<button class="li" style="padding:8px 4px" data-a="aiPick" data-ix="${i}" data-fid="${f.id}"><div class="t small">${esc(f.namn)}${exclInfo(f.id)?.hide.length ? ' <span class="chip bad">utesluten</span>' : ''}</div></button>`).join('') || '<div class="note">Inga träffar</div>';
  }, 150);
};
ACT.aiPick = el => { const r = AIDRAFT.rows[+el.dataset.ix]; r.fid = isNaN(el.dataset.fid) ? el.dataset.fid : +el.dataset.fid; r.inc = true; renderAiReview(); };
ACT.aiPhotoAgain = () => { closeSheet(); setTimeout(() => toast('Tryck på Fota måltid igen'), 50); };
ACT.aiAccept = () => {
  const add = AIDRAFT.rows.filter(r => r.inc && r.fid != null && r.gram > 0);
  if (!add.length) { toast('Markera minst ett livsmedel'); return; }
  const target = $('#sheet')._onClose; $('#sheet')._onClose = null;
  closeSheet();
  if (target) target(); // återställ MEAL och öppna editorn
  setTimeout(() => {
    add.forEach(r => { const s = snapRow(r.fid, r.gram); if (s) MEAL.rader.push(s); });
    if (!MEAL.namn && AIDRAFT.ratt) MEAL.namn = AIDRAFT.ratt;
    $('#mealRows').innerHTML = mealRowsHtml(); refreshMealParts(); toast(`${add.length} livsmedel tillagda från fotot`);
  }, 30);
};

/* ---------- inställningar för AI ---------- */
ACT.setAi = () => {
  const c = aiCfg(), known = AI_MODELS.some(m => m[0] === c.model);
  openSheet(`${sheetHead('AI-fotoanalys')}<div class="sbody">
    <p class="small muted">Fota en måltid så föreslår Claude ingredienser och vikter, som matchas mot Livsmedelsverkets databas. Du granskar alltid förslaget innan något sparas. Bilden skickas till Anthropic för analys och sparas inte i appen.</p>
    <details class="card"><summary>Så skaffar du en API-nyckel</summary><ol class="small" style="padding-left:18px;margin:8px 0 0">
      <li>Gå till Anthropics utvecklarkonsol, <b>platform.claude.com</b>, och skapa ett konto. API:et faktureras separat från ett Claude-abonnemang.</li>
      <li>Lägg in betalkort och köp en liten kredit, t.ex. 5 USD.</li>
      <li>Sätt en <b>månadsgräns för kostnad</b> under Limits/Billing, så kan det aldrig bli dyrt.</li>
      <li>Gå till <b>API keys → Create key</b>, döp den till "ShapeApp" och kopiera nyckeln (börjar med <code>sk-ant-</code>).</li>
      <li>Klistra in den nedan och tryck Spara och testa.</li></ol></details>
    <label class="f">API-nyckel</label><input type="password" id="aiK" value="${esc(c.key)}" autocomplete="off" placeholder="sk-ant-…">
    <label class="f">Modell</label><select id="aiM">${AI_MODELS.map(([k, l]) => `<option value="${k}" ${k === c.model ? 'selected' : ''}>${l}</option>`).join('')}<option value="_egen" ${!known ? 'selected' : ''}>Annan modell …</option></select>
    <input type="text" id="aiMC" value="${known ? '' : esc(c.model)}" placeholder="modellnamn, t.ex. claude-sonnet-5-5" style="margin-top:6px" autocapitalize="off" autocorrect="off">
    <label class="f">Max antal analyser per månad</label><input type="number" inputmode="numeric" id="aiX" value="${c.max}">
    <div class="note">Använt denna månad: ${aiUsage().n}. Spärren skyddar mot oavsiktliga anrop – sätt även en kostnadsgräns i konsolen.</div>
    <div class="note">Nyckeln sparas bara på den här enheten och följer aldrig med i export, backup eller GitHub. Den som har tillgång till din upplåsta telefon kan i princip läsa den.</div>
    <div id="aiTest" class="note"></div></div>
    <div class="sf"><div class="btns">${c.key ? '<button class="btn danger" data-a="aiRemove">Ta bort nyckel</button>' : ''}<button class="btn pri" data-a="aiSave">Spara och testa</button></div></div>`, { id: 'aiset', onClose: backToSettings });
};
ACT.aiSave = async () => {
  const c = aiCfg(); c.key = $('#aiK').value.replace(/\s+/g, ''); const m = $('#aiM').value;
  c.model = m === '_egen' ? ($('#aiMC').value.trim() || 'claude-sonnet-5-5') : m;
  c.max = Math.max(1, parseInt($('#aiX').value) || 60); await saveLocal();
  if (!c.key) { toast('Ange en nyckel'); return; }
  const t = $('#aiTest'); t.textContent = 'Testar nyckeln …';
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: c.model, max_tokens: 5, messages: [{ role: 'user', content: 'Svara OK' }] }) });
    if (!r.ok) throw await aiError(r);
    t.innerHTML = '<span style="color:var(--ok)">✓ Nyckeln fungerar.</span>'; toast('AI-fotoanalys klar att använda');
  } catch (e) { t.innerHTML = `<span style="color:var(--bad)">${esc(e.message)}</span>`; }
};
ACT.aiRemove = () => confirmBox('Ta bort API-nyckeln från den här enheten?', 'Ta bort', async () => { aiCfg().key = ''; await saveLocal(); toast('Nyckeln borttagen'); });

/* ---------- ÖVERSIKT: hälsan i helhet ---------- */
const SEKTION = { kost: ['Kost', 'var(--sec-kost)'], traning: ['Träning', 'var(--sec-tr)'], halsa: ['Hälsa', 'var(--sec-ha)'] };
const secDot = k => `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${SEKTION[k][1]};margin-right:6px"></span>`;
function periodSeg() { return `<div class="seg">${[[4, '4 v'], [12, '12 v'], [26, '6 mån']].map(([k, l]) => `<button class="${UI.statPeriod === k ? 'on' : ''}" data-a="statPer" data-v="${k}">${l}</button>`).join('')}</div>`; }

// Måluppfyllelse per vecka och område: ok | part | miss | none | paus
function weekStatus(ws) {
  const cur = ws === weekStart(today());
  const n = weekNutAvg(ws), paus = weekPaused(ws), we = addDays(ws, 6);
  const lvl = (v, min, partK) => v == null || min == null ? 'none' : v >= min ? 'ok' : v >= min * partK ? 'part' : (cur ? 'part' : 'miss');
  const nights = [0, 1, 2, 3, 4, 5, 6].filter(i => S.halsa.somn[addDays(ws, i)] != null).length;
  const sl = nights >= 3 ? sleepAvg(we, 7) : null;
  const kt = kondTarget(ws);
  return {
    protein: n ? lvl(n.prot, S.mal.protein.min, .85) : 'none',
    fiber: n ? lvl(n.fiber, S.mal.fiber.min, .8) : 'none',
    styrka: paus ? 'paus' : lvl(weekPass(ws).length, S.mal.styrkaPass.min, .6),
    kondition: paus ? 'paus' : lvl(weekKond(ws).min, kt.min, .6),
    somn: sl == null ? 'none' : lvl(sl, S.mal.somn.min, .93),
    cur
  };
}
const ST_STYLE = { ok: ['var(--okbg)', 'var(--ok)', '✓'], part: ['var(--warnbg)', 'var(--warn)', '½'], miss: ['var(--badbg)', 'var(--bad)', '–'], none: ['var(--soft2)', 'var(--faint)', '·'], paus: ['var(--soft)', 'var(--muted)', 'P'] };
function goalGrid(weeks) {
  const rows = [['protein', 'Protein', 'kost'], ['fiber', 'Fiber', 'kost'], ['styrka', 'Styrkepass', 'traning'], ['kondition', 'Kondition', 'traning'], ['somn', 'Sömn', 'halsa']];
  const st = weeks.map(w => ({ w, s: weekStatus(w) }));
  return `<div style="overflow-x:auto"><table class="tbl" style="table-layout:fixed;min-width:${90 + weeks.length * 26}px">
    <tr><th style="width:90px"></th>${st.map(x => `<th style="text-align:center;font-size:10px;padding:4px 0">${isoWeek(x.w)}</th>`).join('')}</tr>
    ${rows.map(([k, l, sec]) => `<tr><td style="font-size:12px">${secDot(sec)}${l}</td>${st.map(x => { const [bg, fg, t] = ST_STYLE[x.s[k]]; return `<td style="text-align:center;padding:3px 1px"><span title="v${isoWeek(x.w)}: ${l}" style="display:block;border-radius:6px;padding:3px 0;font-size:11px;font-weight:600;background:${bg};color:${fg};${x.s.cur ? 'outline:1px dashed var(--line);' : ''}">${t}</span></td>`; }).join('')}</tr>`).join('')}
  </table></div>
  <div class="legend" style="margin-top:6px"><span style="--c:var(--ok)">Mål nått</span><span style="--c:var(--warn)">Nära/pågår</span><span style="--c:var(--bad)">Under</span><span style="--c:var(--faint)">Ingen data</span><span style="--c:var(--muted)">P = paus</span></div>`;
}
function viewOversikt() {
  const t = today(), d = parseD(t);
  setHeader('Översikt', `${DAGAR[d.getDay()][0].toUpperCase() + DAGAR[d.getDay()].slice(1)} ${d.getDate()} ${MAN[d.getMonth()]} · vecka ${isoWeek(t)}`);
  if (!['nu', 'vecka', 'trend'].includes(UI.ovVy)) UI.ovVy = 'nu';
  let h = `<div class="seg">${[['nu', 'Nu'], ['vecka', 'Veckouppföljning'], ['trend', 'Helhet']].map(([k, l]) => `<button class="${UI.ovVy === k ? 'on' : ''}" data-a="ovVy" data-v="${k}">${l}</button>`).join('')}</div>`;
  if (UI.ovVy === 'vecka') return h + statVecka();
  if (UI.ovVy === 'trend') return h + ovTrend();
  return h + ovNu();
}
ACT.ovVy = el => { UI.ovVy = el.dataset.v; render(); };
ACT.statPer = el => { UI.statPeriod = +el.dataset.v; render(); };
function card(sec, title, body, tab) {
  return `<div class="card" style="border-left:4px solid ${SEKTION[sec][1]};--acc:${SEKTION[sec][1]}"><div class="row sb"><h3>${title}</h3>${tab ? `<button class="btn ghost sm" data-a="tab" data-t="${tab}" style="color:${SEKTION[sec][1]}">Visa ${ICON.right.replace('<svg', '<svg width="16" height="16"')}</button>` : ''}</div>${body}</div>`;
}
function ovNu() {
  const t = today(), ws = weekStart(t), n = dayNut(t), wn = weekNutAvg(ws), pause = activePause();
  const kt = kondTarget(t), wk = weekKond(ws), wp = weekPass(ws), sleep = S.halsa.somn[t], sa = sleepAvg(t);
  const daysLogged = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(ws, i)).filter(x => x <= t && S.maltider.some(m => m.datum === x)).length;
  const daysSoFar = daysBetween(ws, t) + 1;
  const vikt = mattLatest('vikt'), midja = mattLatest('midja'), bt = latest(S.halsa.matt.filter(m => m.typ === 'bt' && m.sys)), puls = latest(S.halsa.matt.filter(m => m.typ === 'bt' && m.puls));
  const v30 = (() => { const v = S.halsa.matt.filter(m => m.typ === 'vikt' && m.datum).sort((a, b) => a.datum < b.datum ? -1 : 1); if (v.length < 2) return null; const last = v[v.length - 1]; const ref = [...v].reverse().find(x => daysBetween(x.datum, last.datum) >= 25) || v[0]; return ref === last ? null : { ch: last.v - ref.v, from: ref.datum }; })();
  const st = weekStatus(ws);
  const chip = s => `<span class="chip" style="background:${ST_STYLE[s][0]};color:${ST_STYLE[s][1]}">${{ ok: 'Mål nått', part: 'På väg', miss: 'Under mål', none: 'Ingen data', paus: 'Paus' }[s]}</span>`;
  let h = '';
  if (S.aktivtPass) h += `<div class="banner info row sb"><span>Pågående pass: <b>${esc(S.aktivtPass.namn)}</b></span><button class="btn sm pri" data-a="resumePass">Fortsätt</button></div>`;
  h += `<div class="grid2" style="margin-bottom:12px">
    <button class="btn" data-a="newMeal" style="border-color:var(--sec-kost);color:var(--sec-kost)">${ICON.plus} Måltid</button>
    <button class="btn" data-a="photoMeal" style="border-color:var(--sec-kost);color:var(--sec-kost)">📷 Fota måltid</button>
    <button class="btn" data-a="startPassPick" style="border-color:var(--sec-tr);color:var(--sec-tr)">${ICON.play} Pass</button>
    <button class="btn" data-a="quickWalk" style="border-color:var(--sec-tr);color:var(--sec-tr)">${ICON.walk} Promenad</button></div>`;
  // Kost
  h += card('kost', 'Kost', `
    <div class="small muted" style="margin-bottom:4px">Idag</div>
    ${goalBar('Protein', n.prot, S.mal.protein, 'g')}${goalBar('Fiber', n.fiber, S.mal.fiber, 'g')}
    <div class="small muted num" style="margin-top:4px">${f0(n.kcal)} kcal · ${f0(n.kolh)} g kolh · ${f0(n.fett)} g fett · ${n.antal} ${n.antal === 1 ? 'måltid' : 'måltider'}</div>
    <div class="kv" style="margin-top:8px"><span>Veckan: protein snitt</span><span class="num">${wn ? f0(wn.prot) + ' g' : '–'} ${chip(st.protein)}</span></div>
    <div class="kv"><span>Veckan: fiber snitt</span><span class="num">${wn ? f0(wn.fiber) + ' g' : '–'} ${chip(st.fiber)}</span></div>
    <div class="note">Loggat ${daysLogged} av ${daysSoFar} dagar denna vecka.</div>`, 'kost');
  // Träning
  h += card('traning', 'Träning', pause ? `<div class="banner warn" style="margin:4px 0 0">Pausläge sedan ${fmtD(pause.fran)} (${esc(pause.orsak)}). Träningsmålen är pausade – kosten fortsätter som vanligt.</div>`
    : `<div class="row sb"><span>Styrkepass</span><span class="small muted num">${wp.length} / ${rangeTxt(S.mal.styrkaPass)} ${chip(st.styrka)}</span></div>${bar(wp.length, S.mal.styrkaPass.max, S.mal.styrkaPass.min)}
    <div class="row sb" style="margin-top:6px"><span>Kondition</span><span class="small muted num">${f0(wk.min)} / ${kt.min === kt.max ? kt.max : kt.min + '–' + kt.max} min ${chip(st.kondition)}</span></div>${bar(wk.min, kt.max, kt.min !== kt.max ? kt.min : null)}
    <div class="note">Promenader efter måltid: ${wk.promenader} st · upptrappning vecka ${kt.vecka}${afterPause(t) ? ' · första passet efter paus – ta det lugnt' : ''}</div>`, 'traning');
  // Sömn och kropp
  h += card('halsa', 'Sömn och kropp', `
    <div class="row sb"><span>Sömn i natt</span><span class="num">${sleep != null ? f1(sleep) + ' h' : '<span class="faint">Ej loggad</span>'}</span></div>
    <div class="btns" style="margin:6px 0">${[6, 6.5, 7, 7.5, 8].map(v => `<button class="btn sm ${sleep === v ? 'pri' : ''}" data-a="setSleep" data-v="${v}">${f1(v)}</button>`).join('')}<button class="btn sm" data-a="setSleep" data-v="ask">Annat</button></div>
    <div class="kv"><span>Sömn snitt 7 nätter</span><span class="num">${sa != null ? f1(sa) + ' h' : '–'} ${chip(sa == null || S.mal.somn.min == null ? 'none' : sa >= S.mal.somn.min ? 'ok' : sa >= S.mal.somn.min - .5 ? 'part' : 'miss')}</span></div>
    <div class="kv"><span>Vikt</span><span class="num">${vikt ? f1(vikt.v) + ' kg' : '<span class="chip out">Ej mätt</span>'}${v30 ? ` <span class="xs muted">${v30.ch > 0 ? '+' : ''}${f1(v30.ch)} sedan ${fmtD(v30.from)}</span>` : ''}</span></div>
    <div class="kv"><span>Midjemått</span><span class="num">${midja ? f1(midja.v) + ' cm' : '<span class="chip out">Ej mätt</span>'}</span></div>
    <div class="kv"><span>Blodtryck / vilopuls</span><span class="num">${bt ? `${bt.sys}/${bt.dia}` : '–'} · ${puls ? f0(puls.puls) : '–'}</span></div>`, 'halsa');
  const rem = reminders();
  if (rem.length) h += `<div class="sec">Påminnelser</div><div class="list">${rem.map(r => `<button class="li" data-a="${r.a}" data-t="${r.d || ''}" data-d="${r.d || ''}"><div class="t">${esc(r.t)}</div>${ICON.right.replace('<svg', '<svg width="18" height="18"')}</button>`).join('')}</div>`;
  h += `<div class="sec">Senaste veckorna</div><div class="card">${goalGrid(weeksBack(6))}</div>`;
  h += `<p class="note" style="text-align:center">ShapeApp ställer inga diagnoser och ersätter inte vården.</p>`;
  return h;
}
function ovTrend() {
  const ws = weeksBack(UI.statPeriod), lbl = w => 'v' + isoWeek(w);
  const avg = ws.map(w => ({ w, n: weekNutAvg(w) }));
  const sl = ws.map(w => { const nights = [0, 1, 2, 3, 4, 5, 6].filter(i => S.halsa.somn[addDays(w, i)] != null).length; return { label: lbl(w), v: nights ? sleepAvg(addDays(w, 6), 7) : null }; });
  const vk = S.halsa.matt.filter(m => m.typ === 'vikt' && m.datum && m.datum >= ws[0]).map(m => ({ x: m.datum, y: m.v }));
  const st = ws.map(w => weekStatus(w)); const keys = ['protein', 'fiber', 'styrka', 'kondition', 'somn'];
  const pct = st.map(s => { const k = keys.filter(x => !['none', 'paus'].includes(s[x])); return k.length ? k.filter(x => s[x] === 'ok').length / k.length * 100 : null; });
  return periodSeg() + `<div class="card"><h3>Måluppfyllelse per vecka</h3>${goalGrid(ws)}</div>
    <div class="card"><h3>Andel mål nådda (%)</h3>${barChart(ws.map((w, i) => ({ label: lbl(w), v: pct[i], mark: weekPaused(w) ? 'Paus' : null })), { color: 'var(--acc)' })}<div class="note">Andel av protein, fiber, styrka, kondition och sömn där veckans mål nåddes. Områden utan data eller i paus räknas inte.</div></div>
    <div class="card"><h3>${secDot('kost')}Protein och fiber (snitt/dag)</h3>${barChart(avg.map(a => ({ label: lbl(a.w), v: a.n ? a.n.prot : null })), { goal: S.mal.protein.min, goalLabel: 'protein', color: 'var(--sec-kost)' })}${barChart(avg.map(a => ({ label: lbl(a.w), v: a.n ? a.n.fiber : null })), { goal: S.mal.fiber.min, goalLabel: 'fiber', color: 'var(--sec-kost)', h: 110 })}</div>
    <div class="card"><h3>${secDot('traning')}Kondition (min/vecka)</h3>${barChart(ws.map(w => ({ label: lbl(w), v: weekKond(w).min, mark: weekPaused(w) ? 'Paus' : null })), { goal: kondTarget().max, color: 'var(--sec-tr)' })}</div>
    <div class="card"><h3>${secDot('halsa')}Sömn (snitt h/natt)</h3>${barChart(sl, { goal: S.mal.somn.min, color: 'var(--sec-ha)' })}</div>
    <div class="card"><h3>${secDot('halsa')}Vikt (kg)</h3>${lineChart([{ pts: vk, color: 'var(--sec-ha)', label: 'Vikt' }], { aria: 'Vikt över tid' })}</div>`;
}

/* ---------- Kost och Träning med egna trender ---------- */
function viewKostSek() {
  if (!['dag', 'trender'].includes(UI.kostVy)) UI.kostVy = 'dag';
  const seg = `<div class="seg">${[['dag', 'Dagbok'], ['trender', 'Trender']].map(([k, l]) => `<button class="${UI.kostVy === k ? 'on' : ''}" data-a="secVy" data-s="kostVy" data-v="${k}">${l}</button>`).join('')}</div>`;
  if (UI.kostVy === 'trender') { setHeader('Kost', 'Trender'); return seg + periodSeg() + statKost(); }
  const body = viewKost(); return seg + body;
}
function viewTraningSek() {
  if (!['vecka', 'trender'].includes(UI.traningVy)) UI.traningVy = 'vecka';
  const seg = `<div class="seg">${[['vecka', 'Veckan'], ['trender', 'Trender']].map(([k, l]) => `<button class="${UI.traningVy === k ? 'on' : ''}" data-a="secVy" data-s="traningVy" data-v="${k}">${l}</button>`).join('')}</div>`;
  if (UI.traningVy === 'trender') { setHeader('Träning', 'Trender'); return seg + periodSeg() + statTraning(); }
  const body = viewTraning(); return seg + body;
}
ACT.secVy = el => { UI[el.dataset.s] = el.dataset.v; render(); window.scrollTo(0, 0); };

/* ---------- sömnlogg ---------- */
ACT.sleepLog = el => {
  const d = el?.dataset?.d || today();
  openSheet(`${sheetHead('Logga sömn')}<div class="sbody">
    <label class="f">Natten till</label><input type="date" id="slD" value="${d}" max="${today()}">
    <label class="f">Timmar</label><input type="text" inputmode="decimal" id="slH" value="${S.halsa.somn[d] != null ? String(S.halsa.somn[d]).replace('.', ',') : ''}" placeholder="7,5">
    <div class="btns" style="margin-top:8px">${[6, 6.5, 7, 7.5, 8, 8.5].map(v => `<button class="btn sm" data-a="slQuick" data-v="${v}">${f1(v)}</button>`).join('')}</div></div>
    <div class="sf"><div class="btns">${S.halsa.somn[d] != null ? '<button class="btn danger" data-a="slDel">Ta bort</button>' : ''}<button class="btn pri" data-a="slSave">Spara</button></div></div>`);
};
ACT.slQuick = el => { $('#slH').value = el.dataset.v.replace('.', ','); };
ACT.slSave = () => { const d = $('#slD').value || today(), h = pnum($('#slH').value); if (h == null || h < 0 || h > 16) { toast('Ange timmar (0–16)'); return; } S.halsa.somn[d] = h; save(); closeSheet(); render(); toast('Sparat'); };
ACT.slDel = () => { delete S.halsa.somn[$('#slD').value]; save(); closeSheet(); render(); };

/* ---------- INSTÄLLNINGAR ---------- */
ACT.openSettings = () => {
  const s = LOCAL.sync || {};
  openSheet(`${sheetHead('Inställningar')}<div class="sbody">
    <div class="list">
      <button class="li" data-a="setProfil"><div class="t"><div>Profil</div><div class="small muted">${S.profil.namn ? esc(S.profil.namn) + ' · ' + (S.profil.alder ?? '–') + ' år · ' + (S.profil.langd ?? '–') + ' cm' : 'Fyll i dina uppgifter'}</div></div></button>
      <button class="li" data-a="setMal"><div class="t"><div>Mål</div><div class="small muted">Kost, sömn, träning och hälsovärden</div></div></button>
      <button class="li" data-a="openExcl"><div class="t"><div>Livsmedel jag inte äter</div><div class="small muted">${S.uteslut.filter(c => c.aktiv).length} aktiva kategorier</div></div></button>
      <button class="li" data-a="manageOvn"><div class="t"><div>Övningsbibliotek</div></div></button>
      <button class="li" data-a="manageMallarPass"><div class="t"><div>Passmallar</div></div></button>
      <button class="li" data-a="setAi"><div class="t"><div>AI-fotoanalys</div><div class="small muted">${LOCAL.ai?.key ? 'Aktiv · ' + esc(LOCAL.ai.model) : 'Ingen API-nyckel ännu'}</div></div>${LOCAL.ai?.key ? '<span class="chip ok">På</span>' : ''}</button>
      <div class="li" style="cursor:default"><div class="t"><div>Startsida</div><div class="small muted">Fliken som öppnas när appen startar</div></div><select data-c="startTab" style="width:auto;min-height:36px">${[['idag', 'Översikt'], ['kost', 'Kost'], ['traning', 'Träning'], ['halsa', 'Hälsa']].map(([k, l]) => `<option value="${k}" ${(LOCAL.startTab || 'idag') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <button class="li" data-a="setPamin"><div class="t"><div>Påminnelser</div><div class="small muted">I appen och som kalenderhändelser</div></div></button>
    </div>
    <div class="sec">Data</div>
    <div class="list">
      <button class="li" data-a="setSync"><div class="t"><div>Backup till GitHub</div><div class="small muted">${s.repo ? `${esc(s.owner)}/${esc(s.repo)} · ${LOCAL.lastSync ? 'senast ' + new Date(LOCAL.lastSync).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) : 'ej synkad'}` : 'Inte konfigurerad'}</div></div>${LOCAL.syncErr ? '<span class="chip warn">Fel</span>' : s.repo ? '<span class="chip ok">På</span>' : ''}</button>
      <button class="li" data-a="exportJson"><div class="t"><div>Exportera allt (JSON)</div><div class="small muted">Komplett säkerhetskopia, kan importeras igen</div></div></button>
      <button class="li" data-a="exportCsvMenu"><div class="t"><div>Exportera CSV</div><div class="small muted">Måltider, träning, kondition, hälsa</div></div></button>
      <button class="li" data-a="importJson"><div class="t"><div>Importera JSON</div><div class="small muted">Ersätter all data på den här enheten</div></div></button>
      <button class="li" data-a="wipeAll"><div class="t"><div style="color:var(--bad)">Radera all data</div></div></button>
    </div>
    <div class="sec">Om</div>
    <div class="card small">ShapeApp ${APP_VERSION}. All data lagras lokalt på enheten. Inget delas externt utan att du själv aktiverar backup.<br><br>
    Näringsvärden: Livsmedelsverkets livsmedelsdatabas ${esc(FOOD.version || '')} (CC BY 4.0). Värdena är uppskattningar – portioner och tillagning påverkar.<br><br>
    Appen ställer inga diagnoser, ändrar inga läkemedel och ersätter inte vården. Mål, progression och menyer är förslag, inte medicinska ordinationer.</div>
    <input type="file" id="impFile" accept="application/json,.json" class="hidden"></div>`, { id: 'settings' });
};
const backToSettings = () => setTimeout(ACT.openSettings, 0);
ACT.setProfil = () => {
  const p = S.profil;
  openSheet(`${sheetHead('Profil')}<div class="sbody">
    <label class="f">Namn</label><input type="text" id="pN" value="${esc(p.namn)}">
    <div class="inrow"><div><label class="f">Kön</label><select id="pK">${['Man', 'Kvinna', 'Annat'].map(x => `<option ${x === p.kon ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div><label class="f">Ålder</label><input type="number" inputmode="numeric" id="pA" value="${p.alder ?? ''}"></div></div>
    <div class="inrow"><div><label class="f">Längd (cm)</label><input type="number" inputmode="numeric" id="pL" value="${p.langd ?? ''}"></div><div><label class="f">Vikt (kg)</label><input type="number" inputmode="decimal" id="pV" value="${p.vikt ?? ''}"></div></div>
    <div class="note">BMI: ${p.langd && p.vikt ? f1(p.vikt / Math.pow(p.langd / 100, 2)) : '–'} kg/m². BMI kan överskatta fettmassa hos styrketränande personer.</div>
    <label class="f">Övrigt (läkemedel, ärftlighet, vardagsaktivitet …)</label><textarea id="pO">${esc(p.notering || '')}</textarea></div>
    <div class="sf"><button class="btn pri block" data-a="saveProfil">Spara</button></div>`, { onClose: backToSettings });
};
ACT.startTab = async el => { LOCAL.startTab = el.value; await saveLocal(); toast('Startsidan sparad'); };
ACT.saveProfil = () => { Object.assign(S.profil, { namn: $('#pN').value.trim(), kon: $('#pK').value, alder: pnum($('#pA').value), langd: pnum($('#pL').value), vikt: pnum($('#pV').value), notering: $('#pO').value }); save(); closeSheet(); render(); toast('Sparat'); };
ACT.setMal = () => {
  const m = S.mal; const rr = (k, l, u) => `<label class="f">${l}${u ? ' (' + u + ')' : ''}</label><div class="inrow"><input type="number" inputmode="decimal" data-mal="${k}.min" value="${m[k].min ?? ''}" placeholder="min"><input type="number" inputmode="decimal" data-mal="${k}.max" value="${m[k].max ?? ''}" placeholder="max"></div>`;
  openSheet(`${sheetHead('Mål')}<div class="sbody">
    <div class="sec">Kost</div>
    ${rr('protein', 'Protein', 'g/dag')}${S.profil.vikt ? `<div class="note">1,6–2,0 g/kg vid ${f1(S.profil.vikt)} kg = ${f0(1.6 * S.profil.vikt)}–${f0(2 * S.profil.vikt)} g.</div>` : ''}
    ${rr('fiber', 'Fiber', 'g/dag')}${rr('fett', 'Fett', 'g/dag')}${rr('kolh', 'Kolhydrater', 'g/dag – lämna tomt för inget mål')}${rr('kcal', 'Energi', 'kcal/dag – lämna tomt tills energibehovet är bedömt')}
    <label class="f">Fritt socker högst (E%)</label><input type="number" inputmode="decimal" data-mal="frittSockerEP" value="${m.frittSockerEP}">
    <div class="sec">Sömn och träning</div>
    ${rr('somn', 'Sömn', 'h/natt')}${rr('styrkaPass', 'Styrkepass', 'per vecka')}
    <label class="f">Konditionstrappa (min/vecka)</label>
    ${m.kondTrappa.map((s, i) => `<div class="inrow" style="margin-bottom:6px"><div><span class="xs muted">Från vecka</span><input type="number" data-kt="${i}.fran" value="${s.fran}"></div><div><span class="xs muted">Min</span><input type="number" data-kt="${i}.min" value="${s.min}"></div><div><span class="xs muted">Max</span><input type="number" data-kt="${i}.max" value="${s.max}"></div></div>`).join('')}
    <label class="f">Trappan startar veckan som börjar</label><input type="date" data-mal="kondStart" value="${m.kondStart}">
    <div class="note">Nu: vecka ${kondTarget().vecka} i trappan.</div>
    <div class="inrow"><div><label class="f">Promenad efter måltid (min)</label><input type="number" data-mal="promenadMin" value="${m.promenadMin}"></div><div><label class="f">Vilotid mellan set (s)</label><input type="number" data-mal="vilaSek" value="${m.vilaSek}"></div></div>
    <div class="sec">Hälsovärden</div>
    <div class="inrow"><div><label class="f">Midjemått under (cm)</label><input type="number" data-mal="midja" value="${m.midja ?? ''}"></div><div><label class="f">Målvikt cirka (kg)</label><input type="number" inputmode="decimal" data-mal="vikt" value="${m.vikt ?? ''}"></div></div>
    <div class="note">Målen är utgångsvärden från underlaget och ingen garanti. Ingen automatisk rekommendation om viktminskning.</div></div>
    <div class="sf"><button class="btn pri block" data-a="saveMal">Spara</button></div>`, { onClose: backToSettings });
};
ACT.saveMal = () => {
  $$('[data-mal]').forEach(i => { const [k, sub] = i.dataset.mal.split('.'); if (k === 'kondStart') { S.mal.kondStart = i.value ? weekStart(i.value) : S.mal.kondStart; return; } const v = pnum(i.value); if (sub) S.mal[k][sub] = v; else S.mal[k] = v; });
  $$('[data-kt]').forEach(i => { const [ix, k] = i.dataset.kt.split('.'); const v = pnum(i.value); if (v != null) S.mal.kondTrappa[+ix][k] = v; });
  save(); closeSheet(); render(); toast('Målen sparade');
};

/* ---------- påminnelser ---------- */
ACT.setPamin = () => {
  const p = S.paminnelser; const t = (k, l) => `<label class="row sb" style="padding:8px 0"><span>${l}</span><span class="tog"><input type="checkbox" data-pm="${k}" ${p[k] ? 'checked' : ''}><span></span></span></label>`;
  openSheet(`${sheetHead('Påminnelser')}<div class="sbody"><div class="card">
    ${t('promenad', 'Promenad efter lunch/middag')}${t('veckouppfoljning', 'Veckouppföljning på söndagar')}${t('midja', 'Mät midjemått')}
    <div class="note">Visas på Idag-sidan när appen är öppen.</div></div>
    <div class="card"><h3>Påminnelser i telefonens kalender</h3><p class="small muted">En webbapp kan inte skicka notiser när den är stängd. Lägg i stället in återkommande händelser i kalendern – iPhone påminner då som vanligt.</p>
    <label class="f">Händelse</label><select id="icsT"><option value="walk">Promenad efter lunch (vardagar 12:45)</option><option value="walk2">Promenad efter middag (dagligen 18:45)</option><option value="train">Styrkepass (mån, ons, fre 17:30)</option><option value="review">Veckouppföljning (söndag 19:00)</option></select>
    <button class="btn block" data-a="makeIcs" style="margin-top:10px">Lägg till i kalendern (.ics)</button></div></div>
    <div class="sf"><button class="btn pri block" data-a="savePamin">Spara</button></div>`, { onClose: backToSettings });
};
ACT.savePamin = () => { $$('[data-pm]').forEach(i => S.paminnelser[i.dataset.pm] = i.checked); save(); closeSheet(); render(); };
ACT.makeIcs = () => {
  const k = $('#icsT').value; const d = new Date(); const ymd = x => `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}`;
  const conf = { walk: ['Promenad efter lunch', '124500', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 15], walk2: ['Promenad efter middag', '184500', 'FREQ=DAILY', 15], train: ['Styrkepass – ShapeApp', '173000', 'FREQ=WEEKLY;BYDAY=MO,WE,FR', 60], review: ['Veckouppföljning i ShapeApp', '190000', 'FREQ=WEEKLY;BYDAY=SU', 10] }[k];
  const start = `${ymd(d)}T${conf[1]}`; const endD = new Date(d); const [hh, mm] = [+conf[1].slice(0, 2), +conf[1].slice(2, 4) + conf[3]]; endD.setHours(hh + Math.floor(mm / 60), mm % 60);
  const end = `${ymd(endD)}T${pad(endD.getHours())}${pad(endD.getMinutes())}00`;
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ShapeApp//SV', 'BEGIN:VEVENT', `UID:${uid()}@shapeapp`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`, `DTSTART;TZID=Europe/Stockholm:${start}`, `DTEND;TZID=Europe/Stockholm:${end}`, conf[2] ? `RRULE:${conf[2]}` : '', `SUMMARY:${conf[0]}`, 'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${conf[0]}`, 'TRIGGER:-PT0M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
  download(`shapeapp-${k}.ics`, ics, 'text/calendar');
};

/* ---------- export / import ---------- */
function download(name, text, type) {
  const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}
ACT.exportJson = () => { download(`shapeapp-${today()}.json`, JSON.stringify({ app: 'ShapeApp', exporterad: new Date().toISOString(), data: S }, null, 1), 'application/json'); toast('Exporterad'); };
ACT.exportCsvMenu = () => openSheet(`${sheetHead('Exportera CSV')}<div class="sbody"><div class="list">
  <button class="li" data-a="csv" data-k="maltider"><div class="t">Måltider (en rad per livsmedel)</div></button>
  <button class="li" data-a="csv" data-k="traning"><div class="t">Styrketräning (en rad per set)</div></button>
  <button class="li" data-a="csv" data-k="kondition"><div class="t">Kondition</div></button>
  <button class="li" data-a="csv" data-k="matt"><div class="t">Vikt, midjemått, blodtryck, puls och sömn</div></button></div>
  <div class="note">Semikolonseparerad med decimalkomma – öppnas direkt i svenska Excel/Numbers.</div></div>`, { onClose: backToSettings });
ACT.csv = el => {
  const c = v => { if (v == null) return ''; if (typeof v === 'number') return String(Math.round(v * 100) / 100).replace('.', ','); const s = String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const k = el.dataset.k; let rows = [];
  if (k === 'maltider') { rows.push(['datum', 'tid', 'maltid', 'livsmedel', 'gram', ...NKEYS]); S.maltider.forEach(m => { const k = portionFactor(m); m.rader.forEach(r => { const n = rowNut(r); rows.push([m.datum, m.tid, m.typ, r.namn, r.g * k, ...NKEYS.map(x => n[x] * k)]); }); }); }
  if (k === 'traning') { rows.push(['datum', 'pass', 'ovning', 'muskelgrupp', 'set', 'kg', 'reps', 'sek', 'rpe', 'smarta']); S.pass.forEach(p => p.ovn.forEach(e => { const o = ovn(e.oid); e.set.forEach((s, i) => rows.push([p.datum, p.namn, o?.namn, o?.grupp, i + 1, s.kg, s.reps, s.sek, e.rpe, e.smarta ? 'ja' : ''])); })); }
  if (k === 'kondition') { rows.push(['datum', 'typ', 'minuter', 'intensitet', 'efter_maltid', 'anteckning']); S.kondition.forEach(x => rows.push([x.datum, x.typ, x.min, x.intensitet, x.efterMaltid ? 'ja' : 'nej', x.not])); }
  if (k === 'matt') { rows.push(['datum', 'typ', 'varde', 'systoliskt', 'diastoliskt', 'puls', 'forhallanden', 'anteckning']); S.halsa.matt.filter(m => MATT_TYPER[m.typ]).forEach(m => rows.push([m.datum, m.typ, m.v, m.sys, m.dia, m.puls, m.forh, m.not])); Object.entries(S.halsa.somn).forEach(([d, h]) => rows.push([d, 'somn_timmar', h, '', '', '', '', ''])); }
  download(`shapeapp-${k}-${today()}.csv`, '﻿' + rows.map(r => r.map(c).join(';')).join('\r\n'), 'text/csv');
};
ACT.importJson = () => { const f = $('#impFile'); f.value = ''; f.onchange = async () => { const file = f.files[0]; if (!file) return; try { const j = JSON.parse(await file.text()); const d = j.data || j; if (!d.profil || !d.maltider) throw new Error('fel format'); confirmBox('Importera och ersätta all data på den här enheten?', 'Importera', async () => { S = migrate(d); await Store.set('state', S); refreshOwnFoods(); buildExclusionIndex(); render(); toast('Data importerad'); Sync.schedule(); }); } catch (e) { toast('Kunde inte läsa filen: ' + e.message); } }; f.click(); };
ACT.wipeAll = () => confirmBox('Radera ALL data på den här enheten? Backupen på GitHub påverkas inte. Exportera gärna först.', 'Radera allt', async () => { S = defaultState(); await Store.set('state', S); refreshOwnFoods(); buildExclusionIndex(); UI.tab = 'idag'; render(); toast('All data raderad – startvärden återställda'); });

/* ---------- backup till privat GitHub-repo (krypterad) ---------- */
const b64e = buf => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const b64d = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));
const utf8b64 = s => b64e(new TextEncoder().encode(s));
const Crypt = {
  async key(pass, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },
  async enc(obj, pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const k = await this.key(pass, salt);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(JSON.stringify(obj)));
    return JSON.stringify({ app: 'ShapeApp', v: 1, kdf: 'PBKDF2-SHA256-250000', alg: 'AES-GCM-256', salt: b64e(salt), iv: b64e(iv), data: b64e(ct), tid: new Date().toISOString() });
  },
  async dec(text, pass) {
    const j = JSON.parse(text); const k = await this.key(pass, b64d(j.salt));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(j.iv) }, k, b64d(j.data));
    return JSON.parse(new TextDecoder().decode(pt));
  }
};
const Sync = {
  t: null, busy: false,
  ok() { const s = LOCAL.sync; return s && s.owner && s.repo && s.token && s.pass && s.auto !== false; },
  schedule() { if (!this.ok()) return; clearTimeout(this.t); this.t = setTimeout(() => this.push().catch(() => { }), 8000); },
  async explain(r, action) {
    let msg = ''; try { msg = (await r.json()).message || ''; } catch { }
    const s = LOCAL.sync, repo = `${s.owner}/${s.repo}`;
    const m = {
      401: 'Token är ogiltig eller har gått ut. Skapa en ny token och klistra in den.',
      403: `Token saknar skrivrätt. Ändra token på GitHub: Repository permissions → Contents: Read and write.`,
      404: `Hittar inte repot ${repo} med den här token. Kontrollera stavningen av användarnamn och repo, och att token har åtkomst till just ${s.repo} (Repository access → Only select repositories).`,
      409: 'Konflikt med en annan uppladdning. Försök igen om en stund.',
      422: 'GitHub nekade filen (422). Försök "Skriv över backupen".'
    }[r.status] || `GitHub svarade ${r.status}.`;
    return new Error(`${action}: ${m}${msg ? ' (' + msg + ')' : ''}`);
  },
  async checkRepo() {
    const s = LOCAL.sync;
    const r = await fetch(`https://api.github.com/repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}`, { headers: { Authorization: `Bearer ${s.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, cache: 'no-store' });
    if (!r.ok) throw await this.explain(r, 'Anslutningen misslyckades');
    const j = await r.json();
    if (!j.private) throw new Error(`Repot ${s.owner}/${s.repo} är publikt. Välj ett privat repo för backupen (Settings → General → Danger Zone → Change visibility).`);
    return j;
  },
  api(path, opt = {}) {
    const s = LOCAL.sync;
    return fetch(`https://api.github.com/repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}/contents/${path}`, { ...opt, headers: { Authorization: `Bearer ${s.token}`, Accept: opt.accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opt.headers || {}) }, cache: 'no-store' });
  },
  async remoteMeta() {
    const r = await this.api(LOCAL.sync.path || 'shapeapp-backup.json', { accept: 'application/vnd.github.object+json' });
    if (r.status === 404) return null;
    if (!r.ok) throw await this.explain(r, 'Kunde inte läsa backupen');
    return r.json();
  },
  async push(force = false) {
    if (this.busy || !navigator.onLine) return; this.busy = true;
    try {
      const meta = await this.remoteMeta();
      if (meta && meta.sha !== LOCAL.lastSha && !force) { LOCAL.syncErr = 'Backupen på GitHub har ändrats från en annan enhet. Välj återställ eller skriv över under Backup.'; await saveLocal(); return; }
      const body = await Crypt.enc(S, LOCAL.sync.pass);
      const r = await this.api(LOCAL.sync.path || 'shapeapp-backup.json', { method: 'PUT', body: JSON.stringify({ message: `ShapeApp backup ${new Date().toISOString()}`, content: utf8b64(body), ...(meta ? { sha: meta.sha } : {}) }) });
      if (!r.ok) throw await this.explain(r, 'Uppladdningen misslyckades');
      const j = await r.json(); LOCAL.lastSha = j.content.sha; LOCAL.lastSync = Date.now(); LOCAL.syncErr = null; await saveLocal();
    } catch (e) { LOCAL.syncErr = e.message; await saveLocal(); throw e; } finally { this.busy = false; }
  },
  async pull() {
    const meta = await this.remoteMeta(); if (!meta) throw new Error('Ingen backup hittades i repot');
    const r = await this.api(LOCAL.sync.path || 'shapeapp-backup.json', { accept: 'application/vnd.github.raw+json' });
    if (!r.ok) throw await this.explain(r, 'Kunde inte hämta backupen');
    const data = await Crypt.dec(await r.text(), LOCAL.sync.pass).catch(() => { throw new Error('Fel lösenfras eller skadad fil'); });
    return { data, sha: meta.sha };
  }
};
ACT.setSync = () => {
  const s = LOCAL.sync || { owner: '', repo: 'shapeapp-data', token: '', pass: '', path: 'shapeapp-backup.json', auto: true };
  openSheet(`${sheetHead('Backup till GitHub')}<div class="sbody">
    ${LOCAL.syncErr ? `<div class="banner warn">${esc(LOCAL.syncErr)}</div>` : ''}
    <p class="small muted">Datan krypteras på telefonen med din lösenfras (AES-256) innan den laddas upp till ett <b>privat</b> repo. Token och lösenfras sparas bara på den här enheten och följer aldrig med i export eller backup.</p>
    <details class="card"><summary>Så skapar du repo och token</summary><ol class="small" style="padding-left:18px;margin:8px 0 0">
      <li>På github.com: <b>New repository</b> → namn <code>shapeapp-data</code> → välj <b>Private</b> → kryssa i "Add a README" → Create.</li>
      <li>Profilbild → <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token</b>.</li>
      <li>Repository access: <b>Only select repositories</b> → <code>shapeapp-data</code>.</li>
      <li>Permissions → Repository permissions → <b>Contents: Read and write</b>. Välj en utgångstid, t.ex. 1 år.</li>
      <li>Kopiera token (börjar med <code>github_pat_</code>) och klistra in nedan.</li></ol></details>
    <label class="f">GitHub-användarnamn</label><input type="text" id="syO" value="${esc(s.owner)}" autocapitalize="off" autocorrect="off" spellcheck="false">
    <label class="f">Privat repo</label><input type="text" id="syR" value="${esc(s.repo)}" autocapitalize="off" autocorrect="off" spellcheck="false">
    <label class="f">Token</label><input type="password" id="syT" value="${esc(s.token)}" autocomplete="off">
    <label class="f">Lösenfras för kryptering</label><input type="password" id="syP" value="${esc(s.pass)}" autocomplete="new-password">
    <div class="note">Använd samma lösenfras på alla enheter. Glömmer du den går backupen inte att läsa – det finns ingen återställning.</div>
    <label class="row sb" style="margin-top:12px"><span>Automatisk backup efter ändringar</span><span class="tog"><input type="checkbox" id="syA" ${s.auto !== false ? 'checked' : ''}><span></span></span></label>
    <div class="btns" style="margin-top:14px"><button class="btn pri" data-a="syncSave">Spara och testa</button></div>
    ${s.repo ? `<div class="sec">Åtgärder</div><div class="btns"><button class="btn" data-a="syncNow">Backup nu</button><button class="btn" data-a="syncRestore">Återställ</button></div>
    <button class="btn block ${LOCAL.syncErr ? 'danger' : ''}" data-a="syncForce" style="margin-top:8px">Skriv över backupen med den här enhetens data</button>
    <button class="btn ghost block" data-a="syncOff" style="margin-top:8px">Koppla från backup på den här enheten</button>` : ''}
    <div class="note">Senaste backup: ${LOCAL.lastSync ? new Date(LOCAL.lastSync).toLocaleString('sv-SE') : 'aldrig'}. Varje backup blir en commit, så äldre versioner finns kvar i repots historik.</div></div>`, { id: 'sync', onClose: backToSettings });
};
ACT.syncSave = async () => {
  const s = { owner: $('#syO').value.trim().replace(/^@/, '').replace(/^https?:\/\/github\.com\//i, '').split('/')[0], repo: $('#syR').value.trim().replace(/^.*\//, '').replace(/\.git$/, ''), token: $('#syT').value.replace(/\s+/g, ''), pass: $('#syP').value, path: 'shapeapp-backup.json', auto: $('#syA').checked };
  if (!s.owner || !s.repo || !s.token || s.pass.length < 8) { toast('Fyll i alla fält – lösenfrasen minst 8 tecken'); return; }
  LOCAL.sync = s; await saveLocal(); toast('Testar anslutningen …', 5000);
  try {
    await Sync.checkRepo();
    const meta = await Sync.remoteMeta();
    if (meta && !LOCAL.lastSha) {
      try { await Sync.pull(); } catch (e) { toast(e.message, 4000); return; }
      LOCAL.syncErr = 'Det finns redan en backup i repot – välj Återställ eller Skriv över.'; await saveLocal();
      confirmBox('Det finns redan en backup i repot. Vill du hämta den till den här enheten? Välj Avbryt för att behålla nuvarande data – backupen skrivs inte över förrän du väljer det.', 'Hämta backup', doRestore, false);
      return;
    }
    await Sync.push(); toast('Backup klar ✓'); ACT.setSync();
  } catch (e) { LOCAL.syncErr = e.message; await saveLocal(); toast('Backupen fungerar inte – se meddelandet', 4000); ACT.setSync(); }
};
ACT.syncNow = async () => { try { await Sync.push(); toast('Backup klar ✓'); } catch (e) { toast(e.message, 5000); } ACT.setSync(); };
ACT.syncForce = () => confirmBox('Skriv över backupen på GitHub med data från den här enheten?', 'Skriv över', async () => { try { await Sync.push(true); toast('Backup klar ✓'); } catch (e) { toast(e.message, 5000); } });
async function doRestore() {
  try { const { data, sha } = await Sync.pull(); S = migrate(data); await Store.set('state', S); LOCAL.lastSha = sha; LOCAL.lastSync = Date.now(); LOCAL.syncErr = null; await saveLocal(); refreshOwnFoods(); buildExclusionIndex(); render(); toast('Återställd från GitHub ✓'); }
  catch (e) { toast(e.message, 5000); }
}
ACT.syncRestore = () => confirmBox('Ersätta data på den här enheten med backupen från GitHub?', 'Återställ', doRestore, false);
ACT.syncOff = () => confirmBox('Koppla från backup? Token och lösenfras tas bort från enheten. Backupen på GitHub ligger kvar.', 'Koppla från', async () => { LOCAL.sync = null; LOCAL.lastSha = null; LOCAL.syncErr = null; await saveLocal(); toast('Frånkopplad'); });

/* ---------- start ---------- */
function migrate(d) {
  const def = defaultState();
  for (const k of Object.keys(def)) if (d[k] === undefined) d[k] = def[k];
  for (const k of Object.keys(def.mal)) if (d.mal[k] === undefined) d.mal[k] = def.mal[k];
  for (const k of Object.keys(def.halsa)) if (d.halsa[k] === undefined) d.halsa[k] = def.halsa[k];
  return d;
}
async function init() {
  await Store.open();
  S = await Store.get('state');
  LOCAL = (await Store.get('local')) || { sync: null, lastSha: null, lastSync: null };
  if (!S) { S = defaultState(); await Store.set('state', S); } else S = migrate(S);
  await loadFoods();
  UI.tab = LOCAL.startTab || 'idag';
  render();
  if (S.aktivtPass) toast('Du har ett pågående pass');
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => { });
  // kontrollera om backupen ändrats från annan enhet
  if (Sync.ok() && navigator.onLine) Sync.remoteMeta().then(async m => { if (m && LOCAL.lastSha && m.sha !== LOCAL.lastSha) { LOCAL.syncErr = 'Backupen på GitHub är nyare än den här enhetens data. Öppna Inställningar → Backup.'; await saveLocal(); toast('Nyare backup finns på GitHub', 4000); } }).catch(() => { });
}
window.addEventListener('online', () => Sync.schedule());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && S) { Store.set('state', S); } });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => { }));
init();
