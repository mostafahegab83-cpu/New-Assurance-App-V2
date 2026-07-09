import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { LayoutDashboard, ClipboardList, ClipboardCheck, LogOut, GitCompareArrows } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/gap-analysis/assessment", label: "Gap Assessment", icon: ClipboardList },
  { to: "/gap-analysis/validation", label: "Process Validation", icon: ClipboardCheck },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [email, setEmail] = useState<string>("");
  const [roles, setRoles] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      setEmail(data.user.email ?? "");
      const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
      setRoles((roleRows ?? []).map((r) => r.role));
    })();
  }, []);

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="flex min-h-screen bg-secondary/30">
      <aside className="hidden w-64 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-6">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground font-bold">GA</div>
          <span className="font-semibold tracking-tight">Gap Analysis</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          <div className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-sidebar-foreground/60">
            <GitCompareArrows className="inline h-3 w-3 mr-1" /> Modules
          </div>
          {nav.map((n) => {
            const active = pathname === n.to || (n.to !== "/dashboard" && pathname.startsWith(n.to));
            return (
              <Link key={n.to} to={n.to} className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/50"
              )}>
                <n.icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-3 text-xs text-sidebar-foreground/60">
          v1.0 · Process Assurance
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b bg-card px-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {roles.map((r) => (
              <Badge key={r} variant={r === "admin" ? "default" : "secondary"} className="capitalize">{r.replace("_", " ")}</Badge>
            ))}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2">
                <Avatar className="h-7 w-7"><AvatarFallback>{email.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                <span className="hidden sm:inline text-sm">{email}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut}><LogOut className="mr-2 h-4 w-4" /> Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
