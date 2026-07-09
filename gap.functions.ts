import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface Props {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  tone?: "default" | "success" | "warning" | "destructive" | "info" | "accent";
}

const toneStyles: Record<NonNullable<Props["tone"]>, string> = {
  default: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/15 text-warning-foreground",
  destructive: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
  accent: "bg-accent/15 text-accent-foreground",
};

export function KPICard({ label, value, hint, icon: Icon, tone = "default" }: Props) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        {Icon && (
          <div className={cn("grid h-11 w-11 place-items-center rounded-lg", toneStyles[tone])}>
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
          {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
