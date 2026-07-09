import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const GapRowSchema = z.object({
  id: z.string().uuid().optional(),
  process_id: z.string().nullable().optional(),
  process_name: z.string().min(1),
  process_description: z.string().nullable().optional(),
  best_practice_requirement: z.string().nullable().optional(),
  existing_in_idh: z.boolean().nullable().optional(),
  related_policy_sop: z.string().nullable().optional(),
  gap_identified: z.boolean().nullable().optional(),
  department: z.string().nullable().optional(),
  comments: z.string().nullable().optional(),
});
type GapRow = z.infer<typeof GapRowSchema>;

export const listGaps = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("gap_assessments")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertGap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => GapRowSchema.parse(input))
  .handler(async ({ data, context }) => {
    const payload = { ...data, created_by: context.userId };
    const { data: row, error } = await context.supabase
      .from("gap_assessments")
      .upsert(payload as never)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const bulkImportGaps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ rows: z.array(GapRowSchema) }).parse(input))
  .handler(async ({ data, context }) => {
    const withOwner = data.rows.map((r: GapRow) => ({ ...r, created_by: context.userId }));
    const { error, count } = await context.supabase
      .from("gap_assessments")
      .insert(withOwner as never, { count: "exact" });
    if (error) throw new Error(error.message);
    return { inserted: count ?? withOwner.length };
  });

export const deleteGap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("gap_assessments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
