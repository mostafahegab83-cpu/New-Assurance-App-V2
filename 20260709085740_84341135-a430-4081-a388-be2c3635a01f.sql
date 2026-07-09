import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listValidations, upsertValidation, bulkImportValidations, deleteValidation } from "@/lib/validation.functions";
import { buildRowMapper, downloadXlsx, parseBool } from "@/lib/excel";
import { ExcelImport } from "@/components/ExcelImport";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Download, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const TEMPLATE_HEADERS = [
  "Document Title","Document Type","Document Code","Process Owner","Company Name",
  "Process Exists? (Y/N)","If No → Status","Evidence Exists? (Y/N)","Automated? (Y/N)","Evidence Reviewed","Comments","Process ID"
];

const mapRow = buildRowMapper({
  document_title: ["Document Title", "Title"],
  document_type: ["Document Type", "Type"],
  document_code: ["Document Code", "Code"],
  process_id: ["Process ID", "PID"],
  process_owner: ["Process Owner", "Owner"],
  company_name: ["Company Name", "Company"],
  process_exists: ["Process Exists?", "Process Exists", "Process Exists (Y/N)"],
  if_no_status: ["If No", "If No Status", "If No -> Status"],
  evidence_exists: ["Evidence Exists?", "Evidence Exists", "Evidence Exists (Y/N)"],
  automated: ["Automated?", "Automated", "Automated (Y/N)"],
  evidence_reviewed: ["Evidence Reviewed", "Reviewed"],
  comments: ["Comments", "Comment", "Notes"],
});

type Row = {
  id: string;
  document_title: string;
  document_type: string | null;
  document_code: string | null;
  process_id: string | null;
  process_owner: string | null;
  company_name: string | null;
  process_exists: boolean;
  if_no_status: string | null;
  evidence_exists: boolean | null;
  process_status: string | null;
  automated: boolean | null;
  evidence_reviewed: string | null;
  comments: string | null;
};

export const Route = createFileRoute("/_authenticated/gap-analysis/validation")({
  component: ValidationPage,
});

function ValidationPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listValidations);
  const upsertFn = useServerFn(upsertValidation);
  const bulkFn = useServerFn(bulkImportValidations);
  const delFn = useServerFn(deleteValidation);

  const { data: rows = [], isLoading } = useQuery({ queryKey: ["validations"], queryFn: () => listFn() as Promise<Row[]> });

  const [search, setSearch] = useState("");
  const [filterCompany, setFilterCompany] = useState("all");
  const [filterOwner, setFilterOwner] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterAuto, setFilterAuto] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const companies = useMemo(() => Array.from(new Set(rows.map((r) => r.company_name).filter(Boolean))) as string[], [rows]);
  const owners = useMemo(() => Array.from(new Set(rows.map((r) => r.process_owner).filter(Boolean))) as string[], [rows]);
  const statuses = ["Non-Existing", "Documented/Claimed Only (Not Verified)", "Existing & Operational"];

  const filtered = useMemo(() => rows.filter((r) => {
    if (search && !`${r.document_title} ${r.document_code} ${r.process_id}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCompany !== "all" && r.company_name !== filterCompany) return false;
    if (filterOwner !== "all" && r.process_owner !== filterOwner) return false;
    if (filterStatus !== "all" && r.process_status !== filterStatus) return false;
    if (filterAuto !== "all" && String(r.automated) !== filterAuto) return false;
    return true;
  }), [rows, search, filterCompany, filterOwner, filterStatus, filterAuto]);

  const importMut = useMutation({
    mutationFn: async (parsed: Record<string, unknown>[]) => {
      const mapped = parsed
        .filter((r) => r.document_title)
        .map((r) => ({
          document_title: String(r.document_title),
          document_type: r.document_type ? String(r.document_type) : null,
          document_code: r.document_code ? String(r.document_code) : null,
          process_id: r.process_id ? String(r.process_id) : null,
          process_owner: r.process_owner ? String(r.process_owner) : null,
          company_name: r.company_name ? String(r.company_name) : null,
          process_exists: parseBool(r.process_exists) ?? false,
          if_no_status: r.if_no_status ? String(r.if_no_status) : null,
          evidence_exists: parseBool(r.evidence_exists),
          automated: parseBool(r.automated),
          evidence_reviewed: r.evidence_reviewed ? String(r.evidence_reviewed) : null,
          comments: r.comments ? String(r.comments) : null,
        }));
      return bulkFn({ data: { rows: mapped } });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["validations"] }); qc.invalidateQueries({ queryKey: ["gaps"] }); },
  });

  const saveMut = useMutation({
    mutationFn: (row: Partial<Row>) => upsertFn({ data: row as never }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["validations"] }); qc.invalidateQueries({ queryKey: ["gaps"] }); toast.success("Saved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["validations"] }); setSelected(new Set()); toast.success("Deleted"); },
  });

  const exportRows = () => {
    downloadXlsx(filtered.map((r) => ({
      "Document Title": r.document_title,
      "Document Type": r.document_type,
      "Document Code": r.document_code,
      "Process ID": r.process_id,
      "Process Owner": r.process_owner,
      "Company Name": r.company_name,
      "Process Exists?": r.process_exists ? "Y" : "N",
      "If No Status": r.if_no_status,
      "Evidence Exists?": r.evidence_exists === null ? "N/A" : r.evidence_exists ? "Y" : "N",
      "Process Status": r.process_status,
      "Automated?": r.automated === null ? "N/A" : r.automated ? "Y" : "N",
      "Evidence Reviewed": r.evidence_reviewed,
      "Comments": r.comments,
    })), `process-validation-${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const addRow = () => saveMut.mutate({ document_title: "New document", process_exists: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Process Validation Interviews</h1>
        <p className="text-sm text-muted-foreground">Validate whether identified processes actually exist and are supported by objective evidence.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Records ({filtered.length})</CardTitle>
          <div className="flex flex-wrap gap-2">
            <ExcelImport label="Import .xlsx" mapper={mapRow} templateHeaders={TEMPLATE_HEADERS}
              onImport={(rows) => importMut.mutateAsync(rows as Record<string, unknown>[]).then(() => {})} />
            <Button variant="outline" onClick={exportRows}><Download className="mr-2 h-4 w-4" />Export</Button>
            <Button onClick={addRow}><Plus className="mr-2 h-4 w-4" />New</Button>
            {selected.size > 0 && (
              <Button variant="destructive" onClick={() => selected.forEach((id) => deleteMut.mutate(id))}>
                <Trash2 className="mr-2 h-4 w-4" />Delete ({selected.size})
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Search title / code / process id..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
            {companies.length > 0 && (
              <Select value={filterCompany} onValueChange={setFilterCompany}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">Company: All</SelectItem>{companies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            )}
            {owners.length > 0 && (
              <Select value={filterOwner} onValueChange={setFilterOwner}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">Owner: All</SelectItem>{owners.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            )}
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">Status: All</SelectItem>{statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={filterAuto} onValueChange={setFilterAuto}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Automated: All</SelectItem>
                <SelectItem value="true">Automated</SelectItem>
                <SelectItem value="false">Manual</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Document Title</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Process ID</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Exists?</TableHead>
                  <TableHead>Evidence?</TableHead>
                  <TableHead>Automated?</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Comments</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>}
                {!isLoading && filtered.length === 0 && <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">No records yet.</TableCell></TableRow>}
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><Checkbox checked={selected.has(r.id)} onCheckedChange={(v) => { const s = new Set(selected); v ? s.add(r.id) : s.delete(r.id); setSelected(s); }} /></TableCell>
                    <EditableCell value={r.document_title} onSave={(v) => saveMut.mutate({ ...r, document_title: v })} />
                    <EditableCell value={r.document_code ?? ""} onSave={(v) => saveMut.mutate({ ...r, document_code: v })} />
                    <EditableCell value={r.process_id ?? ""} onSave={(v) => saveMut.mutate({ ...r, process_id: v })} />
                    <EditableCell value={r.process_owner ?? ""} onSave={(v) => saveMut.mutate({ ...r, process_owner: v })} />
                    <EditableCell value={r.company_name ?? ""} onSave={(v) => saveMut.mutate({ ...r, company_name: v })} />
                    <TableCell><TriToggle value={r.process_exists} onToggle={() => saveMut.mutate({ ...r, process_exists: !r.process_exists })} /></TableCell>
                    <TableCell>
                      {r.process_exists ? (
                        <TriToggle value={r.evidence_exists} onToggle={() => saveMut.mutate({ ...r, evidence_exists: r.evidence_exists === true ? false : r.evidence_exists === false ? null : true })} />
                      ) : <Badge variant="outline">N/A</Badge>}
                    </TableCell>
                    <TableCell>
                      {r.process_exists ? (
                        <TriToggle value={r.automated} onToggle={() => saveMut.mutate({ ...r, automated: r.automated === true ? false : r.automated === false ? null : true })} />
                      ) : <Badge variant="outline">N/A</Badge>}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.process_status} />
                    </TableCell>
                    <EditableCell value={r.comments ?? ""} onSave={(v) => saveMut.mutate({ ...r, comments: v })} />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EditableCell({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <TableCell className="min-w-32">
      <Input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} className="h-8 border-0 bg-transparent focus-visible:bg-secondary" />
    </TableCell>
  );
}

function TriToggle({ value, onToggle }: { value: boolean | null; onToggle: () => void }) {
  return (
    <button onClick={onToggle}>
      <Badge variant={value === true ? "default" : value === false ? "destructive" : "outline"}>
        {value === null || value === undefined ? "N/A" : value ? "Yes" : "No"}
      </Badge>
    </button>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  const cls =
    status === "Existing & Operational" ? "bg-success text-success-foreground" :
    status === "Non-Existing" ? "bg-destructive text-destructive-foreground" :
    "bg-warning text-warning-foreground";
  return <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}
