"use strict";

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);

function el(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  node.append(...kids);
  return node;
}
const pad = (n) => String(n).padStart(2, "0");
const currentYm = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const todayStr = () => `${currentYm()}-${pad(new Date().getDate())}`;
const readJson = (key) => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } };
const writeJson = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage full */ } };

// ---------- currency ----------
// Asked once on first launch; any currency the browser knows. Figures on the paper stay plain
// numbers like in a paper notebook; the symbol shows on the month's total.
const REGION_CURRENCY = { GB: "GBP", IN: "INR", US: "USD", CA: "CAD", AU: "AUD", NZ: "NZD", JP: "JPY", CN: "CNY", SG: "SGD",
  AE: "AED", ZA: "ZAR", CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK", PK: "PKR", BD: "BDT", LK: "LKR", NP: "NPR", BR: "BRL",
  MX: "MXN", HK: "HKD", KR: "KRW", MY: "MYR", PH: "PHP", ID: "IDR", TH: "THB", NG: "NGN", KE: "KES", SA: "SAR", TR: "TRY",
  PL: "PLN", IE: "EUR", DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", BE: "EUR", AT: "EUR", PT: "EUR", FI: "EUR", GR: "EUR" };
function guessCurrency() {
  try { return REGION_CURRENCY[new Intl.Locale(navigator.language).maximize().region] || "USD"; } catch { return "USD"; }
}
let CURRENCY = localStorage.getItem("currency") || "";
function money(paise) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY || guessCurrency(), minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100);
  } catch { return (paise / 100).toFixed(2); }
}
function allCurrencies() {
  let codes = [];
  try { codes = Intl.supportedValuesOf("currency"); } catch { codes = [...new Set(Object.values(REGION_CURRENCY))]; }
  let names = null;
  try { names = new Intl.DisplayNames(undefined, { type: "currency" }); } catch { /* old browser */ }
  return codes.map((code) => ({ code, name: names ? names.of(code) : code }));
}
// The currency picker: a search box over every currency. Resolves when one is chosen.
function chooseCurrency(firstRun) {
  return new Promise((resolve) => {
    const dlg = $("cur-dialog"), list = $("cur-list"), search = $("cur-search");
    const all = allCurrencies();
    const start = CURRENCY || guessCurrency();
    $("cur-cancel").hidden = firstRun;
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const hits = all.filter((c) => !q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
      hits.sort((a, b) => (b.code === start) - (a.code === start));
      list.replaceChildren(...hits.map((c) => {
        const b = el("button", { type: "button", class: "cur-item" + (c.code === start ? " on" : "") },
          el("b", { text: c.code }), el("span", { text: c.name }));
        b.addEventListener("click", () => {
          CURRENCY = c.code;
          try { localStorage.setItem("currency", c.code); } catch { /* storage full */ }
          dlg.close();
          resolve(c.code);
        });
        return b;
      }));
    };
    search.value = "";
    search.oninput = draw;
    $("cur-cancel").onclick = () => { dlg.close(); resolve(null); };
    dlg.oncancel = (e) => { if (firstRun) e.preventDefault(); else resolve(null); };
    draw();
    dlg.showModal();
  });
}

// ---------- tags ----------
// Each tag is a section of the expense area: { id (never changes), name, color }. The notebook
// and the Totals links point at the id, so renaming a tag keeps everything joined up.
const BASE_TAGS = [{ id: "regular", name: "Regular", color: "#3a6b9a" }, { id: "major", name: "Major", color: "#c2410c" }];
const TAG_PALETTE = ["#3a6b9a", "#c2410c", "#0f766e", "#a21caf", "#b91c1c", "#4d7c0f", "#0369a1", "#7c3aed", "#a16207"];
const validTags = (v) => (Array.isArray(v) ? v.filter((t) => t && typeof t.id === "string" && typeof t.name === "string" && /^#[0-9a-f]{6}$/i.test(t.color)) : null);
const TAGS = validTags(readJson("tags")) || BASE_TAGS.map((t) => ({ ...t }));
const saveTags = () => writeJson("tags", TAGS);
const nextTagColor = () => TAG_PALETTE.find((c) => !TAGS.some((t) => t.color === c)) || TAG_PALETTE[TAGS.length % TAG_PALETTE.length];
const tagById = (id) => TAGS.find((t) => t.id === id) || null;

// "  eating   out " -> "eating out"; null if it is not a usable name.
function cleanTagName(raw) {
  const name = String(raw).replace(/^\s*expenses?\s*[:\-]\s*/i, "").trim().split(/\s+/).join(" ");
  return name && name.length <= 30 && words(name).length ? name : null;
}
// Adds a tag (or returns the one with the same words). null if the name is not usable.
function addTag(raw, color) {
  const name = cleanTagName(raw);
  if (!name) return null;
  const same = tagNamed(name, TAGS);
  if (same) return same;
  const base = words(name).join("-").slice(0, 20) || "tag";
  let id = base;
  for (let n = 2; TAGS.some((t) => t.id === id); n++) id = `${base}-${n}`;
  const tag = { id, name, color: color || nextTagColor() };
  TAGS.push(tag);
  saveTags();
  return tag;
}

// ---------- toast ----------
let toastTimer;
function toast(msg, actionLabel, action) {
  $("toast-msg").textContent = msg;
  const btn = $("toast-action");
  btn.hidden = !actionLabel;
  btn.textContent = actionLabel || "";
  btn.onclick = actionLabel ? async () => { hideToast(); await action(); } : null;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, actionLabel ? 7000 : 4000);
}
function hideToast() { $("toast").hidden = true; }

// ---------- import and export ----------
function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = el("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function savedMonths() {
  await flushSave();
  return (await store.all()).filter((m) => !isEmptyMonth(m));
}
$("export-txt").addEventListener("click", async () => {
  try {
    const months = await savedMonths();
    if (!months.length) { toast("Nothing written yet"); return; }
    const comps = computeAll(months, TAGS);
    download(`expenses-${todayStr()}.txt`, months.map((m) => monthToText(m, TAGS, comps.get(m.ym))).join("\n"), "text/plain");
    localStorage.setItem("lastDownload", String(Date.now()));
    toast(`Downloaded ${months.length} month${months.length === 1 ? "" : "s"} as text`);
  } catch (err) { toast(err.message); }
});
$("export-csv").addEventListener("click", async () => {
  try {
    const months = await savedMonths();
    if (!months.length) { toast("Nothing written yet"); return; }
    download(`expenses-${todayStr()}.csv`, monthsToCsv(months, TAGS, computeAll(months, TAGS)), "text/csv");
    localStorage.setItem("lastDownload", String(Date.now()));
    toast(`Downloaded ${months.length} month${months.length === 1 ? "" : "s"} as CSV`);
  } catch (err) { toast(err.message); }
});

// Old notes (.txt in the notebook format, or a CSV this app made) -> months.
// A month that already has entries is only replaced if you say so.
async function importText(text, filename) {
  const csv = /\.csv$/i.test(filename || "") || /^﻿?month,section,/i.test(text);
  const drafts = (csv ? csvToDrafts(text) : parseNotes(text, TAGS).map(blockToDraft)).filter((d) => d.ym);
  if (!drafts.length) throw new Error("No months found. Each month should start with a line like “Sept 2026”.");
  await flushSave();
  const existing = new Map((await store.all()).map((m) => [m.ym, m]));
  const chosen = [];
  let newTags = 0;
  for (const d of drafts) {
    const old = existing.get(d.ym);
    if (old && !isEmptyMonth(old) && !confirm(`${monthTitle(d.ym)} already has entries. Replace it with the imported one?`)) continue;
    const m = { ym: d.ym, totals: d.totals, links: [], resultLabel: d.resultLabel || "", untagged: d.untagged, sections: {} };
    for (const s of d.sections) {
      const had = TAGS.length;
      const tag = addTag(s.name);
      if (TAGS.length > had) newTags++;
      if (tag) m.sections[tag.id] = [m.sections[tag.id], s.text].filter(Boolean).join("\n");
      else m.untagged = [m.untagged, s.text].filter(Boolean).join("\n");
    }
    chosen.push(m);
  }
  if (!chosen.length) return 0;
  // Totals figures that just repeat a tag's total or last month's result are linked again.
  const all = new Map(existing);
  for (const m of chosen) all.set(m.ym, m);
  let prev = null;
  for (const m of [...all.values()].sort((a, b) => (a.ym < b.ym ? -1 : 1))) {
    if (chosen.includes(m)) relinkTotals(m, TAGS, prev);
    prev = computeMonth(m, TAGS, prev).result;
  }
  await store.put(...chosen);
  toast(`Imported ${chosen.length} month${chosen.length === 1 ? "" : "s"}${newTags ? `, ${newTags} new tag${newTags === 1 ? "" : "s"}` : ""}`);
  return chosen.length;
}
$("import").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    if (file.size > 5e6) throw new Error("That file is too big");
    const n = await importText(await file.text(), file.name);
    await show(HOME);
    if (!n) toast("Nothing imported");
  } catch (err) { toast(err.message); }
});

// ---------- menu ----------
function drawMenu() {
  const on = drive.connected();
  $("drive-btn").textContent = !drive.configured() ? "Google Drive (not set up)" : on ? "Back up to Drive now" : "Connect Google Drive";
  $("drive-off").hidden = !on;
  $("currency-btn").textContent = `Currency: ${CURRENCY || guessCurrency()}`;
  $("theme-btn").textContent = `Theme: ${themeName()[0].toUpperCase()}${themeName().slice(1)}`;
  $("backup-note").textContent = drive.note();
}
$("menu-btn").addEventListener("click", (e) => {
  e.stopPropagation(); closePop();   // one open at a time
  $("menu").hidden = !$("menu").hidden;
  if (!$("menu").hidden) drawMenu();   // after opening, so a failing label never keeps the menu shut
});
$("menu").addEventListener("click", (e) => e.stopPropagation());
document.addEventListener("click", () => { $("menu").hidden = true; closePop(); });
for (const b of $("menu").querySelectorAll("button")) b.addEventListener("click", () => { if (b.id !== "theme-btn") $("menu").hidden = true; });

$("drive-btn").addEventListener("click", async () => {
  if (!drive.configured()) { toast("Add your Worker address to js/config.js first (see the README)"); return; }
  if (!drive.connected()) { await flushSave(); drive.connect(); return; }
  await flushSave();
  await drive.backup({ force: false, manual: true });
});
$("drive-off").addEventListener("click", async () => {
  if (!confirm("Stop backing up to Google Drive? The files already in Drive stay there.")) return;
  await drive.disconnect();
  toast("Google Drive disconnected");
});
$("currency-btn").addEventListener("click", async () => { const c = await chooseCurrency(false); if (c) { await show(currentView); toast(`Currency set to ${c}`); } });
$("theme-btn").addEventListener("click", () => {
  try { localStorage.setItem("theme", themeName() === "dark" ? "light" : "dark"); } catch { /* storage full */ }
  applyTheme();
  syncThemeColor();
  drawMenu();
});

// ---------- settings popover: which Totals lines fill in, and the tags ----------
async function openPop() {
  await flushSave();
  const ym = monthInView();
  $("pop-links-title").textContent = `Filled in · ${monthTitle(ym)}`;
  const rows = linkChoices(ym);
  $("pop-links").replaceChildren(...(rows.length ? rows : [el("p", { class: "hint", text: "Nothing to fill in this month." })]));
  await renderTags();
  $("pop").hidden = false;
  $("set-btn").setAttribute("aria-expanded", "true");
}
function closePop() {
  if ($("pop").hidden) return;
  $("pop").hidden = true;
  $("set-btn").setAttribute("aria-expanded", "false");
}
$("set-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  $("menu").hidden = true;
  if ($("pop").hidden) openPop().catch((err) => toast(err.message)); else closePop();
});
$("pop").addEventListener("click", (e) => { e.stopPropagation(); closePickers(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closePop(); $("menu").hidden = true; } });

// ---------- the screen ----------
const HOME = "notebook";
let currentView = HOME;

// The phone's status bar takes the colour of the screen behind the header (meta theme-color).
function syncThemeColor() {
  const bg = getComputedStyle(document.body).backgroundColor;
  document.querySelector('meta[name="theme-color"]').content = bg;
}

async function show() {
  document.body.classList.add("nb");
  syncThemeColor();
  try { await renderNotebook(); } catch (err) { console.error(err); toast(err.message); }
}

// ---------- boot ----------
async function init() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
  try {
    await store.ready();
  } catch (err) {
    document.body.textContent = `Could not open the storage on this phone: ${err.message}`;
    return;
  }
  const driveMsg = drive.takeKeyFromUrl();
  $("app").hidden = false;
  if (!CURRENCY) await chooseCurrency(true);
  if (location.hash === "#tags") history.replaceState(null, "", location.pathname + location.search);
  await show(HOME);
  if (driveMsg) toast(driveMsg);
  drive.backup({ quiet: true, daily: true });
}
// Start once every script (format, local, app, notebook, tags, drive) has loaded.
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
