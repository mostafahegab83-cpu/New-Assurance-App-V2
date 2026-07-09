import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Upload, FileSpreadsheet, Loader2 } from "lucide-react";
import { readXlsx } from "@/lib/excel";
import { toast } from "sonner";

interface Props<T> {
  label?: string;
  mapper: (row: Record<string, unknown>) => T;
  onImport: (rows: T[]) => Promise<void>;
  templateHeaders: string[];
}

export function ExcelImport<T>({ label = "Import Excel", mapper, onImport, templateHeaders }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<T[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setBusy(true);
    try {
      const raw = await readXlsx(file);
      const mapped = raw.map(mapper);
      setRows(mapped);
      setOpen(true);
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  const commit = async () => {
    setBusy(true);
    try {
      await onImport(rows);
      toast.success(`Imported ${rows.length} rows`);
      setOpen(false);
      setRows([]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
      />
      <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
        {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" /> Preview import</DialogTitle>
            <DialogDescription>
              {rows.length} rows parsed. Expected columns: <span className="font-mono text-xs">{templateHeaders.join(", ")}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-64 overflow-auto rounded-md border text-xs">
            <pre className="p-3">{JSON.stringify(rows.slice(0, 5), null, 2)}</pre>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={commit} disabled={busy || rows.length === 0}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Import {rows.length} rows
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
