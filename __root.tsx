import * as XLSX from "xlsx";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Map possible header variants to canonical field name. */
export function buildRowMapper<T extends Record<string, string[]>>(map: T) {
  const lookup: Record<string, keyof T> = {};
  for (const key in map) {
    for (const variant of map[key]) lookup[norm(variant)] = key;
  }
  return (row: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const rawKey in row) {
      const canonical = lookup[norm(rawKey)];
      if (canonical) out[canonical as string] = row[rawKey];
    }
    return out;
  };
}

export const parseBool = (v: unknown): boolean | null => {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim().toLowerCase();
  if (["y", "yes", "true", "1"].includes(s)) return true;
  if (["n", "no", "false", "0"].includes(s)) return false;
  if (["n/a", "na", "-"].includes(s)) return null;
  return null;
};

export async function readXlsx(file: File): Promise<Record<string, unknown>[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

export function downloadXlsx(rows: Record<string, unknown>[], filename: string, sheetName = "Sheet1") {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}
