import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ValRowSchema = z.object({
  id: z.string().uuid().optional(),
  document_title: z.string().min(1),
  document_type: z.string().nullable().optional(),
  document_code: z.string().nullable().optional(),
  process_id: z.string().nullable().optional(),
  process_owner: z.string().nullable().optional(),
  company_name: z.string().nullable().optional(),
  process_exists: z.boolean(),
  if_no_status: z.string().nullable().optional(),
  evidence_exists: z.boolean().nullable().optional(),
  automated: z.boolean().nullable().optional(),
  evidence_reviewed: z.string().nullable().optional(),
  comments: z.string().nullable().optional(),
});
type ValRow = z.infer<typeof ValRowSchema>;

export const listValidations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("process_validations")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertValidation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ValRowSchema.parse(input))
  .handler(async ({ data, context }) => {
    const payload = { ...data, created_by: context.userId };
    const { data: row, error } = await context.supabase
      .from("process_validations")
      .upsert(payload as never)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const bulkImportValidations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ rows: z.array(ValRowSchema) }).parse(input))
  .handler(async ({ data, context }) => {
    const withOwner = data.rows.map((r: ValRow) => ({ ...r, created_by: context.userId }));
    const { error, count } = await context.supabase
      .from("process_validations")
      .insert(withOwner as never, { count: "exact" });
    if (error) throw new Error(error.message);
    return { inserted: count ?? withOwner.length };
  });

export const deleteValidation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("process_validations").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
