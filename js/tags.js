"use strict";

// Tags, in the settings popover: add, recolour, rename, reorder and delete tags. Each tag is a section of the
// expense area on every month, in this order. Renaming keeps every month joined up (they point at
// the tag's id) and also rewrites Totals labels that use the old name ("Regular expenses").

const SWATCHES = TAG_PALETTE;
let openTag = null;   // id of the tag whose editor is open, or "new" for the new-tag form

function swatches(selected) {
  let value = selected;
  const node = el("div", { class: "swatches", role: "radiogroup", "aria-label": "Colour" });
  const list = SWATCHES.includes(selected) ? SWATCHES : [selected, ...SWATCHES];
  const buttons = list.map((c) => {
    const b = el("button", { type: "button", class: "sw", role: "radio", "aria-label": `Colour ${c}` });
    b.style.background = c;
    b.addEventListener("click", () => { value = c; paint(); });
    return [c, b];
  });
  function paint() {
    for (const [c, b] of buttons) { b.classList.toggle("on", c === value); b.setAttribute("aria-checked", String(c === value)); }
  }
  node.append(...buttons.map(([, b]) => b));
  paint();
  return { node, get value() { return value; } };
}

// For each tag: how many lines with a figure, and their total, over every month.
async function tagUsage() {
  const use = new Map();
  for (const m of await store.all()) {
    for (const [id, text] of Object.entries(m.sections)) {
      const u = use.get(id) || { count: 0, months: 0, total: 0 };
      let any = false;
      for (const line of text.split("\n")) { const v = lineValue(parseLine(line)); if (v !== null) { u.count++; u.total += v; any = true; } }
      if (any || text.trim()) u.months++;
      use.set(id, u);
    }
  }
  return use;
}

// The tags as small chips; tapping one (or "+ New") opens its editor under them.
async function renderTags() {
  const use = await tagUsage();
  const chips = el("div", { class: "tg-chips" });
  TAGS.forEach((t) => chips.append(tagChip(t)));
  const add = el("button", { type: "button", class: "tg-chip tg-add" + (openTag === "new" ? " on" : ""), text: "+ New", "aria-expanded": String(openTag === "new") });
  add.addEventListener("click", () => { openTag = openTag === "new" ? null : "new"; renderTags(); });
  chips.append(add);
  const open = TAGS.findIndex((t) => t.id === openTag);
  const below = openTag === "new" ? newTagForm() : open >= 0 ? tagEditor(TAGS[open], open, use.get(openTag)) : null;
  $("pop-tags").replaceChildren(...[chips, below].filter(Boolean));
  if (openTag === "new") below.querySelector("input").focus();
}
function tagChip(t) {
  const dot = el("span", { class: "tg-dot" });
  dot.style.background = t.color;
  const on = openTag === t.id;
  const b = el("button", { type: "button", class: "tg-chip" + (on ? " on" : ""), "aria-expanded": String(on) }, dot, t.name);
  b.addEventListener("click", () => { openTag = on ? null : t.id; renderTags(); });
  return b;
}
// After a change: the popover and the notebook's sections are drawn again, and a toast says so.
async function tagsChanged(msg) {
  await renderTags();
  await renderNotebook();
  if (msg) toast(msg);
}

function newTagForm() {
  const input = el("input", { class: "tg-input", placeholder: "New tag name", maxlength: "30", autocomplete: "off", enterkeyhint: "done", "aria-label": "New tag name" });
  const sw = swatches(nextTagColor());
  const btn = el("button", { type: "button", class: "tg-btn", text: "Add tag" });
  const add = async () => {
    if (!cleanTagName(input.value)) { toast("Give the tag a name (up to 30 characters)"); return; }
    if (tagNamed(input.value, TAGS)) { toast("That tag already exists"); return; }
    const tag = addTag(input.value, sw.value);
    openTag = null;
    await tagsChanged(`Tag “${tag.name}” added`);
  };
  btn.addEventListener("click", add);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  return el("div", { class: "tg-editor" }, el("div", { class: "tg-newrow" }, input, btn), sw.node);
}

// The word run of `oldName` in a label, case and punctuation aside: "Regular expenses" -> "Daily expenses".
function renameInLabel(line, oldName, newName) {
  const ws = words(oldName).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!ws.length) return line;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${ws.join("[^\\p{L}\\p{N}]+")}(?![\\p{L}\\p{N}])`, "iu");
  return line.replace(re, newName);
}

async function renameTag(t, name) {
  const old = t.name;
  t.name = name;
  saveTags();
  const changed = [];
  for (const m of await store.all()) {
    const c = computeMonth(m, TAGS.map((x) => (x === t ? { ...x, name: old } : x)), null);
    let hit = false;
    const lines = m.totals.split("\n").map((line, i) => {
      const v = c.vals[i];
      if (!v || v.link !== `tag:${t.id}`) return line;
      const next = renameInLabel(line, old, name);
      if (next !== line) hit = true;
      if (!m.links[i]) { m.links[i] = v.link; hit = true; }   // keep the link now the words differ
      return next;
    });
    if (hit) { m.totals = lines.join("\n"); changed.push(m); }
    else if (m.sections[t.id]) changed.push(m);                // its Drive copy shows the new heading
  }
  if (changed.length) await store.put(...changed);
}

// Deleting a tag: its lines join the lines without a tag in each month (nothing is lost).
async function deleteTag(t) {
  const changed = [];
  for (const m of await store.all()) {
    let hit = false;
    if (m.sections[t.id] !== undefined) {
      if (m.sections[t.id].trim()) m.untagged = [m.untagged.replace(/\n+$/, ""), m.sections[t.id]].filter(Boolean).join("\n");
      delete m.sections[t.id];
      hit = true;
    }
    m.links = m.links.map((l) => { if (l === `tag:${t.id}`) { hit = true; return "none"; } return l; });
    if (hit) changed.push(m);
  }
  if (changed.length) await store.put(...changed);
  TAGS.splice(TAGS.indexOf(t), 1);
  saveTags();
}

function tagEditor(t, index, u) {
  const input = el("input", { class: "tg-input", maxlength: "30", autocomplete: "off", "aria-label": "Tag name" });
  input.value = t.name;
  const sw = swatches(t.color);
  const save = el("button", { type: "button", class: "tg-btn", text: "Save" });
  const del = el("button", { type: "button", class: "tg-btn danger", text: "Delete" });
  const up = el("button", { type: "button", class: "tg-btn ghost", text: "↑", "aria-label": "Move up" });
  const down = el("button", { type: "button", class: "tg-btn ghost", text: "↓", "aria-label": "Move down" });
  up.disabled = index === 0;
  down.disabled = index === TAGS.length - 1;
  const move = async (d) => { TAGS.splice(index + d, 0, TAGS.splice(index, 1)[0]); saveTags(); await tagsChanged(); };
  up.addEventListener("click", () => move(-1));
  down.addEventListener("click", () => move(1));

  save.addEventListener("click", async () => {
    const name = cleanTagName(input.value);
    if (!name) { toast("Give the tag a name (up to 30 characters)"); return; }
    const same = tagNamed(name, TAGS);
    if (same && same !== t) { toast("That tag already exists"); return; }
    try { if (name !== t.name) await renameTag(t, name); } catch (err) { toast(err.message); return; }
    t.color = sw.value;
    saveTags();
    openTag = null;
    await tagsChanged(`Tag “${t.name}” saved`);
  });

  del.addEventListener("click", async () => {
    const n = u ? u.months : 0;
    if (!confirm(n ? `Delete "${t.name}"? Its lines in ${n} month${n === 1 ? "" : "s"} move to the lines without a tag.` : `Delete "${t.name}"?`)) return;
    try { await deleteTag(t); } catch (err) { toast(err.message); return; }
    openTag = null;
    await tagsChanged(`Tag “${t.name}” deleted`);
  });

  return el("div", { class: "tg-editor" }, input, sw.node,
    el("div", { class: "tg-actions" }, up, down, del, save));
}
