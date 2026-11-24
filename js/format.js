"use strict";

// How a notebook line is read and written. Pure functions only (no screen, no storage), so the
// same code reads what you type, what you paste and what you import, and Node can test it.
//
// A line is "[sign] amount label". A "+" means money coming in; anything else (a "-" or no sign)
// is spent. The amount may be typed on either side ("bus 4", "4 bus", "+ 2000 salary"); a
// finished line is written back figure first in a column, "    4.00 bus", and only a "+" you
// typed is kept ("+2000.00 salary"). Lines without an amount are notes, blank lines are just
// blank lines, and "____" / "----" lines are rules. None of those count towards anything.
// In Totals, a line without a figure starts with an empty figure column, which is where a
// linked line shows its filled-in figure and where you write the figure on the others.

const FIG = " ";            // a space exactly as wide as a digit: keeps the figures lined up
const MINUS = "−";          // the maths minus, as wide as "+"
const MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

// Tag names match by their words only: case, spaces, brackets and punctuation don't matter.
const words = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
const sameWords = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const isBlank = (line) => !String(line).trim();
const isMarker = (line) => /^\s*[_=~\-‐-―─-╿]{3,}\s*$/.test(line);
const trimBlank = (lines) => {
  let a = 0, b = lines.length;
  while (a < b && isBlank(lines[a])) a++;
  while (b > a && isBlank(lines[b - 1])) b--;
  return lines.slice(a, b);
};

// ---------- one line ----------
const SIGNS = "+\\-\\u2212\\u2013";
const AMT = "(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?";
const LEAD_RE = new RegExp(`^([${SIGNS}])?\\s*(${AMT})(?=\\s|$)\\s*(.*)$`, "u");
const ANY_RE = new RegExp(`(?<![\\w.,])([${SIGNS}]\\s*)?(${AMT})(?!\\w|\\.\\d)`, "gu");

function toPaise(s) {
  const p = Math.round(parseFloat(s.replace(/,/g, "")) * 100);
  return p > 0 ? p : null;                  // "000.00" is a blank to fill in, not a figure
}

// -> null for a blank or rule line, else { sign: 1 | -1, explicit, paise (null: no figure), label }
function parseLine(raw) {
  const t = String(raw).replace(/ /g, " ").replace(/\p{Sc}/gu, " ").replace(/\s+/g, " ").trim();
  if (!t || isMarker(t)) return null;
  const m = t.match(LEAD_RE);                // figure first: "- 0.10 card check (will cover 2.50)"
  if (m) return { sign: m[1] === "+" ? 1 : -1, explicit: !!m[1], paise: toPaise(m[2]), label: m[3].trim() };
  const lead = /^[+\-−–]/.test(t) ? t[0] : "";
  const body = lead ? t.slice(1).trim() : t;
  const found = [...body.matchAll(ANY_RE)].filter((x) => toPaise(x[2]) !== null);
  if (!found.length) return { sign: lead === "+" ? 1 : -1, explicit: !!lead, paise: null, label: body };
  const pick = found[found.length - 1];      // figure last: "bus 4", "auto fare +1,250.50"
  const own = (pick[1] || "").trim();
  const label = (body.slice(0, pick.index) + " " + body.slice(pick.index + pick[0].length))
    .replace(/\s+/g, " ").replace(/^[\s\-:,@]+|[\s\-:,@]+$/g, "").trim();
  return { sign: (own || lead) === "+" ? 1 : -1, explicit: !!(own || lead), paise: toPaise(pick[2]), label };
}

const COL = 8;                         // the figure column, in digit widths ("+1234.00")
// An empty figure column, as wide as a written one: a figure always has one full stop, which is
// narrower than a digit, so the last place is a punctuation space (the width of a full stop).
const BLANK = FIG.repeat(COL - 1) + "\u2008";
const figCol = (s) => s.padStart(COL, FIG);
const amount = (paise) => (paise / 100).toFixed(2);
// blankCol: a line without a figure gets the empty figure column (Totals lines)
function formatLine(p, blankCol) {
  if (p.paise != null) return `${figCol((p.sign > 0 ? "+" : "") + amount(p.paise))} ${p.label}`.trimEnd();
  return blankCol && p.label ? `${BLANK} ${p.label}` : p.label;
}
function normalizeLine(raw, blankCol) {
  if (isBlank(raw)) return "";
  if (isMarker(raw)) return String(raw).trim();
  return formatLine(parseLine(raw), blankCol);
}
// How worked-out figures are shown: spending as a plain amount (a refund-heavy section gets "+"),
// a balance as a plain amount (below zero gets "−").
const spentFig = (v) => figCol(v > 0 ? `+${amount(v)}` : amount(-v));
const balanceFig = (v) => figCol(v < 0 ? `${MINUS}${amount(-v)}` : amount(v));
const lineValue = (p) => (p && p.paise != null ? p.sign * p.paise : null);
function areaTotal(text) {
  let sum = 0;
  for (const line of String(text || "").split("\n")) { const v = lineValue(parseLine(line)); if (v !== null) sum += v; }
  return sum;
}
// For text export and Drive: every figure with its sign, like the notes it came from: "- 505.65 label"
const signedLine = (paise, label) => `${paise < 0 ? "-" : "+"} ${amount(Math.abs(paise))} ${label}`.trimEnd();
function plainLine(line) {
  if (isBlank(line)) return "";
  if (isMarker(line)) return String(line).trim();
  const p = parseLine(line);
  return p.paise != null ? signedLine(p.sign * p.paise, p.label) : p.label;
}

// ---------- tags ----------
// The tag whose words appear, in order, in a label ("Regular expenses" -> Regular). Longest wins.
function tagInLabel(label, tags) {
  const w = words(label);
  let best = null, bestLen = 0;
  for (const t of tags) {
    const tw = words(t.name);
    if (!tw.length || tw.length <= bestLen) continue;
    for (let i = 0; i + tw.length <= w.length; i++) {
      if (sameWords(tw, w.slice(i, i + tw.length))) { best = t; bestLen = tw.length; break; }
    }
  }
  return best;
}
const tagNamed = (name, tags) => tags.find((t) => sameWords(words(t.name), words(name))) || null;

// "#food" in a line -> { tag, text without it }; tag is null when there is no such tag.
function takeTagMark(text, tags) {
  let tag = null;
  const rest = String(text).replace(/(^|\s)#([\p{L}\p{N}_&/+-]+)/gu, (all, sp, word) => {
    const t = tag ? null : tagNamed(word, tags);
    if (!t) return all;
    tag = t;
    return sp;
  });
  return { tag, text: rest.replace(/\s+/g, " ").trim() };
}

// ---------- a month: Totals, then the expense area ----------
// month = { ym, totals: text, links: [per Totals line], resultLabel, untagged: text, sections: { tagId: text } }
// The only things worked out: each tag's total, the expense area's total, the figures of linked
// Totals lines, and the Totals result. A Totals line without a figure can be linked: links[i] is
// "tag:<id>" (shows that tag's total), "prev" (last month's result) or "none". With no stored link,
// a label naming a tag links to it, and the first line links to last month's result.
function detectLink(label, tags, isFirst) {
  const tag = tagInLabel(label, tags);
  return tag ? `tag:${tag.id}` : isFirst ? "prev" : null;
}
function computeMonth(m, tags, prevResult) {
  const tagTotals = {};
  const untagged = areaTotal(m.untagged);
  let expenses = untagged;
  for (const [id, text] of Object.entries(m.sections || {})) { tagTotals[id] = areaTotal(text); expenses += tagTotals[id]; }
  const links = m.links || [];
  let first = true, sum = 0, any = false;
  const vals = String(m.totals || "").split("\n").map((line, i) => {
    const p = parseLine(line);
    if (!p) return null;
    const isFirst = first;
    first = false;
    let v = lineValue(p), auto = null, link = links[i] || null;
    if (v === null) {
      if (!link) link = detectLink(p.label, tags, isFirst);
      if (link && link.startsWith("tag:") && tags.some((t) => t.id === link.slice(4))) { v = tagTotals[link.slice(4)] || 0; auto = "tag"; }
      else if (link === "prev" && prevResult != null) { v = prevResult; auto = "carry"; }
    }
    if (v !== null) { any = true; sum += v; }
    return { v, auto, link };
  });
  const result = any ? sum : null;
  return { tagTotals, untagged, expenses, vals, result, total: result !== null ? result : expenses };
}

// Keeps links[] in step when the Totals text changes: lines above and below the edit keep theirs.
function spliceLinks(links, oldText, newText) {
  const a = String(oldText).split("\n"), b = String(newText).split("\n");
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const out = (links || []).slice(0, a.length);
  while (out.length < a.length) out.push(null);
  const midOld = a.length - pre - suf, midNew = b.length - pre - suf;
  // A line edited in place keeps its link; new lines start unlinked.
  const keep = out.slice(pre, pre + Math.min(midOld, midNew));
  while (keep.length < midNew) keep.push(null);
  return [...out.slice(0, pre), ...keep, ...out.slice(pre + midOld)];
}

// Oldest first, each month's first line carrying the month before's result.
function computeAll(months, tags) {
  const out = new Map();
  let prev = null;
  for (const m of [...months].sort((a, b) => (a.ym < b.ym ? -1 : 1))) {
    const c = computeMonth(m, tags, prev);
    out.set(m.ym, c);
    prev = c.result;
  }
  return out;
}

// ---------- month names ----------
function monthIndex(word) {
  const w = String(word).toLowerCase();
  return w.length < 3 ? -1 : MONTHS_FULL.findIndex((n) => n.toLowerCase().startsWith(w));
}
const monthTitle = (ym) => `${MONTHS_SHORT[+ym.slice(5) - 1]} ${ym.slice(0, 4)}`;     // "Sept 2026"
const monthDiff = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5) - +a.slice(5));
const MONTH_WORD = new RegExp(`\\b(${[...MONTHS_FULL, "Sept", "Sep", "Jan", "Feb", "Mar", "Apr", "Jun", "Jul", "Aug", "Oct", "Nov", "Dec"].join("|")})\\b`, "g");
// "Salary Oct" -> "Salary Nov", "Rent Adv November" -> "Rent Adv December"
const bumpMonths = (text) => String(text).replace(MONTH_WORD, (w) => {
  const full = MONTHS_FULL.indexOf(w);
  return full >= 0 ? MONTHS_FULL[(full + 1) % 12] : MONTHS_SHORT[(monthIndex(w) + 1) % 12];
});

// The first month ever: laid out like the user's notebook, figures left blank.
function starterMonth(ym, tags) {
  const i = +ym.slice(5) - 1, cur = MONTHS_SHORT[i], next = MONTHS_SHORT[(i + 1) % 12];
  const lines = [`Available to spend in ${cur}`, ...tags.map((t) => `${t.name} expenses`),
    `Salary ${cur}`, "Standard savings", `Rent Adv ${next}`].map((label) => formatLine({ label, paise: null }, true));
  return { ym, totals: lines.join("\n"), links: [], resultLabel: `Available to spend in ${next}`, untagged: "", sections: {} };
}

// A new month starts with last month's Totals lines: labels kept (month names moved on), figures
// blank. Linked lines fill themselves in; salary, savings and the like are never guessed.
function nextMonthFrom(prev, ym) {
  const strip = (line) => {
    if (isBlank(line) || isMarker(line)) return line;
    const p = parseLine(line);
    return formatLine({ ...p, paise: null }, true);
  };
  let totals = String(prev.totals || "").split("\n").map(strip).join("\n");
  let label = prev.resultLabel || "";
  for (let k = 0; k < monthDiff(prev.ym, ym); k++) { totals = bumpMonths(totals); label = bumpMonths(label); }
  return { ym, totals, links: (prev.links || []).slice(), resultLabel: label, untagged: "", sections: {} };
}

// ---------- reading old notes (import and paste) ----------
function monthBanner(line) {
  const m = String(line).trim().match(/^([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
  if (!m) return null;
  const i = monthIndex(m[1]), y = +m[2];
  return i < 0 || y < 2000 || y > 2100 ? null : `${y}-${String(i + 1).padStart(2, "0")}`;
}

// "EXPENSES: Regular" -> "Regular", "EXPENSES" -> "" (no tag), or a known tag's name on its own
// line next to a rule. Anything else -> null.
function sectionHeader(lines, i, tags) {
  const t = String(lines[i]).trim();
  const m = t.match(/^expenses?\b\s*[:\-–—]?\s*([^\d]*)$/i);
  if (m) return m[1].trim();
  const p = parseLine(t);
  if (!p || p.paise != null || p.explicit) return null;
  const tag = tagNamed(p.label, tags);
  if (!tag) return null;
  const nextTo = (d) => {
    for (let j = i + d; j >= 0 && j < lines.length; j += d) if (!isBlank(lines[j])) return isMarker(lines[j]);
    return false;
  };
  return nextTo(-1) || nextTo(1) ? tag.name : null;
}

// Text -> [{ ym (null when the text names no month), head: lines before any section, sections: [{ name, lines }] }]
function parseNotes(text, tags) {
  const lines = String(text).replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let cur = null, sec = null;
  const start = (ym) => { cur = { ym, head: [], sections: [] }; blocks.push(cur); sec = null; };
  for (let i = 0; i < lines.length; i++) {
    const ym = monthBanner(lines[i]);
    if (ym) { start(ym); continue; }
    if (!cur) start(null);
    const name = sectionHeader(lines, i, tags);
    if (name !== null) { sec = { name, lines: [] }; cur.sections.push(sec); continue; }
    (sec ? sec.lines : cur.head).push(lines[i]);
  }
  return blocks.filter((b) => b.ym || b.sections.length || b.head.some((l) => !isBlank(l) && !isMarker(l)));
}

// Old Totals block: the line after the last rule is the result (its label is kept, its figure is
// worked out again); a line after an earlier rule is a hand-written subtotal and goes; rules go.
function cleanTotals(lines) {
  // The "====" under a month banner and the "———" above the first section are framing, not rules.
  let a = 0, b = lines.length;
  while (a < b && (isBlank(lines[a]) || isMarker(lines[a]))) a++;
  while (b > a && (isBlank(lines[b - 1]) || isMarker(lines[b - 1]))) b--;
  lines = lines.slice(a, b);
  const marks = [];
  lines.forEach((l, i) => { if (isMarker(l)) marks.push(i); });
  const drop = new Set(marks);
  let resultLabel = null;
  marks.forEach((mi, k) => {
    const end = k + 1 < marks.length ? marks[k + 1] : lines.length;
    for (let j = mi + 1; j < end; j++) {
      if (isBlank(lines[j])) continue;
      drop.add(j);
      if (k === marks.length - 1) resultLabel = parseLine(lines[j]).label;
      break;
    }
  });
  return { lines: trimBlank(lines.filter((_, i) => !drop.has(i)).map((l) => normalizeLine(l, true))), resultLabel };
}

// Old expense lines: rules and hand-written "total" lines go (the app adds up again).
const TOTAL_WORDS = [["total"], ["subtotal"], ["sub", "total"], ["expenses", "total"], ["grand", "total"]];
function cleanExpense(lines) {
  return trimBlank(lines.filter((l) => {
    if (isMarker(l)) return false;
    const p = parseLine(l);
    return !(p && TOTAL_WORDS.some((w) => sameWords(w, words(p.label))));
  }).map((l) => normalizeLine(l)));
}

// A parsed block -> a draft month: { ym, totals, resultLabel, untagged, sections: [{ name, text }] }
function blockToDraft(b) {
  const t = cleanTotals(b.head);
  const d = { ym: b.ym, totals: t.lines.join("\n"), resultLabel: t.resultLabel, untagged: "", sections: [] };
  for (const s of b.sections) {
    const text = cleanExpense(s.lines).join("\n");
    if (s.name) d.sections.push({ name: s.name, text });
    else d.untagged = [d.untagged, text].filter(Boolean).join("\n");
  }
  return d;
}

// After an import, Totals figures that are just copies of a tag's total or of last month's result
// become linked again (figure removed), so they keep following the expenses.
function relinkTotals(m, tags, prevResult) {
  const c = computeMonth({ ...m, totals: "" }, tags, null);
  let first = true;
  m.totals = String(m.totals || "").split("\n").map((line) => {
    const p = parseLine(line);
    if (!p) return line;
    const isFirst = first;
    first = false;
    if (p.paise == null) return line;
    const v = p.sign * p.paise, tag = tagInLabel(p.label, tags);
    const copy = tag ? v === (c.tagTotals[tag.id] || 0) : isFirst && prevResult != null && v === prevResult;
    return copy ? formatLine({ ...p, paise: null }, true) : line;
  }).join("\n");
  return m;
}

// ---------- writing out (text export, Drive) ----------
const ascii = (s) => s.replace(/ /g, " ").replace(/−/g, "-");
const BANNER = "=".repeat(44), DASHES = "—".repeat(15), RULE = "__________";

function monthToText(m, tags, c) {
  const out = [BANNER, monthTitle(m.ym), BANNER, ""];
  String(m.totals || "").split("\n").forEach((line, i) => {
    const v = c.vals[i];
    out.push(v && v.auto ? signedLine(v.v, parseLine(line).label) : plainLine(line));
  });
  if (c.result !== null || m.resultLabel) out.push(RULE, signedLine(c.result || 0, m.resultLabel || ""));
  const section = (title, text, total) => {
    out.push("", DASHES, title, DASHES, "");
    if (!isBlank(text)) out.push(...String(text).split("\n").map(plainLine));
    out.push(RULE, signedLine(total, "total"));
  };
  if (!isBlank(m.untagged || "")) section("EXPENSES", m.untagged, c.untagged);
  for (const t of tags) if (m.sections && t.id in m.sections) section(`EXPENSES: ${t.name}`, m.sections[t.id], c.tagTotals[t.id] || 0);
  out.push("", RULE, signedLine(c.expenses, "expenses total"));
  return ascii(out.join("\n")) + "\n";
}

// ---------- CSV ----------
const csvSafe = (s) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);          // neutralise spreadsheet formulas
const csvUnsafe = (s) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);
const csvCell = (s) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const CSV_HEAD = ["month", "section", "sign", "amount", "label"];

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function monthsToCsv(months, tags, comps) {
  const rows = [CSV_HEAD];
  const add = (ym, section, line, auto) => {
    if (isBlank(line)) { rows.push([ym, section, "", "", ""]); return; }
    if (isMarker(line)) { rows.push([ym, section, "", "", line.trim()]); return; }
    const p = parseLine(line);
    const sign = auto ? auto.v : lineValue(p);
    const shown = sign !== null ? (sign < 0 ? "-" : "+") : p.explicit ? (p.sign > 0 ? "+" : "-") : "";
    rows.push([ym, section, shown, sign !== null ? (Math.abs(sign) / 100).toFixed(2) : "", p.label]);
  };
  for (const m of [...months].sort((a, b) => (a.ym < b.ym ? -1 : 1))) {
    const c = comps.get(m.ym);
    String(m.totals || "").split("\n").forEach((l, i) => add(m.ym, "totals", l, c.vals[i] && c.vals[i].auto ? c.vals[i] : null));
    if (c.result !== null || m.resultLabel) add(m.ym, "result", signedLine(c.result || 0, m.resultLabel || ""));
    if (!isBlank(m.untagged || "")) for (const l of m.untagged.split("\n")) add(m.ym, "expenses", l);
    for (const t of tags) if (m.sections && t.id in m.sections) for (const l of m.sections[t.id].split("\n")) add(m.ym, `expenses: ${t.name}`, l);
  }
  return rows.map((r) => r.map((v) => csvCell(csvSafe(String(v)))).join(",")).join("\r\n") + "\r\n";
}

// CSV made by monthsToCsv -> draft months (same shape as blockToDraft)
function csvToDrafts(text) {
  const rows = parseCsv(String(text).replace(/^﻿/, ""));
  if (!rows.length || rows[0].map((c) => c.trim().toLowerCase()).join(",") !== CSV_HEAD.join(",")) {
    throw new Error("This CSV is not an export from this app");
  }
  const byMonth = new Map();
  for (const r of rows.slice(1)) {
    const [ym, section, sign, amt, label] = r.map((c) => csvUnsafe(c || ""));
    if (!/^\d{4}-\d{2}$/.test(ym.trim())) continue;
    if (!byMonth.has(ym)) byMonth.set(ym, { ym, totals: [], resultLabel: null, untagged: [], sections: new Map() });
    const d = byMonth.get(ym);
    const line = normalizeLine([sign, amt, label].filter(Boolean).join(" "), section.trim().toLowerCase() === "totals");
    const sec = section.trim().toLowerCase();
    if (sec === "totals") d.totals.push(line);
    else if (sec === "result") d.resultLabel = parseLine(line) ? parseLine(line).label : "";
    else if (sec === "expenses") d.untagged.push(line);
    else {
      const name = section.replace(/^\s*expenses?\s*:\s*/i, "").trim();
      if (!d.sections.has(name)) d.sections.set(name, []);
      d.sections.get(name).push(line);
    }
  }
  return [...byMonth.values()].map((d) => ({
    ym: d.ym, totals: d.totals.join("\n"), resultLabel: d.resultLabel, untagged: d.untagged.join("\n"),
    sections: [...d.sections].map(([name, lines]) => ({ name, text: lines.join("\n") })),
  }));
}

if (typeof module !== "undefined") {
  module.exports = { parseLine, formatLine, normalizeLine, plainLine, spentFig, balanceFig, BLANK, COL, areaTotal, words, tagInLabel, tagNamed, takeTagMark,
    computeMonth, computeAll, spliceLinks, detectLink, signedLine, MONTHS_FULL, bumpMonths, starterMonth, nextMonthFrom, parseNotes, blockToDraft, cleanTotals,
    cleanExpense, relinkTotals, monthToText, monthsToCsv, csvToDrafts, monthTitle, isMarker, isBlank };
}
