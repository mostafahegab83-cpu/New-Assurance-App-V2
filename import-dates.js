/* Date + CSV-header helpers for the Records import.
   Pure functions (no DOM / Firestore) so they can be unit-tested.
   All dates are handled as calendar dates (Y, M, D integers) — never via
   Date parsing of strings, UTC conversion or toISOString(), so no day shift. */

const NA_VALUES = new Set(["", "n/a", "na", "-", "—"]);
const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };

const pad2 = n => String(n).padStart(2, "0");

function validYmd(y, m, d) {
  if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1)) return false;
  const dim = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31,30,31,30,31,31,30,31,30,31];
  return d <= dim[m - 1];
}
const ymd = (y, m, d) => validYmd(y, m, d) ? `${y}-${pad2(m)}-${pad2(d)}` : null;
const fullYear = y => (y < 100 ? 2000 + y : y);

/** Is the cell blank / N/A (preserved as the app's "N/A" convention)? */
export function isBlankDate(v) {
  return v == null || NA_VALUES.has(String(v).trim().toLowerCase());
}

/** Detect a slash/dot/dash numeric date "a/b/yyyy" (with optional time). */
function splitNumeric(s) {
  const m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})(?:[ T,]+\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?\s*(?:[ap]\.?m\.?)?)?$/i.exec(s);
  return m ? [+m[1], +m[2], +m[3]] : null;
}

/**
 * Parse one date cell.
 * @param {string} raw
 * @param {"DMY"|"MDY"|null} slashOrder - how to read a/b/yyyy values
 * @returns {{status:"blank"} | {status:"ok", value:string} | {status:"ambiguous"} | {status:"invalid"}}
 */
export function parseDateCell(raw, slashOrder = null) {
  if (isBlankDate(raw)) return { status: "blank" };
  const s = String(raw).trim().replace(/\s+/g, " ");
  let m;

  // ISO date, optionally followed by a time / timezone: keep the written calendar date.
  if ((m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[T ].*)?$/.exec(s))) {
    const v = ymd(+m[1], +m[2], +m[3]);
    return v ? { status: "ok", value: v } : { status: "invalid" };
  }
  // Excel serial number (1900 date system). 20000..80000 ≈ 1954..2119.
  if ((m = /^(\d{5})(?:\.\d+)?$/.exec(s))) {
    const n = +m[1];
    if (n < 20000 || n > 80000) return { status: "invalid" };
    const dt = new Date(Date.UTC(1899, 11, 30) + n * 86400000); // read with UTC getters only
    return { status: "ok", value: ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()) };
  }
  // 20-Sep-2026 / 20 Sep 2026
  if ((m = /^(\d{1,2})[ \-\/]([A-Za-z]{3,9})\.?[ \-\/,]+(\d{2}|\d{4})(?:[ T].*)?$/.exec(s))) {
    const mo = MONTHS[m[2].toLowerCase().slice(0, m[2].toLowerCase().startsWith("sept") ? 4 : 3)];
    const v = mo && ymd(fullYear(+m[3]), mo, +m[1]);
    return v ? { status: "ok", value: v } : { status: "invalid" };
  }
  // Sep 20, 2026
  if ((m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})(?:[ T].*)?$/.exec(s))) {
    const mo = MONTHS[m[1].toLowerCase().slice(0, 3)];
    const v = mo && ymd(+m[3], mo, +m[2]);
    return v ? { status: "ok", value: v } : { status: "invalid" };
  }
  // 20/09/2026 or 09/20/2026 (with optional time)
  const p = splitNumeric(s);
  if (p) {
    const [a, b, y] = p;
    const Y = fullYear(y);
    const dmy = ymd(Y, b, a), mdy = ymd(Y, a, b);
    if (slashOrder === "DMY") return dmy ? { status: "ok", value: dmy } : { status: "invalid" };
    if (slashOrder === "MDY") return mdy ? { status: "ok", value: mdy } : { status: "invalid" };
    if (dmy && mdy && a !== b) return { status: "ambiguous" };
    const v = dmy || mdy;
    return v ? { status: "ok", value: v } : { status: "invalid" };
  }
  return { status: "invalid" };
}

/**
 * Decide the slash order for a whole file from its date cells.
 * Returns "DMY" | "MDY" | "conflict" | null (nothing decisive found).
 */
export function detectSlashOrder(values) {
  let dmy = false, mdy = false;
  values.forEach(v => {
    if (isBlankDate(v)) return;
    const p = splitNumeric(String(v).trim().replace(/\s+/g, " "));
    if (!p) return;
    if (p[0] > 12 && p[1] <= 12) dmy = true;
    if (p[1] > 12 && p[0] <= 12) mdy = true;
  });
  if (dmy && mdy) return "conflict";
  return dmy ? "DMY" : mdy ? "MDY" : null;
}

/** True if any value is an unresolved a/b/yyyy where both readings are valid. */
export function hasAmbiguousSlashDates(values) {
  return values.some(v => parseDateCell(v, null).status === "ambiguous");
}

/** For form saves: normalise to YYYY-MM-DD when recognisable, otherwise keep text. */
export function normalizeDateValue(raw, na = "N/A") {
  const r = parseDateCell(raw, "DMY");
  if (r.status === "blank") return na;
  if (r.status === "ok") return r.value;
  return String(raw).trim();
}

/** Local-calendar Date from a stored value (avoids UTC parsing of "YYYY-MM-DD"). */
export function toLocalDate(v) {
  const r = parseDateCell(v, "DMY");
  if (r.status !== "ok") return null;
  const [y, m, d] = r.value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export const normHeader = h => String(h ?? "").replace(/^\uFEFF/, "").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Map CSV header columns to fields.
 * Each field matches its internal id first, then its label (case/space-insensitive).
 * Fields that share a label (e.g. three "Action Owner" columns) are matched by
 * position, in the given export order; a count mismatch is reported as ambiguous.
 * @returns {{map: Object<string, number>, idCol: number, errors: string[], missing: string[]}}
 */
export function mapHeaders(header, fieldsInExportOrder) {
  const norm = header.map(normHeader);
  const errors = [], missing = [];
  const map = {};
  const used = new Set();
  const colsOf = key => norm.map((h, i) => (h === key ? i : -1)).filter(i => i >= 0);

  // id column
  const idCols = colsOf("id");
  if (idCols.length > 1) errors.push(`Duplicate "id" columns (columns ${idCols.map(i => i + 1).join(", ")}).`);
  const idCol = idCols.length ? idCols[0] : -1;
  idCols.forEach(i => used.add(i));

  // pass 1: internal ids (skipped when the same text is also a field label,
  // e.g. id "department" vs the "Department" label of processOwner)
  const labels = new Set(fieldsInExportOrder.map(f => normHeader(f.label)));
  fieldsInExportOrder.forEach(f => {
    if (labels.has(normHeader(f.id))) return;
    const cols = colsOf(normHeader(f.id));
    if (cols.length > 1) errors.push(`Duplicate column "${f.id}".`);
    if (cols.length) { map[f.id] = cols[0]; cols.forEach(c => used.add(c)); }
  });
  // pass 2: labels, grouped so duplicated labels are matched by position
  const byLabel = {};
  fieldsInExportOrder.forEach(f => {
    if (map[f.id] != null) return;
    (byLabel[normHeader(f.label)] ||= []).push(f);
  });
  Object.entries(byLabel).forEach(([label, fs]) => {
    const cols = colsOf(label).filter(c => !used.has(c));
    if (!cols.length) { fs.forEach(f => missing.push(f.label)); return; }
    if (fs.length === 1 && cols.length > 1) {
      errors.push(`Column "${fs[0].label}" appears ${cols.length} times — cannot tell which one to use.`);
      return;
    }
    if (fs.length > 1 && cols.length !== fs.length) {
      errors.push(`Found ${cols.length} "${fs[0].label}" column(s) but expected ${fs.length} (${fs.map(f => f.id).join(", ")}). Rename them to the field IDs to import.`);
      return;
    }
    fs.forEach((f, k) => { map[f.id] = cols[k]; used.add(cols[k]); });
  });
  return { map, idCol, errors, missing };
}

/** Review IDs look like R-YYYYMMDD-NN; returns the YYYY-MM-DD part or null. */
export function reviewIdDate(id) {
  const m = /^R-(\d{4})(\d{2})(\d{2})-\d+$/i.exec(String(id ?? "").trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
