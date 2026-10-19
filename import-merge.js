/* Import merge + safe-commit helpers for the CSV importer.
   Pure logic only (no DOM, no Firebase) so it can be unit-tested.
   Used by app.js importCSV(); see IMPORT-NOTES.md for the documented rules. */

// Stable identity for an import run: a hash of the file contents.
// Re-running the same file after an interrupted import produces the same
// record IDs, so already-saved records are updated in place, never duplicated.
export function fileKey(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export function stableImportId(key, rowNo, pad) {
  return `imp-${key}-${String(rowNo).padStart(pad, "0")}`;
}

export function rowId({ row, idCol, rowNo, key, pad }) {
  const rawId = idCol >= 0 ? String(row[idCol] ?? "").trim() : "";
  return { id: rawId || stableImportId(key, rowNo, pad), rawId };
}

/* Decides, for one CSV row, what happens to each field.
   decisions: { id, label, action, value } where action is:
     "update"   — the CSV has a usable value; the field will be written
     "preserve" — the column is absent from the file; the existing value is kept
     "blank"    — the column is present but the cell is blank or N/A on an
                  update row; kept or cleared according to the user's choice
     "clear"    — (after applyClearChoice) the existing value is cleared to N/A
   New records (no existing match) always take the CSV value, blank → N/A. */
export function planRecordRow({ row, rowNo, map, order, existing, FIELDS, normalize, parseDateCell, na = "N/A" }) {
  const issues = [];
  const decisions = [];
  FIELDS.forEach(f => {
    const colPresent = map[f.id] != null;
    const raw = colPresent ? row[map[f.id]] ?? "" : undefined;
    if (existing && !colPresent) {
      decisions.push({ id: f.id, label: f.label, action: "preserve", value: existing[f.id] });
      return;
    }
    if (f.kind !== "date") {
      const v = normalize(raw, f.kind);
      if (existing && v === na) decisions.push({ id: f.id, label: f.label, action: "blank", value: raw });
      else decisions.push({ id: f.id, label: f.label, action: "update", value: v });
      return;
    }
    const r = parseDateCell(raw, order);
    if (r.status === "ok") {
      decisions.push({ id: f.id, label: f.label, action: "update", value: r.value });
    } else if (r.status === "blank") {
      if (existing) decisions.push({ id: f.id, label: f.label, action: "blank", value: raw });
      else decisions.push({ id: f.id, label: f.label, action: "update", value: na });
    } else {
      issues.push({ row: rowNo, column: f.label, value: raw, problem: r.status === "ambiguous" ? "Ambiguous date" : "Not a valid date" });
      decisions.push({ id: f.id, label: f.label, action: "update", value: na });
    }
  });
  return { rowNo, existing: existing || null, isUpdate: !!existing, decisions, issues, ok: issues.length === 0 };
}

/* Applies the user's choice for blank / N/A cells on update rows.
   clear=false → keep the existing value; clear=true → set the field to N/A. */
export function applyClearChoice(prepared, fieldIds, clear, na = "N/A") {
  prepared.forEach(p => p.decisions.forEach(d => {
    if (d.action !== "blank" || !fieldIds.has(d.id)) return;
    if (clear) { d.action = "clear"; d.value = na; }
    else { d.action = "preserve"; d.value = p.existing ? p.existing[d.id] : na; }
  }));
}

/* Builds the record that will be saved.
   Updates keep the existing document's other keys, attachments and original
   createdAt; only decided fields are written. updatedAt is always refreshed. */
export function finalizeRecord(p, { nowIso }) {
  let rec;
  if (p.existing) {
    rec = { ...p.existing, id: p.id };
    rec.attachments = p.existing.attachments || [];       // never overwritten by an import
    if (p.existing.createdAt) rec.createdAt = p.existing.createdAt; // original kept
  } else {
    rec = { id: p.id, attachments: [], importSeq: p.rowNo - 1, importedAt: nowIso, createdAt: nowIso };
  }
  rec.updatedAt = nowIso;
  p.decisions.forEach(d => {
    if (d.action === "update" || d.action === "clear") rec[d.id] = d.value;
    // "preserve": leave whatever the existing document already had
  });
  return rec;
}

/* Per-field totals across the update rows, for the confirmation preview. */
export function fieldChangeStats(prepared) {
  const stats = {};
  prepared.forEach(p => {
    if (!p.isUpdate) return;
    p.decisions.forEach(d => {
      const s = stats[d.id] || (stats[d.id] = { id: d.id, label: d.label, update: 0, preserve: 0, clear: 0 });
      if (d.action === "update") s.update++;
      else if (d.action === "preserve") s.preserve++;
      else if (d.action === "clear") s.clear++;
    });
  });
  return stats;
}

/* Saves prepared records in batches of `batchSize` (Firestore limit is 500).
   NOT atomic across batches: if a later batch fails, earlier ones are already
   saved. The thrown error carries `.saved` (records committed so far) so the
   caller can report progress. Record IDs are stable, so re-running the same
   file updates the already-saved records in place instead of duplicating. */
export async function commitPrepared(prepared, { batchSize = 450, onProgress = () => {}, newBatch }) {
  let saved = 0;
  try {
    for (let s = 0; s < prepared.length; s += batchSize) {
      const batch = newBatch();
      prepared.slice(s, s + batchSize).forEach(p => batch.set(p.rec.id, p.rec));
      await batch.commit();
      saved += Math.min(batchSize, prepared.length - s);
      onProgress(saved, prepared.length);
    }
    return { saved, complete: true };
  } catch (err) {
    err.saved = saved;
    throw err;
  }
}
