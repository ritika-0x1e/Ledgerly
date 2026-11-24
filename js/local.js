"use strict";

// All data lives on this phone, in the browser's IndexedDB: one record per month.
//   { ym: "2026-10", totals: text, links: [..], resultLabel, untagged: text, sections: { tagId: text }, updatedAt }
// Google Drive gets a copy (drive.js); nothing else leaves the phone.

const DB_NAME = "expenses";
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, 2);
      open.onupgradeneeded = () => {
        const db = open.result;
        for (const old of ["expenses", "recurring", "runs"]) if (db.objectStoreNames.contains(old)) db.deleteObjectStore(old);
        if (!db.objectStoreNames.contains("months")) db.createObjectStore("months", { keyPath: "ym" });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error("Close the app's other tabs and open it again"));
    });
  }
  return dbPromise;
}

const wrap = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
// t.done settles when the transaction has fully committed (or failed).
async function transaction(stores, mode) {
  const t = (await openDb()).transaction(stores, mode || "readonly");
  t.done = new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("Could not save"));
  });
  t.done.catch(() => {});
  return t;
}

const MAX_TEXT = 200000;
function cleanMonth(m) {
  if (!/^\d{4}-\d{2}$/.test(m.ym)) throw new Error("Bad month");
  const text = (v) => { const s = String(v ?? ""); if (s.length > MAX_TEXT) throw new Error("This month is too long to save"); return s; };
  const sections = {};
  for (const [id, t] of Object.entries(m.sections || {})) if (t) sections[id] = text(t);
  return {
    ym: m.ym, totals: text(m.totals), links: Array.isArray(m.links) ? m.links.map((l) => (typeof l === "string" ? l : null)) : [],
    resultLabel: text(m.resultLabel).slice(0, 200), untagged: text(m.untagged), sections, updatedAt: m.updatedAt || Date.now(),
  };
}
const isEmptyMonth = (m) => !m || (!m.totals.trim() && !m.untagged.trim() && !Object.values(m.sections).some((t) => t.trim()));

const store = {
  ready: () => openDb(),
  async all() {
    const t = await transaction(["months"]);
    return (await wrap(t.objectStore("months").getAll())).sort((a, b) => (a.ym < b.ym ? -1 : 1));
  },
  async get(ym) {
    const t = await transaction(["months"]);
    return (await wrap(t.objectStore("months").get(ym))) || null;
  },
  // Saves months (each gets a fresh updatedAt, which tells the Drive backup to upload it again).
  async put(...months) {
    const t = await transaction(["months"], "readwrite");
    const now = Date.now();
    const saved = months.map((m) => cleanMonth({ ...m, updatedAt: now }));
    for (const m of saved) t.objectStore("months").put(m);
    await t.done;
    return saved;
  },
  async remove(ym) {
    const t = await transaction(["months"], "readwrite");
    t.objectStore("months").delete(ym);
    await t.done;
  },
};
