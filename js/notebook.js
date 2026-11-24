"use strict";

// The notebook: one month at a time, like a page of the user's paper notebook.
//   Totals (pinned at the top): freehand lines, then a ruled result row whose figure is worked out.
//   Expenses (scrolls below): lines without a tag first, then one section per tag, each with its
//   total, then the total of the whole expense area.
// Every part is plain ruled paper: a see-through text box over a drawn copy of the text (the
// "mirror"), so writing feels like a notes app. A finished line (Enter, or leaving the paper) is
// tidied to "− 4.00 bus"; "#major" in a line moves it to that tag's section. Pasting old notes
// runs the same clean-up as Import.

const nb = { months: new Map(), ym: null, comps: new Map(), areas: [], dirty: new Set(), timer: 0, saving: Promise.resolve() };
const LINE = 36;   // px between the rules; matches --line in app.css

// ---------- months ----------
const ymAdd = (ym, n) => { const d = new Date(+ym.slice(0, 4), +ym.slice(5) - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const blankMonth = (ym) => ({ ym, totals: "", links: [], resultLabel: "", untagged: "", sections: {} });
const savedYms = () => [...nb.months.values()].filter((m) => !m.unsaved).map((m) => m.ym).sort();

// A month that isn't stored yet is made up from the month before it (or the starter layout for
// the very first one). It is only stored once something is written on it.
function monthFor(ym) {
  if (nb.months.has(ym)) return nb.months.get(ym);
  const before = savedYms().filter((k) => k < ym).pop();
  const m = before ? nextMonthFrom(nb.months.get(before), ym) : savedYms().length ? blankMonth(ym) : starterMonth(ym, TAGS);
  m.unsaved = true;
  nb.months.set(ym, m);
  return m;
}
function monthRange() {
  const s = savedYms();
  const lo = s.length && s[0] < currentYm() ? s[0] : currentYm();
  const hi = s.length && s[s.length - 1] > currentYm() ? s[s.length - 1] : currentYm();
  const out = [];
  for (let ym = ymAdd(lo, -1); ym <= ymAdd(hi, 1); ym = ymAdd(ym, 1)) out.push(ym);
  return out;
}
const recompute = () => { nb.comps = computeAll([...nb.months.values()], TAGS); return nb.comps.get(nb.ym); };

// ---------- loading ----------
async function renderNotebook() {
  await nb.saving;
  nb.months = new Map((await store.all()).map((m) => [m.ym, m]));
  if (!nb.ym) nb.ym = currentYm();
  drawMonth();
}

function goMonth(ym) {
  flushSave();
  // An untouched made-up month is forgotten when you leave it.
  const m = nb.months.get(nb.ym);
  if (m && m.unsaved && !nb.dirty.has(nb.ym)) nb.months.delete(nb.ym);
  nb.ym = ym;
  drawMonth();
  $("nb-exp") && ($("nb-exp").scrollTop = 0);
}

function drawMonth() {
  const m = monthFor(nb.ym);
  recompute();
  nb.areas = [];

  // month bar: ‹ Sept 2026 ›   total
  const range = monthRange();
  const pick = el("select", { class: "nb-pick", "aria-label": "Month" },
    ...range.slice().reverse().map((ym) => el("option", { value: ym, text: monthTitle(ym) })));
  pick.value = nb.ym;
  pick.addEventListener("change", () => goMonth(pick.value));
  const prev = el("button", { type: "button", class: "nb-arrow", "aria-label": "Month before", text: "‹" });
  const next = el("button", { type: "button", class: "nb-arrow", "aria-label": "Month after", text: "›" });
  prev.disabled = nb.ym <= range[0];
  next.disabled = nb.ym >= range[range.length - 1];
  prev.addEventListener("click", () => goMonth(ymAdd(nb.ym, -1)));
  next.addEventListener("click", () => goMonth(ymAdd(nb.ym, 1)));
  const total = el("span", { id: "nb-total", class: "nb-total" });
  const bar = el("div", { class: "nb-bar" }, prev, pick, next, total);

  // Totals
  const tArea = paper("totals", null, "Totals", 3);
  const linkBar = el("div", { id: "nb-linkbar", class: "nb-linkbar", hidden: "" });
  const label = el("input", { class: "nb-reslabel", maxlength: "200", autocomplete: "off", enterkeyhint: "done",
    placeholder: "Available to spend next month", "aria-label": "Result label" });
  label.value = m.resultLabel || "";
  label.addEventListener("input", () => { m.resultLabel = label.value; schedule(); });
  label.addEventListener("keydown", (e) => { if (e.key === "Enter") label.blur(); });
  const result = el("div", { class: "nb-result" }, el("span", { id: "nb-resfig", class: "nb-fig" }), label);
  const totals = el("div", { class: "nb-totals" },
    el("div", { class: "nb-tscroll" }, el("div", { class: "nb-cap", text: "Totals" }), tArea.node), linkBar, result);

  // Expenses
  const exp = el("div", { id: "nb-exp", class: "nb-exp" }, paper("untagged", null, "Expenses without a tag", 2).node);
  for (const t of TAGS) {
    const a = paper("tag", t.id, `${t.name} expenses`, 2);
    const sec = el("section", { class: "nb-sec" },
      el("h3", { class: "nb-sechead" }, el("span", { text: `EXPENSES: ${t.name}` })), a.node,
      el("div", { class: "nb-foot" }, el("span", { class: "nb-fig", "data-tag": t.id }), el("span", { text: "total" })));
    sec.style.setProperty("--tc", t.color);
    exp.append(sec);
  }
  exp.append(el("div", { class: "nb-foot nb-grand" }, el("span", { id: "nb-expfig", class: "nb-fig" }), el("span", { text: "expenses total" })));

  $("nb-page").replaceChildren(bar, el("div", { class: "nb-book" }, totals, exp));
  for (const a of nb.areas) { a.area.value = textOf(a); fit(a); }
  const first = nb.areas.find((a) => a.kind === "untagged");
  if (first) first.area.placeholder = "write here, like: bus 4";
  tArea.area.placeholder = "+ 2000 Salary";
  showTotals();
}

// ---------- the paper ----------
function paper(kind, id, name, min) {
  const area = el("textarea", { class: "d-area", rows: "1", autocomplete: "off", autocapitalize: "sentences", spellcheck: "false",
    enterkeyhint: "enter", "aria-label": name });
  const mirror = el("div", { class: "d-mirror", "aria-hidden": "true" });
  const a = { kind, id, area, mirror, min, node: el("div", { class: "d-paper" }, mirror, area) };
  nb.areas.push(a);
  wireArea(a);
  return a;
}
const month = () => nb.months.get(nb.ym);
const textOf = (a) => { const m = month(); return a.kind === "totals" ? m.totals : a.kind === "untagged" ? m.untagged : m.sections[a.id] || ""; };
function setText(a, text, m = month()) {
  if (a.kind === "totals") { m.links = spliceLinks(m.links, m.totals, text); m.totals = text; }
  else if (a.kind === "untagged") m.untagged = text;
  else m.sections[a.id] = text;
}
const areaFor = (kind, id) => nb.areas.find((a) => a.kind === kind && (id == null || a.id === id));

// The paper grows with what is written, keeping one empty line to write on below it.
function fit(a) {
  if (!a.area.isConnected) return;
  const box = a.area.closest(".nb-exp, .nb-tscroll");
  const y = box ? box.scrollTop : 0;
  a.area.style.height = "0";
  const extra = a.area.value === "" || a.area.value.endsWith("\n") ? 0 : LINE;
  a.area.style.height = `${Math.max(a.min * LINE, a.area.scrollHeight + extra)}px`;
  if (box) box.scrollTop = y;
  drawMirror(a);
}

// The copy under the text box: the same characters (so the caret lines up), with the sign and
// figure inked, rules drawn as rules, and the filled-in figures of linked Totals lines on the right.
const FORMATTED = /^([+−]) ([ \d.]+)(?=$| )/;
function drawMirror(a) {
  const c = nb.comps.get(nb.ym);
  const rows = a.area.value.split("\n").map((line, i) => {
    if (!line.trim()) return el("div", { class: "d-ml", text: "​" });
    if (isMarker(line)) return el("div", { class: "d-ml d-rule", text: line });
    const row = el("div", { class: "d-ml" });
    const f = line.match(FORMATTED);
    if (f) {
      row.append(el("span", { class: f[1] === "+" ? "d-plus" : "d-minus", text: f[1] }), " ",
        el("span", { class: "d-num", text: f[2] }), line.slice(f[0].length));
    } else row.append(line);
    const v = a.kind === "totals" && c && c.vals[i];
    if (v && v.auto) row.prepend(el("span", { class: "d-auto", title: v.auto === "carry" ? "From last month" : "From the expenses", text: signedLine(v.v, "").trim() }));
    return row;
  });
  a.mirror.replaceChildren(...rows);
}
window.addEventListener("resize", () => nb.areas.forEach(fit));

// Totals that follow the page: section totals, the expense total, the result and the month's total.
function showTotals() {
  const c = recompute();
  const fig = (v) => signedLine(v, "").trim();
  for (const node of document.querySelectorAll(".nb-fig[data-tag]")) node.textContent = fig(c.tagTotals[node.dataset.tag] || 0);
  $("nb-expfig").textContent = fig(c.expenses);
  $("nb-resfig").textContent = c.result === null ? "—" : fig(c.result);
  $("nb-total").textContent = money(c.total);
  const t = areaFor("totals");
  if (t) drawMirror(t);
  showLinkBar();
}

// ---------- linking a Totals line ----------
// With the caret on a Totals line that has no figure: "Fills in: [Regular total ▾]".
function caretLine(area) { return area.value.slice(0, area.selectionStart).split("\n").length - 1; }
function showLinkBar() {
  const bar = $("nb-linkbar"), a = areaFor("totals");
  if (!bar || !a) return;
  const i = caretLine(a.area);
  const v = document.activeElement === a.area && nb.comps.get(nb.ym).vals[i];
  if (!v || v.v !== null && !v.auto) { bar.hidden = true; return; }
  const sel = el("select", { "aria-label": "This line fills in" },
    el("option", { value: "prev", text: "Last month's result" }),
    ...TAGS.map((t) => el("option", { value: `tag:${t.id}`, text: `${t.name} total` })),
    el("option", { value: "none", text: "Nothing (I'll write the figure)" }));
  sel.value = v.link || "none";
  sel.addEventListener("change", () => {
    const m = month();
    while (m.links.length <= i) m.links.push(null);
    m.links[i] = sel.value;
    schedule();
    showTotals();
    a.area.focus();
  });
  bar.replaceChildren(el("span", { text: "This line fills in" }), sel);
  bar.hidden = false;
}
document.addEventListener("selectionchange", () => {
  const a = nb.areas.find((x) => x.area === document.activeElement);
  if (a && a.kind === "totals") showLinkBar();
});

// ---------- writing ----------
function wireArea(a) {
  const area = a.area;
  const live = () => nb.areas.includes(a);   // false once the month has been redrawn
  area.addEventListener("input", (e) => {
    if (!live()) return;
    setText(a, area.value);
    if (e.inputType === "insertLineBreak" || e.inputType === "insertParagraph") finishLines(a, caretLine(area) - 1);
    fit(a);
    showTotals();
    schedule();
  });
  area.addEventListener("focus", () => { if (a.kind === "totals") showLinkBar(); });
  area.addEventListener("blur", () => {
    if (!live()) return;
    finishLines(a);
    flushSave();
    // keep the link bar while its menu is being used
    setTimeout(() => { if (!$("nb-linkbar")?.contains(document.activeElement)) $("nb-linkbar") && ($("nb-linkbar").hidden = true); }, 0);
  });
  area.addEventListener("paste", (e) => {
    const text = e.clipboardData && e.clipboardData.getData("text/plain");
    if (!text || !text.includes("\n")) return;
    e.preventDefault();
    pasteNotes(a, text);
  });
  area.addEventListener("keydown", (e) => {
    const v = area.value, pos = area.selectionStart;
    if ((e.key === "ArrowDown" && !v.includes("\n", pos)) || (e.key === "ArrowUp" && !v.slice(0, pos).includes("\n"))) {
      // Past the first or last line: on to the next part of the page.
      const next = nb.areas[nb.areas.indexOf(a) + (e.key === "ArrowUp" ? -1 : 1)];
      if (!next) return;
      e.preventDefault();
      next.area.focus();
      const at = e.key === "ArrowUp" ? next.area.value.length : 0;
      next.area.setSelectionRange(at, at);
    }
  });
}

// Tidies finished lines ("bus 4" -> "− 4.00 bus") and acts on "#tag" marks: in the expense area
// the line moves to that tag's section; in Totals the line is linked to that tag's total.
// only: the index of the one line to finish (after Enter), or undefined for all of them.
function finishLines(a, only) {
  const area = a.area, m = month();
  const lines = area.value.split("\n");
  const caret = area.selectionStart;
  const cLine = area.value.slice(0, caret).split("\n").length - 1;
  const cCol = caret - area.value.lastIndexOf("\n", caret - 1) - 1;
  const moves = [];
  const links = a.kind === "totals" ? spliceLinks(m.links, m.totals, area.value) : null;
  const out = [];
  let caretShift = 0;
  lines.forEach((line, i) => {
    if (only != null && i !== only) { out.push(line); return; }
    const mark = takeTagMark(line, TAGS);
    if (mark.tag && a.kind !== "totals" && !(a.kind === "tag" && a.id === mark.tag.id)) {
      if (mark.text) moves.push({ tag: mark.tag, text: normalizeLine(mark.text) });
      if (i < cLine) caretShift++;
      return;                                   // the line leaves this paper
    }
    if (mark.tag && a.kind === "totals") links[i] = `tag:${mark.tag.id}`;
    out.push(normalizeLine(mark.tag ? mark.text : line));
  });
  const text = out.join("\n");
  if (text === area.value && !moves.length) return;
  if (links) {
    // links follow their lines; a moved-out line can't happen in Totals, so the count is the same
    m.links = links;
    m.totals = text;
  } else setText(a, text);
  area.value = text;
  if (document.activeElement === area) {
    const li = Math.max(0, cLine - caretShift);
    const before = out.slice(0, li).reduce((n, l) => n + l.length + 1, 0);
    const col = only != null && only === cLine ? (out[li] || "").length : Math.min(cCol, (out[li] || "").length);
    area.setSelectionRange(before + col, before + col);
  }
  fit(a);
  for (const mv of moves) {
    const target = areaFor("tag", mv.tag.id);
    appendText(target, [mv.text]);
    toast(`Moved to ${mv.tag.name}`);
  }
  showTotals();
  schedule();
}

function appendText(a, lines, m = month()) {
  const cur = (a ? textOf(a) : "").replace(/\n+$/, "");
  const text = [cur, ...lines].filter((x, i) => i > 0 || x).join("\n");
  if (a && m === month()) { setText(a, text, m); a.area.value = text; fit(a); }
  return text;
}

// ---------- paste ----------
// Pasted lines go where they belong: a month banner ("Oct 2026") sends what follows to that month,
// lines before any "EXPENSES: X" header go to Totals (in a month block) or stay where you pasted,
// and lines under a header go to that tag's section (the tag is made if it is new). Rules, "total"
// lines and old subtotals are dropped, like Import.
async function pasteNotes(a, text) {
  const blocks = parseNotes(text, TAGS);
  const touched = new Set([nb.ym]);
  let created = [];
  for (const b of blocks) {
    const ym = b.ym || nb.ym;
    const m = b.ym ? monthFor(b.ym) : month();
    // A pasted month block replaces a made-up month's starter lines instead of being added under them.
    if (b.ym && m.unsaved && !nb.dirty.has(ym)) Object.assign(m, blankMonth(ym), { unsaved: true });
    touched.add(ym);
    if (b.ym || a.kind === "totals") {
      const t = cleanTotals(b.head);
      if (t.lines.length) {
        if (!b.ym) insertAtCaret(a, t.lines);
        else { const old = m.totals; m.totals = [old.replace(/\n+$/, ""), ...t.lines].filter((x, i) => i > 0 || x).join("\n"); m.links = spliceLinks(m.links, old, m.totals); }
      }
      if (t.resultLabel && (b.ym || !m.resultLabel)) m.resultLabel = t.resultLabel;
    } else {
      const lines = cleanExpense(b.head);
      if (lines.length) insertAtCaret(a, lines);
    }
    for (const s of b.sections) {
      const lines = cleanExpense(s.lines);
      if (!s.name) { m.untagged = appendLinesTo(m.untagged, lines); continue; }
      let tag = tagNamed(s.name, TAGS);
      if (!tag) { tag = addTag(s.name); if (tag) created.push(tag.name); }
      if (!tag) { m.untagged = appendLinesTo(m.untagged, lines); continue; }
      m.sections[tag.id] = appendLinesTo(m.sections[tag.id] || "", lines);
    }
    if (b.ym) {
      const prev = computeAll([...nb.months.values()].filter((x) => x.ym < ym), TAGS);
      const before = [...prev.keys()].pop();
      relinkTotals(m, TAGS, before ? prev.get(before).result : null);
    }
  }
  for (const ym of touched) { nb.months.get(ym).unsaved = false; nb.dirty.add(ym); }
  flushSave();
  drawMonth();
  const others = [...touched].filter((ym) => ym !== nb.ym).map(monthTitle);
  toast([others.length ? `Added to ${others.join(", ")}` : "Pasted", created.length ? `new tag${created.length > 1 ? "s" : ""}: ${created.join(", ")}` : ""].filter(Boolean).join(" · "));
}
const appendLinesTo = (text, lines) => [String(text || "").replace(/\n+$/, ""), ...lines].filter((x, i) => i > 0 || x).join("\n");
function insertAtCaret(a, lines) {
  const area = a.area, v = area.value;
  const s = area.selectionStart, e = area.selectionEnd;
  const head = v.slice(0, s), tail = v.slice(e);
  const ins = (head && !head.endsWith("\n") ? "\n" : "") + lines.join("\n") + (tail && !tail.startsWith("\n") ? "\n" : "");
  const text = head + ins + tail;
  setText(a, text);
  area.value = text;
}

// ---------- saving ----------
function schedule() {
  nb.dirty.add(nb.ym);
  const m = month();
  if (m) m.unsaved = false;
  clearTimeout(nb.timer);
  nb.timer = setTimeout(flushSave, 800);
}
function flushSave() {
  clearTimeout(nb.timer);
  const list = [...nb.dirty].map((ym) => nb.months.get(ym)).filter(Boolean);
  nb.dirty.clear();
  if (!list.length) return nb.saving;
  // Links worked out by matching are kept, so they survive the label being reworded later.
  const comps = computeAll([...nb.months.values()], TAGS);
  for (const m of list) {
    const c = comps.get(m.ym);
    m.links = c.vals.map((v, i) => (m.links[i] || (v && v.link && v.v !== null && v.auto ? v.link : null)));
  }
  nb.saving = nb.saving.then(() => store.put(...list)).then((saved) => {
    for (const s of saved) { const m = nb.months.get(s.ym); if (m) m.updatedAt = s.updatedAt; }
  }).catch((err) => toast(err.message));
  return nb.saving;
}
// Leaving the app saves what is still waiting, then backs up to Drive.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) return;
  for (const a of nb.areas) if (document.activeElement === a.area) finishLines(a);
  flushSave().then(() => drive.backup({ quiet: true }));
});
