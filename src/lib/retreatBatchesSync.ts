import supabase from "@/lib/supabase";
import {
  fromDateTimeLocalInput,
  type BatchDraft,
  type RetreatBatch,
} from "@/lib/retreatBatches";

/**
 * Sincroniza rascunhos de lotes com a tabela `retreat_batches` preservando IDs existentes
 * para manter intactos os vínculos `registrations.batch_id`.
 */
export async function syncRetreatBatches(
  retreatId: string,
  drafts: readonly BatchDraft[],
  existingBatches: readonly RetreatBatch[],
  hasPayment: boolean
): Promise<RetreatBatch[]> {
  const existingIds = new Set(existingBatches.map((b) => b.id));
  const keptIds = new Set(
    drafts.map((d) => d.id).filter((id): id is string => Boolean(id && existingIds.has(id)))
  );

  const idsToDelete = existingBatches
    .map((b) => b.id)
    .filter((id) => !keptIds.has(id));

  if (idsToDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from("retreat_batches")
      .delete()
      .in("id", idsToDelete);
    if (deleteError) throw deleteError;
  }

  for (let index = 0; index < drafts.length; index++) {
    const draft = drafts[index];
    const normalizedPrice = hasPayment ? Math.max(0, Number(draft.price || 0)) : 0;
    const normalizedSpots =
      draft.max_spots === null || draft.max_spots === undefined || draft.max_spots === ""
        ? null
        : Number(draft.max_spots);

    const payload = {
      retreat_id: retreatId,
      name: draft.name.trim(),
      price: Math.round(normalizedPrice * 100) / 100,
      start_at: fromDateTimeLocalInput(draft.start_at) || new Date(draft.start_at).toISOString(),
      end_at: fromDateTimeLocalInput(draft.end_at) || new Date(draft.end_at).toISOString(),
      max_spots: normalizedSpots,
      sort_order: index,
    };

    if (draft.id && existingIds.has(draft.id)) {
      const { error: updateError } = await supabase
        .from("retreat_batches")
        .update({
          name: payload.name,
          price: payload.price,
          start_at: payload.start_at,
          end_at: payload.end_at,
          max_spots: payload.max_spots,
          sort_order: payload.sort_order,
        })
        .eq("id", draft.id);
      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await supabase
        .from("retreat_batches")
        .insert([payload]);
      if (insertError) throw insertError;
    }
  }

  const { data: refreshed, error: fetchError } = await supabase
    .from("retreat_batches")
    .select("*")
    .eq("retreat_id", retreatId)
    .order("sort_order", { ascending: true })
    .order("start_at", { ascending: true });

  if (fetchError) throw fetchError;
  return refreshed || [];
}
