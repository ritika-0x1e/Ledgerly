"use strict";

// Tags, in the settings popover: add, recolour, rename, reorder and delete tags. Each tag is a section of the
// expense area on every month, in this order. Renaming keeps every month joined up (they point at
// the tag's id) and also rewrites Totals labels that use the old name ("Regular expenses").

const SWATCHES = TAG_PALETTE;
let openTag = null;   // id of the tag whose editor is open

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

async function renderTags() {
  const use = await tagUsage();
  const card = el("div", { class: "tg-card" });
  if (!TAGS.length) card.append(el("div", { class: "empty", text: "No tags yet." }));
  TAGS.forEach((t, i) => card.append(tagRow(t, i, use.get(t.id))));
  $("pop-tags").replaceChildren(card, newTagForm());
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
    await tagsChanged(`Tag “${tag.name}” added`);
  };
  btn.addEventListener("click", add);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  return el("div", { class: "tg-card tg-new" }, el("div", { class: "tg-newrow" }, input, btn), sw.node);
}

function tagRow(t, index, u) {
  const open = openTag === t.id;
  const dot = el("span", { class: "tg-dot" });
  dot.style.background = t.color;
  const used = u && u.count ? `${u.count} line${u.count === 1 ? "" : "s"} · ${money(-u.total)}` : "Not used yet";
  const head = el("button", { type: "button", class: "tg-head", "aria-expanded": String(open) },
    dot, el("span", { class: "tg-text" }, el("span", { class: "tg-name", text: t.name }), el("span", { class: "tg-meta", text: used })),
    el("span", { class: "chev", text: "›" }));
  head.addEventListener("click", () => { openTag = open ? null : t.id; renderTags(); });
  const item = el("div", { class: "tg-item" + (open ? " open" : "") }, head);
  if (open) item.append(tagEditor(t, index, u));
  return item;
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
  const up = el("button", { type: "button", class: "tg-btn ghost", text: "Move up", "aria-label": "Move up" });
  const down = el("button", { type: "button", class: "tg-btn ghost", text: "Move down", "aria-label": "Move down" });
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
    el("div", { class: "tg-actions" }, up, down), el("div", { class: "tg-actions" }, del, save));
}
