import { test } from "node:test"; import assert from "node:assert/strict";
import { parseDateCell, normalizeDateValue, mapHeaders } from "../import-dates.js";
import { fileKey, rowId, stableImportId, planRecordRow, applyClearChoice, finalizeRecord, fieldChangeStats, commitPrepared } from "../import-merge.js";

// Mirror of app.js normalize() so the tests exercise the same rules.
const NA = "N/A";
const titleCase = s => s.toLowerCase().replace(/\s+/g, " ").trim().replace(/\b\w/g, c => c.toUpperCase());
const normalize = (value, kind) => {
  if (value == null) return NA;
  const v = String(value).trim();
  if (!v) return NA;
  if (kind === "text") return titleCase(v);
  if (kind === "date") return normalizeDateValue(v, NA);
  return v.replace(/\s+/g, " ");
};

const FIELDS = [
  { id: "auditId", label: "Review ID", kind: "raw" },
  { id: "auditDate", label: "Review Date", kind: "date" },
  { id: "plannedStartDate", label: "Planned Start Date", kind: "date" },
  { id: "processName", label: "Process Name", kind: "text" },
  { id: "department", label: "Action Owner", kind: "text" },
  { id: "ncResponsibleDept", label: "Action Owner", kind: "raw" },
  { id: "actionOwner", label: "Action Owner", kind: "raw" },
  { id: "closureDate", label: "Closure Date", kind: "date" },
];

// header/rows → planned rows (rowNo mirrors app.js: first data row is CSV line 2)
function plan(headerCells, rows, existingList = [], order = null) {
  const { map, idCol, errors } = mapHeaders(headerCells, FIELDS);
  assert.deepEqual(errors, []);
  return rows.map((row, i) => {
    const rowNo = i + 2;
    const { id } = rowId({ row, idCol, rowNo, key: "testkey", pad: 3 });
    const existing = existingList.find(r => r.id === id) || null;
    const p = planRecordRow({ row, rowNo, map, order, existing, FIELDS, normalize, parseDateCell, na: NA });
    p.id = id;
    return p;
  });
}
const fin = (p, now = "2026-10-19T09:00:00.000Z") => finalizeRecord(p, { nowIso: now });

const EXISTING = {
  id: "R-1",
  auditId: "R-1",
  auditDate: "2026-09-20",
  plannedStartDate: "2026-09-01",
  processName: "Billing",
  department: "Finance",
  ncResponsibleDept: "Quality",
  actionOwner: "Sara",
  closureDate: "2026-10-01",
  attachments: [{ name: "evidence.pdf", size: 123 }],
  createdAt: "2026-01-01T00:00:00.000Z",
};

test("1. omitted columns keep the existing values", () => {
  const header = ["id", "Review ID", "Review Date"];
  const [p] = plan(header, [["R-1", "R-1", "2026-09-21"]], [EXISTING]);
  assert.equal(p.isUpdate, true);
  const rec = fin(p);
  assert.equal(rec.auditDate, "2026-09-21");            // present in file → updated
  assert.equal(rec.processName, "Billing");             // column absent → preserved
  assert.equal(rec.plannedStartDate, "2026-09-01");
  assert.equal(rec.actionOwner, "Sara");
  assert.equal(rec.closureDate, "2026-10-01");
});

test("2. blank / N/A cells keep existing values by default", () => {
  const header = ["id", "Review ID", "Review Date", "Process Name", "Action Owner", "Action Owner", "Action Owner"];
  const [p] = plan(header, [["R-1", "R-1", "2026-09-21", "", "N/A", "", "Sara New"]], [EXISTING]);
  const blanks = p.decisions.filter(d => d.action === "blank").map(d => d.id).sort();
  assert.deepEqual(blanks, ["department", "ncResponsibleDept", "processName"]);
  applyClearChoice([p], new Set(["processName", "department", "actionOwner", "closureDate"]), false);
  const rec = fin(p);
  assert.equal(rec.processName, "Billing");
  assert.equal(rec.department, "Finance");
  assert.equal(rec.ncResponsibleDept, "Quality");
  assert.equal(rec.actionOwner, "Sara New"); // non-blank cell still updated
  assert.equal(rec.auditDate, "2026-09-21");
});

test("3. explicit choice clears the blank fields to N/A", () => {
  const header = ["id", "Review ID", "Review Date", "Process Name", "Closure Date"];
  const [p] = plan(header, [["R-1", "R-1", "2026-09-21", "", ""]], [EXISTING]);
  const blankIds = new Set(["processName", "closureDate"]);
  applyClearChoice([p], blankIds, true);
  const rec = fin(p);
  assert.equal(rec.processName, "N/A");
  assert.equal(rec.closureDate, "N/A");
  assert.equal(rec.auditDate, "2026-09-21");
  // and a second run keeping them preserves instead
  const [q] = plan(header, [["R-1", "R-1", "2026-09-21", "", ""]], [EXISTING]);
  applyClearChoice([q], blankIds, false);
  const rec2 = fin(q);
  assert.equal(rec2.processName, "Billing");
  assert.equal(rec2.closureDate, "2026-10-01");
});

function fakeStore(store, failOnCommit = Infinity) {
  let commits = 0;
  return () => {
    const ops = [];
    return {
      set(id, rec) { ops.push([id, rec]); },
      async commit() {
        commits++;
        if (commits > failOnCommit) { const e = new Error("Quota exceeded"); e.code = "resource-exhausted"; throw e; }
        ops.forEach(([id, rec]) => store.set(id, rec));
      }
    };
  };
}

test("4. failure in a later batch reports how many were saved", async () => {
  const store = new Map();
  const prepared = Array.from({ length: 5 }, (_, i) => ({ rec: { id: `X-${i}` } }));
  await assert.rejects(
    commitPrepared(prepared, { batchSize: 2, newBatch: fakeStore(store, 2) }),
    err => { assert.equal(err.saved, 4); assert.equal(err.code, "resource-exhausted"); return true; }
  );
  assert.equal(store.size, 4); // first two batches are committed, third failed
});

test("5. retrying an interrupted import creates no duplicates", async () => {
  const text = "id,Review Date\nR-1,2026-09-20\nR-2,2026-09-21\nR-3,2026-09-22\n";
  const k1 = fileKey(text), k2 = fileKey("id,Review Date\nR-1,2026-09-20\nR-2,2026-09-21\nR-3,2026-09-23\n");
  assert.notEqual(k1, k2); // different file content → different IDs
  const ids = [1, 2, 3].map(n => stableImportId(k1, n + 1, 1));
  assert.deepEqual(new Set(ids).size, 3);
  // Simulate: first run saves 2 of 3, then the whole import runs again on the same store.
  const store = new Map();
  const prepared = ids.map(id => ({ rec: { id } }));
  await assert.rejects(commitPrepared(prepared, { batchSize: 2, newBatch: fakeStore(store, 1) }), err => { assert.equal(err.saved, 2); return true; });
  const res = await commitPrepared(prepared, { batchSize: 2, newBatch: fakeStore(store, Infinity) });
  assert.equal(res.saved, 3);
  assert.equal(store.size, 3);                       // no duplicates
  assert.deepEqual([...store.keys()].sort(), ids.slice().sort());
});

test("6. attachments and original createdAt are never overwritten", () => {
  const header = ["id", "Review ID", "Review Date", "Process Name"];
  const [p] = plan(header, [["R-1", "R-1", "2026-09-21", "Billing Ops"]], [EXISTING]);
  const rec = fin(p, "2026-10-19T09:00:00.000Z");
  assert.deepEqual(rec.attachments, EXISTING.attachments);
  assert.equal(rec.createdAt, "2026-01-01T00:00:00.000Z");
  assert.equal(rec.updatedAt, "2026-10-19T09:00:00.000Z");
  assert.equal(rec.processName, "Billing Ops"); // title-cased text update went through
});

test("7. export → re-import round trip loses nothing", () => {
  // "Export": one column per field, in export order, values straight from the record.
  const header = ["id", ...FIELDS.map(f => f.label)];
  const rec0 = { ...EXISTING };
  const row = [rec0.id, rec0.auditId, rec0.auditDate, rec0.plannedStartDate, rec0.processName, rec0.department, rec0.ncResponsibleDept, rec0.actionOwner, rec0.closureDate];
  // "Re-import": mapped against the same record must reproduce every value.
  const [p] = plan(header, [row], [rec0]);
  assert.equal(p.decisions.every(d => d.action === "update"), true);
  const rec = fin(p);
  FIELDS.forEach(f => assert.equal(rec[f.id], rec0[f.id], `field ${f.id}`));
  assert.deepEqual(rec.attachments, rec0.attachments);
  assert.equal(rec.createdAt, rec0.createdAt);
});
