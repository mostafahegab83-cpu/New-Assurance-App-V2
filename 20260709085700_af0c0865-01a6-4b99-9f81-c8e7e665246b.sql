import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/gap-analysis/")({
  beforeLoad: () => { throw redirect({ to: "/gap-analysis/assessment" }); },
  component: () => null,
});
