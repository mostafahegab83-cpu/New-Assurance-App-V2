import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listGaps } from "@/lib/gap.functions";
import { listValidations } from "@/lib/validation.functions";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, ListChecks, PieChart as PieIcon, Bot, Hand, ClipboardCheck, AlertCircle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend, CartesianGrid } from "recharts";

const PALETTE = ["#3b5b8f", "#3faab5", "#5cb87a", "#e6b34a", "#d76a5d", "#7a5cb8"];

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const gapFn = useServerFn(listGaps);
  const valFn = useServerFn(listValidations);
  const { data: gaps = [] } = useQuery({ queryKey: ["gaps"], queryFn: () => gapFn() as Promise<Array<{ existing_in_idh: boolean; department: string | null }>> });
  const { data: vals = [] } = useQuery({ queryKey: ["validations"], queryFn: () => valFn() as Promise<Array<{ process_status: string | null; automated: boolean | null; company_name: string | null }>> });

  const gapKpi = useMemo(() => {
    const total = gaps.length;
    const existing = gaps.filter((g) => g.existing_in_idh).length;
    const missing = total - existing;
    const gapPct = total ? Math.round((missing / total) * 1000) / 10 : 0;
    return { total, existing, missing, gapPct };
  }, [gaps]);

  const valKpi = useMemo(() => {
    const operational = vals.filter((v) => v.process_status === "Existing & Operational").length;
    const claimed = vals.filter((v) => v.process_status === "Documented/Claimed Only (Not Verified)").length;
    const nonExisting = vals.filter((v) => v.process_status === "Non-Existing").length;
    const automated = vals.filter((v) => v.automated === true).length;
    const manual = vals.filter((v) => v.automated === false).length;
    return { operational, claimed, nonExisting, automated, manual };
  }, [vals]);

  const statusDist = [
    { name: "Existing & Operational", value: valKpi.operational },
    { name: "Documented Only", value: valKpi.claimed },
    { name: "Non-Existing", value: valKpi.nonExisting },
  ];
  const autoVsManual = [
    { name: "Automated", value: valKpi.automated },
    { name: "Manual", value: valKpi.manual },
  ];
  const existVsMiss = [
    { name: "Existing", value: gapKpi.existing },
    { name: "Missing", value: gapKpi.missing },
  ];

  const byCompany = useMemo(() => {
    const acc: Record<string, { company: string; operational: number; claimed: number; nonExisting: number }> = {};
    for (const v of vals) {
      const c = v.company_name || "Unassigned";
      acc[c] ??= { company: c, operational: 0, claimed: 0, nonExisting: 0 };
      if (v.process_status === "Existing & Operational") acc[c].operational++;
      else if (v.process_status === "Documented/Claimed Only (Not Verified)") acc[c].claimed++;
      else if (v.process_status === "Non-Existing") acc[c].nonExisting++;
    }
    return Object.values(acc);
  }, [vals]);

  const deptHeat = useMemo(() => {
    const acc: Record<string, { total: number; gaps: number }> = {};
    for (const g of gaps) {
      const d = g.department || "Unassigned";
      acc[d] ??= { total: 0, gaps: 0 };
      acc[d].total++;
      if (!g.existing_in_idh) acc[d].gaps++;
    }
    return Object.entries(acc).map(([department, s]) => ({ department, ...s, pct: s.total ? s.gaps / s.total : 0 }));
  }, [gaps]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Gap Analysis Dashboard</h1>
        <p className="text-sm text-muted-foreground">Executive view of process gaps and validation outcomes.</p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">A. Gap Analysis Report</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KPICard label="Best Practice Processes" value={gapKpi.total} icon={ListChecks} tone="info" />
          <KPICard label="Existing Processes" value={gapKpi.existing} icon={CheckCircle2} tone="success" />
          <KPICard label="Missing Processes" value={gapKpi.missing} icon={XCircle} tone="destructive" />
          <KPICard label="Gap %" value={`${gapKpi.gapPct}%`} icon={PieIcon} tone="warning" />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">B. Process Validation Report</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <KPICard label="Existing & Operational" value={valKpi.operational} icon={ClipboardCheck} tone="success" />
          <KPICard label="Claimed / No Evidence" value={valKpi.claimed} icon={AlertCircle} tone="warning" />
          <KPICard label="Non-Existing" value={valKpi.nonExisting} icon={XCircle} tone="destructive" />
          <KPICard label="Automated" value={valKpi.automated} icon={Bot} tone="accent" />
          <KPICard label="Manual" value={valKpi.manual} icon={Hand} tone="info" />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <ChartWrap title="Existing vs Missing Processes">
          <PieChart>
            <Pie data={existVsMiss} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
              {existVsMiss.map((_, i) => <Cell key={i} fill={PALETTE[i]} />)}
            </Pie><Tooltip /><Legend />
          </PieChart>
        </ChartWrap>
        <ChartWrap title="Process Status Distribution">
          <PieChart>
            <Pie data={statusDist} dataKey="value" nameKey="name" outerRadius={90}>
              {statusDist.map((_, i) => <Cell key={i} fill={PALETTE[i + 2]} />)}
            </Pie><Tooltip /><Legend />
          </PieChart>
        </ChartWrap>
        <ChartWrap title="Automated vs Manual Processes">
          <PieChart>
            <Pie data={autoVsManual} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
              {autoVsManual.map((_, i) => <Cell key={i} fill={PALETTE[i + 1]} />)}
            </Pie><Tooltip /><Legend />
          </PieChart>
        </ChartWrap>
        <ChartWrap title="Company-wise Process Validation">
          <BarChart data={byCompany}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="company" tick={{ fontSize: 12 }} />
            <YAxis /><Tooltip /><Legend />
            <Bar dataKey="operational" stackId="a" fill={PALETTE[2]} name="Operational" />
            <Bar dataKey="claimed" stackId="a" fill={PALETTE[3]} name="Claimed" />
            <Bar dataKey="nonExisting" stackId="a" fill={PALETTE[4]} name="Non-Existing" />
          </BarChart>
        </ChartWrap>
      </section>

      <Card>
        <CardHeader><CardTitle className="text-base">Department Gap Heatmap</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {deptHeat.length === 0 && <div className="text-sm text-muted-foreground">No department data yet.</div>}
            {deptHeat.map((d) => {
              const intensity = Math.min(1, d.pct);
              const bg = `oklch(${0.95 - intensity * 0.35} ${0.05 + intensity * 0.15} ${30 - intensity * 5})`;
              return (
                <div key={d.department} className="rounded-lg border p-3" style={{ backgroundColor: bg }}>
                  <div className="text-xs font-medium text-foreground/80">{d.department}</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{Math.round(d.pct * 100)}%</div>
                  <div className="text-xs text-muted-foreground">{d.gaps} gaps / {d.total} total</div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ChartWrap({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="h-72"><ResponsiveContainer>{children}</ResponsiveContainer></CardContent>
    </Card>
  );
}
