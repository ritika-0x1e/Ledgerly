"use strict";
// Run: node test/format.test.js
// Reads the sample notebook and checks the sums the app works out match the hand-written ones.
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const F = require("../js/format.js");

// The sample is personal notes, kept out of git, so the test is skipped where it isn't there (CI).
const samplePath = path.join(__dirname, "..", "test fomat .md");
if (!fs.existsSync(samplePath)) { console.log("skipped: \"test fomat .md\" is not here"); process.exit(0); }
const sample = fs.readFileSync(samplePath, "utf8");
const tags = [{ id: "t1", name: "Regular" }, { id: "t2", name: "Major" }];
const money = (p) => (p / 100).toFixed(2);

// text -> months, the way Import does it
function importText(text) {
  const months = F.parseNotes(text, tags).map(F.blockToDraft).map((d) => ({
    ym: d.ym, totals: d.totals, resultLabel: d.resultLabel, untagged: d.untagged,
    sections: Object.fromEntries(d.sections.map((s) => [F.tagNamed(s.name, tags).id, s.text])),
  }));
  let prev = null;
  for (const m of months) { F.relinkTotals(m, tags, prev); prev = F.computeMonth(m, tags, prev).result; }
  return months;
}

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log("ok   ", name); } catch (e) { failed++; console.log("FAIL ", name, "\n     ", e.message); }
};

const months = importText(sample);
const comps = F.computeAll(months, tags);
const get = (ym) => comps.get(ym);

check("finds Sept, Oct, Nov 2026", () => assert.deepStrictEqual(months.map((m) => m.ym), ["2026-09", "2026-10", "2026-11"]));
check("Sept Regular = 505.65", () => assert.strictEqual(money(-get("2026-09").tagTotals.t1), "505.65"));
check("Sept result = 2388.00", () => assert.strictEqual(money(get("2026-09").result), "2388.00"));
check("Sept result label kept", () => assert.strictEqual(months[0].resultLabel, "Available to spend in October"));
check("Oct Regular = 286.03", () => assert.strictEqual(money(-get("2026-10").tagTotals.t1), "286.03"));
check("Oct Major = 1252.90", () => assert.strictEqual(money(-get("2026-10").tagTotals.t2), "1252.90"));
check("Oct result = 1567.18", () => assert.strictEqual(money(get("2026-10").result), "1567.18"));
check("Oct carry-over is linked to Sept", () => {
  const first = months[1].totals.split("\n")[0];
  assert.ok(F.parseLine(first).paise === null, first);
  assert.strictEqual(get("2026-10").vals[0].auto, "carry");
});
check("subtotals, totals and rules are dropped", () => {
  for (const m of months) {
    const all = [m.totals, m.untagged, ...Object.values(m.sections)].join("\n");
    assert.ok(!/Leftover|total|____|———|====/.test(all), all.slice(0, 200));
  }
});
check("Nov blank figures stay blank", () => {
  const salary = months[2].totals.split("\n").find((l) => /Salary/.test(l));
  assert.strictEqual(F.parseLine(salary).paise, null, salary);
});
check("text -> months -> text -> months keeps every figure", () => {
  const text = months.map((m) => F.monthToText(m, tags, comps.get(m.ym))).join("\n");
  const again = importText(text);
  const c2 = F.computeAll(again, tags);
  for (const m of months) {
    const a = comps.get(m.ym), b = c2.get(m.ym);
    assert.strictEqual(b.result, a.result, `${m.ym} result`);
    assert.deepStrictEqual(b.tagTotals, a.tagTotals, `${m.ym} tags`);
  }
});
check("CSV round trip", () => {
  const csv = F.monthsToCsv(months, tags, comps);
  const drafts = F.csvToDrafts(csv);
  assert.strictEqual(drafts.length, 3);
  const oct = drafts[1];
  const reg = oct.sections.find((s) => s.name === "Regular");
  assert.strictEqual(money(-F.areaTotal(reg.text)), "286.03");
});
check("line parsing", () => {
  const p = (s) => { const x = F.parseLine(s); return [x.sign, x.paise, x.label]; };
  assert.deepStrictEqual(p("bus 4"), [-1, 400, "bus"]);
  assert.deepStrictEqual(p("4 bus"), [-1, 400, "bus"]);
  assert.deepStrictEqual(p("+ 8.50 Trainline refund"), [1, 850, "Trainline refund"]);
  assert.deepStrictEqual(p("refund +8.50"), [1, 850, "refund"]);
  assert.deepStrictEqual(p("£12 gym"), [-1, 1200, "gym"]);
  assert.deepStrictEqual(p("- 0.10 card check (will cover 2.50)"), [-1, 10, "card check (will cover 2.50)"]);
  assert.strictEqual(F.parseLine("__________"), null);
  assert.strictEqual(F.parseLine("   "), null);
});
check("tag matching by words", () => {
  const t = [{ id: "a", name: "Eating Out" }, { id: "r", name: "Regular" }];
  assert.strictEqual(F.tagNamed("eating-out", t).id, "a");
  assert.strictEqual(F.tagNamed("Eating (Out)", t).id, "a");
  assert.strictEqual(F.tagInLabel("Regular  expenses", t).id, "r");
  assert.strictEqual(F.tagInLabel("Irregular expenses", t), null);
});
check("new month moves month names on, keeps figures blank", () => {
  const dec = F.nextMonthFrom(months[2], "2026-12");
  assert.ok(/Salary Dec/.test(dec.totals), dec.totals);
  assert.ok(/Rent Adv January/.test(dec.totals), dec.totals);
  assert.strictEqual(dec.resultLabel, "Available to spend in January");
  assert.ok(dec.totals.split("\n").every((l) => !F.parseLine(l) || F.parseLine(l).paise === null));
});

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
