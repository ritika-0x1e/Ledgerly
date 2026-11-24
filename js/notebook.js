"use strict";

// The notebook: the months run on as one long scroll, newest first, like the pages of a paper
// notebook. Each month is a sheet with its name and total pinned at the top while you are in it:
//   Totals: freehand lines, then the result line whose figure is worked out;
//   then the lines without a tag, then one section per tag with its total, then the expenses total.
// Every part is plain ruled paper: a see-through text box over a drawn copy of the text (the
// "mirror"), so writing feels like a notes app. A finished line (Enter, or leaving the paper) is
// tidied to "    4.00 bus" (figure first; only a "+" you type is shown). "#major" in a line moves it
// to that tag's section. Pasting old notes runs the same clean-up as Import.
// Which Totals lines fill themselves in, and the tags, are changed in the settings popover.

const nb = { months: new Map(), comps: new Map(), yms: [], shown: 0, cards: new Map(), areas: [], dirty: new Set(),
  timer: 0, saving: Promise.resolve(), observer: null, tidied: false, announce: false, changed: false };
const LINE = 32;   // px between the rules; matches --line-h in app.css

// ---------- months ----------
const ymAdd = (ym, n) => { const d = new Date(+ym.slice(0, 4), +ym.slice(5) - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const blankMonth = (ym) => ({ ym, totals: "", links: [], resultLabel: "", untagged: "", sections: {} });
const savedYms = () => [...nb.months.values()].filter((m) => !m.unsaved).map((m) => m.ym).sort();
const longMonth = (ym) => new Date(+ym.slice(0, 4), +ym.slice(5) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });

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
// Every month from the newest (this month, or a later one already written) back to the oldest.
function monthList() {
  const s = savedYms();
  const hi = s.length && s[s.length - 1] > currentYm() ? s[s.length - 1] : currentYm();
  const lo = s.length && s[0] < hi ? s[0] : hi;
  const out = [];
  for (let ym = hi; ym >= lo; ym = ymAdd(ym, -1)) out.push(ym);
  return out;
}
const recompute = () => { nb.comps = computeAll([...nb.months.values()], TAGS); };

// Months saved before figures were written in a column ("− 4.00 bus") are tidied once.
async function tidyStored() {
  if (nb.tidied) return;
  nb.tidied = true;
  const tidy = (text, col) => String(text || "").split("\n").map((l) => normalizeLine(l, col)).join("\n");
  const changed = [];
  for (const m of nb.months.values()) {
    const next = { totals: tidy(m.totals, true), untagged: tidy(m.untagged), sections: {} };
    for (const [id, t] of Object.entries(m.sections)) next.sections[id] = tidy(t);
    if (next.totals !== m.totals || next.untagged !== m.untagged || Object.keys(next.sections).some((id) => next.sections[id] !== m.sections[id])) {
      Object.assign(m, next);
      changed.push(m);
    }
  }
  if (changed.length) await store.put(...changed).catch(() => {});
}

// ---------- drawing ----------
async function renderNotebook() {
  await nb.saving;
  nb.months = new Map((await store.all()).map((m) => [m.ym, m]));
  await tidyStored();
  redraw();
}

// Draws the months again (after a paste, a tag change or an import), keeping your place.
function redraw() {
  const y = window.scrollY;
  nb.yms = monthList();
  for (const ym of nb.yms) monthFor(ym);
  nb.shown = Math.min(nb.yms.length, Math.max(nb.shown, 2));
  nb.cards = new Map();
  nb.areas = [];
  recompute();
  $("nb-page").replaceChildren(...nb.yms.slice(0, nb.shown).map(drawCard));
  afterDraw();
  window.scrollTo(0, y);
  drawMore();
}
function afterDraw() {
  for (const a of nb.areas) if (!a.drawn) { a.drawn = true; a.area.value = textOf(a); fit(a); }
  const first = nb.areas.find((a) => a.kind === "untagged");
  if (first) first.area.placeholder = "write here, like: bus 4";
  showTotals();
}

// Older months come in as you scroll down to them (the button is there too).
function drawMore() {
  const more = $("nb-more");
  more.replaceChildren();
  if (nb.shown >= nb.yms.length) return;
  const btn = el("button", { type: "button", text: `Turn back to ${longMonth(nb.yms[nb.shown])}` });
  btn.addEventListener("click", loadOlder);
  more.append(btn);
  if (!("IntersectionObserver" in window)) return;
  if (!nb.observer) nb.observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadOlder(); }, { rootMargin: "400px 0px" });
  nb.observer.disconnect();
  nb.observer.observe(more);   // observing again re-checks, so a short month keeps loading
}
function loadOlder() {
  if (nb.shown >= nb.yms.length) return;
  $("nb-page").append(drawCard(nb.yms[nb.shown]));
  nb.shown++;
  afterDraw();
  drawMore();
}

// One month: a sheet with its name and total pinned on top while you scroll through it.
function drawCard(ym) {
  const m = monthFor(ym);
  const card = { ym, total: el("span", { class: "d-monthtotal" }), tagFigs: new Map(), expFig: figNode(), resFig: figNode(), totals: null };

  const tArea = paper(ym, "totals", null, `Totals, ${monthTitle(ym)}`, 1);
  card.totals = tArea;
  tArea.area.placeholder = "+2000 Salary";
  const label = el("input", { class: "d-reslabel", maxlength: "200", autocomplete: "off", enterkeyhint: "done",
    placeholder: "Available to spend next month", "aria-label": `Result label, ${monthTitle(ym)}` });
  label.value = m.resultLabel || "";
  label.addEventListener("input", () => { m.resultLabel = label.value; schedule(ym); });
  label.addEventListener("keydown", (e) => { if (e.key === "Enter") label.blur(); });
  label.addEventListener("blur", () => flushSave({ announce: true }));

  const sheet = el("div", { class: "d-page" },
    el("section", { class: "d-sec d-totals" }, tArea.node, el("div", { class: "d-secfoot d-result" }, card.resFig.node, label)),
    el("section", { class: "d-sec" }, paper(ym, "untagged", null, `Expenses without a tag, ${monthTitle(ym)}`, 1).node));
  for (const t of TAGS) {
    const fig = figNode();
    card.tagFigs.set(t.id, fig);
    const sec = el("section", { class: "d-sec d-tagged" },
      el("h3", { class: "d-sechead", text: t.name }), paper(ym, "tag", t.id, `${t.name}, ${monthTitle(ym)}`, 1).node,
      el("div", { class: "d-secfoot" }, fig.node, el("span", { class: "d-footlabel", text: "total" })));
    sec.style.setProperty("--tc", t.color);
    sheet.append(sec);
  }
  sheet.append(el("div", { class: "d-total" }, card.expFig.node, el("span", { class: "d-footlabel", text: "spent this month" })));

  nb.cards.set(ym, card);
  return el("section", { class: "d-monthgroup", "data-ym": ym },
    el("h2", { class: "d-month" }, el("span", { class: "d-monthname", text: longMonth(ym) }), card.total), sheet);
}

// A worked-out figure in the figure column, with a short stroke over it like a hand-written sum.
function figNode() {
  const padN = el("span", { class: "d-pad" }), sum = el("span", { class: "d-sum" });
  return { node: el("span", { class: "d-figcol" }, sum, padN, " "), set(text) {
    const t = text.trim();
    padN.textContent = FIG.repeat(Math.max(0, COL - t.length));
    sum.textContent = t;
  } };
}

// ---------- the paper ----------
function paper(ym, kind, id, name, min) {
  const area = el("textarea", { class: "d-area", rows: "1", autocomplete: "off", autocapitalize: "sentences", spellcheck: "false",
    enterkeyhint: "enter", "aria-label": name });
  const mirror = el("div", { class: "d-mirror", "aria-hidden": "true" });
  const a = { ym, kind, id, area, mirror, min, node: el("div", { class: "d-paper" }, mirror, area) };
  nb.areas.push(a);
  wireArea(a);
  return a;
}
const monthOf = (a) => nb.months.get(a.ym);
const textOf = (a) => { const m = monthOf(a); return a.kind === "totals" ? m.totals : a.kind === "untagged" ? m.untagged : m.sections[a.id] || ""; };
function setText(a, text, m = monthOf(a)) {
  if (a.kind === "totals") { m.links = spliceLinks(m.links, m.totals, text); m.totals = text; }
  else if (a.kind === "untagged") m.untagged = text;
  else m.sections[a.id] = text;
}
const areaFor = (ym, kind, id) => nb.areas.find((a) => a.ym === ym && a.kind === kind && (id == null || a.id === id));

// The paper is exactly as tall as its lines (at least one, to put the cursor on), so every empty
// line on the page is one you made: Enter adds one, Backspace takes it away.
function fit(a) {
  if (!a.area.isConnected) return;
  const y = window.scrollY;
  a.area.style.height = "0";
  a.area.style.height = `${Math.max(a.min * LINE, a.area.scrollHeight)}px`;
  if (window.scrollY !== y) window.scrollTo(0, y);
  drawMirror(a);
}

// The copy under the text box: the same characters (so the caret lines up), with figures inked
// and the figures of linked Totals lines drawn into their empty figure column.
const FIGURE = /^(\s*)(\+?)(\d[\d.]*)(?=\s|$)/u;
function drawMirror(a) {
  const c = nb.comps.get(a.ym);
  const rows = a.area.value.split("\n").map((line, i) => {
    if (!line.trim()) return el("div", { class: "d-ml", text: "​" });
    if (isMarker(line)) return el("div", { class: "d-ml d-rule", text: line });
    const row = el("div", { class: "d-ml" });
    const v = a.kind === "totals" && c && c.vals[i];
    if (v && v.auto && line.startsWith(BLANK)) {
      // money in (a carried-over balance, a refund-heavy tag) gets the same green "+" as a typed one
      const fig = v.auto === "tag" ? spentFig(v.v) : v.v > 0 ? figCol(`+${amount(v.v)}`) : balanceFig(v.v);
      row.append(...(fig.startsWith("+") ? [el("span", { class: "d-plus", text: "+" })] : []),
        el("span", { class: "d-auto", text: fig.replace(/^\+/, "") }), line.slice(COL));
      return row;
    }
    if (line.startsWith(BLANK)) {   // a Totals line still waiting for its figure
      row.append(BLANK, line.slice(COL));
      return row;
    }
    const f = line.match(FIGURE);
    if (f) {
      row.append(f[1], ...(f[2] ? [el("span", { class: "d-plus", text: "+" })] : []), el("span", { class: "d-num", text: f[3] }), line.slice(f[0].length));
    } else row.append(line);
    return row;
  });
  a.mirror.replaceChildren(...rows);
}
window.addEventListener("resize", () => nb.areas.forEach(fit));

// Worked-out figures: section totals, the month's spending, the result and the month's total.
function showTotals() {
  recompute();
  for (const [ym, card] of nb.cards) {
    const c = nb.comps.get(ym);
    for (const [id, fig] of card.tagFigs) fig.set(spentFig(c.tagTotals[id] || 0));
    card.expFig.set(spentFig(c.expenses));
    card.resFig.set(c.result === null ? "" : balanceFig(c.result));
    card.total.textContent = c.result !== null ? money(c.result) : money(-c.expenses);
    drawMirror(card.totals);
  }
}

// ---------- writing ----------
const caretLine = (area) => area.value.slice(0, area.selectionStart).split("\n").length - 1;
// A figure typed into a line's figure column (or at the start of the label of a line whose column is
// empty) is lined up as you type, so the label doesn't jump about until the line is finished.
const PADS = /[\u2007\u2008]/;
function liveFigure(area) {
  const v = area.value, pos = area.selectionStart;
  if (pos !== area.selectionEnd) return;
  const start = v.lastIndexOf("\n", pos - 1) + 1;
  let end = v.indexOf("\n", pos);
  if (end < 0) end = v.length;
  const line = v.slice(start, end);
  if (!PADS.test(line.slice(0, COL + 3))) return;          // only lines already laid out in columns
  const m = line.match(/^[\u2007\u2008]*([+\-]?\d[\d.,]*)?[\u2007\u2008]*( ?)(.*)$/u);
  if (!m) return;
  let fig = m[1] || "", rest = m[3];
  if (!fig) {                                                 // "55 " typed at the start of the label
    const lead = rest.match(/^([+\-]?\d[\d.,]*) (.*)$/u);
    if (lead) { fig = lead[1]; rest = lead[2]; }
  }
  const next = (fig ? figCol(fig) : BLANK) + " " + rest;
  if (next === line) return;
  const tail = line.length - (pos - start);                  // caret's distance from the line's end
  const at = tail <= rest.length ? next.length - tail : fig.length;
  area.value = v.slice(0, start) + next + v.slice(end);
  area.setSelectionRange(start + at, start + at);
}
function wireArea(a) {
  const area = a.area;
  const live = () => nb.areas.includes(a);   // false once the months have been redrawn
  area.addEventListener("input", (e) => {
    if (!live()) return;
    if (!e.isComposing && e.inputType !== "insertLineBreak" && e.inputType !== "insertParagraph") liveFigure(area);
    setText(a, area.value);
    if (e.inputType === "insertLineBreak" || e.inputType === "insertParagraph") {
      const done = caretLine(area) - 1;
      const had = parseLine(area.value.split("\n")[done] || "");
      finishLines(a, done);
      if (had && had.paise != null) nb.announce = true;
    }
    fit(a);
    showTotals();
    schedule(a.ym);
    if (nb.announce) flushSave();   // a finished entry is saved (and says so) straight away
  });
  area.addEventListener("blur", () => {
    if (!live()) return;
    finishLines(a);
    flushSave({ announce: true });
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

// Tidies finished lines ("bus 4" -> "    4.00 bus") and acts on "#tag" marks: in the expense area
// the line moves to that tag's section; in Totals the line is linked to that tag's total.
// only: the index of the one line to finish (after Enter), or undefined for all of them.
function finishLines(a, only) {
  const area = a.area, m = monthOf(a), totals = a.kind === "totals";
  const lines = area.value.split("\n");
  const caret = area.selectionStart;
  const cLine = area.value.slice(0, caret).split("\n").length - 1;
  const cCol = caret - area.value.lastIndexOf("\n", caret - 1) - 1;
  const moves = [];
  const links = totals ? spliceLinks(m.links, m.totals, area.value) : null;
  const out = [];
  let caretShift = 0;
  lines.forEach((line, i) => {
    if (only != null && i !== only) { out.push(line); return; }
    const mark = takeTagMark(line, TAGS);
    if (mark.tag && !totals && !(a.kind === "tag" && a.id === mark.tag.id)) {
      if (mark.text) moves.push({ tag: mark.tag, text: normalizeLine(mark.text) });
      if (i < cLine) caretShift++;
      return;                                   // the line leaves this paper
    }
    if (mark.tag && totals) links[i] = `tag:${mark.tag.id}`;
    out.push(normalizeLine(mark.tag ? mark.text : line, totals));
  });
  const text = out.join("\n");
  if (text === area.value && !moves.length) return;
  if (links) { m.links = links; m.totals = text; }   // the line count is unchanged in Totals
  else setText(a, text);
  area.value = text;
  if (document.activeElement === area) {
    const li = Math.max(0, cLine - caretShift);
    const before = out.slice(0, li).reduce((n, l) => n + l.length + 1, 0);
    const col = only != null && only === cLine ? (out[li] || "").length : Math.min(cCol, (out[li] || "").length);
    area.setSelectionRange(before + col, before + col);
  }
  fit(a);
  for (const mv of moves) {
    appendText(a.ym, areaFor(a.ym, "tag", mv.tag.id), mv.tag.id, [mv.text]);
    toast(`Moved to ${mv.tag.name}`);
  }
  showTotals();
  schedule(a.ym);
}

function appendText(ym, a, tagId, lines) {
  const m = nb.months.get(ym);
  const cur = String(m.sections[tagId] || "").replace(/\n+$/, "");
  const text = [cur, ...lines].filter((x, i) => i > 0 || x).join("\n");
  m.sections[tagId] = text;
  if (a) { a.area.value = text; fit(a); }
}

// ---------- paste ----------
// Pasted lines go where they belong: a month banner ("Oct 2026") sends what follows to that month,
// lines before any "EXPENSES: X" header go to Totals (in a month block) or stay where you pasted,
// and lines under a header go to that tag's section (the tag is made if it is new). Rules, "total"
// lines and old subtotals are dropped, like Import.
async function pasteNotes(a, text) {
  const blocks = parseNotes(text, TAGS);
  const touched = new Set([a.ym]);
  const created = [];
  for (const b of blocks) {
    const ym = b.ym || a.ym;
    const m = monthFor(ym);
    // A pasted month block replaces a made-up month's starter lines instead of being added under them.
    if (b.ym && m.unsaved && !nb.dirty.has(ym)) Object.assign(m, blankMonth(ym), { unsaved: true });
    touched.add(ym);
    if (b.ym || a.kind === "totals") {
      const t = cleanTotals(b.head);
      if (t.lines.length) {
        if (!b.ym) insertAtCaret(a, t.lines);
        else { const old = m.totals; m.totals = appendLinesTo(old, t.lines); m.links = spliceLinks(m.links, old, m.totals); }
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
  await flushSave();
  redraw();
  const others = [...touched].filter((ym) => ym !== a.ym).map(monthTitle);
  toast([others.length ? `Added to ${others.join(", ")}` : "Pasted and saved", created.length ? `new tag${created.length > 1 ? "s" : ""}: ${created.join(", ")}` : ""].filter(Boolean).join(" · "));
}
const appendLinesTo = (text, lines) => [String(text || "").replace(/\n+$/, ""), ...lines].filter((x, i) => i > 0 || x).join("\n");
function insertAtCaret(a, lines) {
  const area = a.area, v = area.value;
  const s = area.selectionStart, e = area.selectionEnd;
  const head = v.slice(0, s), tail = v.slice(e);
  const ins = (head && !head.endsWith("\n") ? "\n" : "") + lines.join("\n") + (tail && !tail.startsWith("\n") ? "\n" : "");
  setText(a, head + ins + tail);
}

// ---------- which Totals lines fill themselves in (shown in the settings popover) ----------
// The month you are looking at: the one whose name is pinned at the top.
function monthInView() {
  for (const node of document.querySelectorAll(".d-monthgroup")) if (node.getBoundingClientRect().bottom > 80) return node.dataset.ym;
  return nb.yms[0];
}
function linkChoices(ym) {
  const m = nb.months.get(ym), c = nb.comps.get(ym);
  const rows = [];
  String(m.totals).split("\n").forEach((line, i) => {
    const p = parseLine(line), v = c && c.vals[i];
    if (!p || !v || (v.v !== null && !v.auto)) return;   // lines with a written figure don't fill in
    // Tapping the choice opens the options as small chips right under the row (no menu floating
    // over the popover). "—" means you write the figure yourself.
    const choices = [["none", "—", null], ["prev", "Last month", null], ...TAGS.map((t) => [`tag:${t.id}`, t.name, t.color])];
    let value = v.link || "none";
    const btn = el("button", { type: "button", class: "pop-pick", "aria-expanded": "false", "aria-label": `${p.label || "Line"} fills in` });
    const menu = el("div", { class: "pop-menu", role: "listbox", "aria-label": `${p.label || "Line"} fills in` });
    menu.hidden = true;
    const choose = (val) => {
      closePickers();
      if (val === value) return;
      value = val;
      paint();
      while (m.links.length <= i) m.links.push(null);
      m.links[i] = val;
      schedule(ym);
      showTotals();
      flushSave({ announce: true });
    };
    function paint() {
      btn.textContent = (choices.find((x) => x[0] === value) || choices[0])[1];
      btn.classList.toggle("off", value === "none");   // written by hand: quieter
      menu.replaceChildren(...choices.map(([val, text, color]) => {
        const o = el("button", { type: "button", class: "pop-opt" + (val === value ? " on" : ""), role: "option", "aria-selected": String(val === value) });
        if (color) { const dot = el("span", { class: "tg-dot" }); dot.style.background = color; o.append(dot); }
        o.append(text);
        o.addEventListener("click", (e) => { e.stopPropagation(); choose(val); });
        return o;
      }));
    }
    paint();
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      closePickers();
      menu.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
    });
    rows.push(el("div", { class: "pop-item" },
      el("div", { class: "pop-row" }, el("span", { class: "pop-label", text: p.label || "(no label)" }), btn), menu));
  });
  return rows;
}

function closePickers() {
  for (const menu of document.querySelectorAll(".pop-menu")) menu.hidden = true;
  for (const b of document.querySelectorAll(".pop-pick")) b.setAttribute("aria-expanded", "false");
}

// ---------- saving ----------
function schedule(ym) {
  nb.dirty.add(ym);
  nb.changed = true;   // something new to say "Saved" about
  const m = nb.months.get(ym);
  if (m) m.unsaved = false;
  clearTimeout(nb.timer);
  nb.timer = setTimeout(flushSave, 800);
}
// announce: say "Saved" once a finished line is stored (after Enter on a line with a figure, or
// on leaving the paper), not for every pause while typing.
function flushSave(opts = {}) {
  clearTimeout(nb.timer);
  const list = [...nb.dirty].map((ym) => nb.months.get(ym)).filter(Boolean);
  nb.dirty.clear();
  const say = (nb.announce || opts.announce) && nb.changed;
  if (say) { nb.announce = false; nb.changed = false; }
  if (!list.length) {
    if (say) nb.saving.then(() => toast("Saved"));
    return nb.saving;
  }
  // Links worked out by matching are kept, so they survive the label being reworded later.
  const comps = computeAll([...nb.months.values()], TAGS);
  for (const m of list) {
    const c = comps.get(m.ym);
    m.links = c.vals.map((v, i) => (m.links[i] || (v && v.link && v.v !== null && v.auto ? v.link : null)));
  }
  nb.saving = nb.saving.then(() => store.put(...list)).then((saved) => {
    for (const s of saved) { const m = nb.months.get(s.ym); if (m) m.updatedAt = s.updatedAt; }
    if (say) toast("Saved");
  }).catch((err) => toast(err.message));
  return nb.saving;
}
// Leaving the app saves what is still waiting, then backs up to Drive.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) return;
  for (const a of nb.areas) if (document.activeElement === a.area) finishLines(a);
  flushSave().then(() => drive.backup({ quiet: true }));
});
