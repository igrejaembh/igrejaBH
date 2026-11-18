import { useState, useEffect, useMemo } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Save, Layers, Users, Calendar } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { BATCH_STATUS_CONFIG } from "@/constants/colors";
import {
  resolveActiveBatch,
  formatBatchWindow,
  formatBatchPriceLabel,
  toDateTimeLocalInput,
  validateBatchWindows,
  retreatBatchesFormSchema,
  type RetreatBatchesFormValues,
  type BatchDraft,
  type BatchFieldErrors,
  type RetreatBatch,
} from "@/lib/retreatBatches";
import { syncRetreatBatches } from "@/lib/retreatBatchesSync";
import { RetreatBatchesSection } from "@/components/events/RetreatBatchesSection";
import type { Database } from "@/lib/database.types";

type Retreat = Database["public"]["Tables"]["retreats"]["Row"];

interface RetreatBatchesTabProps {
  retreat: Retreat;
  batches: RetreatBatch[];
  batchCounts: Record<string, number>;
  onBatchesUpdated: (updated: RetreatBatch[]) => void;
}

export function RetreatBatchesTab({
  retreat,
  batches,
  batchCounts,
  onBatchesUpdated,
}: RetreatBatchesTabProps) {
  const hasPayment = retreat.has_payment ?? (retreat.price || 0) > 0;
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<number, BatchFieldErrors>>({});
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const { handleSubmit, reset, setValue, watch } = useForm<RetreatBatchesFormValues>({
    resolver: zodResolver(retreatBatchesFormSchema) as Resolver<RetreatBatchesFormValues>,
    defaultValues: {
      batches: [],
    },
  });

  const drafts = watch("batches");

  useEffect(() => {
    reset({
      batches: batches.map((b, idx) => ({
        id: b.id,
        name: b.name,
        price: Number(b.price),
        start_at: toDateTimeLocalInput(b.start_at),
        end_at: toDateTimeLocalInput(b.end_at),
        max_spots: b.max_spots,
        sort_order: b.sort_order ?? idx,
      })),
    });
    setFieldErrors({});
    setValidationErrors([]);
  }, [batches, reset]);

  const savedResolution = useMemo(
    () => resolveActiveBatch(batches, batchCounts, new Date()),
    [batches, batchCounts]
  );

  const isDirty = useMemo(() => {
    if (drafts.length !== batches.length) return true;
    return drafts.some((d, idx) => {
      const orig = batches[idx];
      if (!orig) return true;
      const origStart = toDateTimeLocalInput(orig.start_at);
      const origEnd = toDateTimeLocalInput(orig.end_at);
      const draftPrice = hasPayment ? Number(d.price || 0) : 0;
      const draftSpots =
        d.max_spots === null || d.max_spots === undefined || d.max_spots === ""
          ? null
          : Number(d.max_spots);
      return (
        d.id !== orig.id ||
        d.name.trim() !== orig.name.trim() ||
        draftPrice !== Number(orig.price) ||
        d.start_at !== origStart ||
        d.end_at !== origEnd ||
        draftSpots !== orig.max_spots
      );
    });
  }, [drafts, batches, hasPayment]);

  const handleDraftsChange = (next: BatchDraft[]) => {
    setValue("batches", next, { shouldDirty: true });
    if (validationErrors.length > 0 || Object.keys(fieldErrors).length > 0) {
      const normalized = next.map((b) => ({
        ...b,
        price: hasPayment ? b.price : 0,
      }));
      const res = validateBatchWindows(normalized);
      setFieldErrors(res.fieldErrors);
      setValidationErrors(res.errors);
    }
  };

  const onSaveForm = async (values: RetreatBatchesFormValues) => {
    const normalized = values.batches.map((b) => ({
      ...b,
      price: hasPayment ? b.price : 0,
    }));
    const res = validateBatchWindows(normalized);
    if (!res.valid) {
      setFieldErrors(res.fieldErrors);
      setValidationErrors(res.errors);
      toast.error("Corrija os erros nas janelas ou valores dos lotes antes de salvar.");
      return;
    }

    setFieldErrors({});
    setValidationErrors([]);
    setSaving(true);
    try {
      const refreshed = await syncRetreatBatches(
        retreat.id,
        values.batches,
        batches,
        hasPayment
      );
      onBatchesUpdated(refreshed);
      toast.success("Lotes de inscrição atualizados com sucesso!");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao salvar lotes.";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleInvalidSubmit = () => {
    const normalized = drafts.map((b) => ({
      ...b,
      price: hasPayment ? b.price : 0,
    }));
    const res = validateBatchWindows(normalized);
    setFieldErrors(res.fieldErrors);
    setValidationErrors(res.errors);
    toast.error("Corrija os erros nas janelas ou valores dos lotes antes de salvar.");
  };

  return (
    <form
      onSubmit={handleSubmit(onSaveForm, handleInvalidSubmit)}
      className="flex flex-col gap-6"
    >
      {savedResolution.hasBatches && (
        <Card className="border border-border bg-card">
          <CardHeader className="border-b border-border/60 pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-bold">
              <Layers className="size-4 text-primary" />
              Resumo de Ocupação dos Lotes
            </CardTitle>
            <CardDescription>
              Acompanhamento em tempo real das inscrições ativas em cada lote configurado.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2 lg:grid-cols-3">
            {savedResolution.batches.map((item) => {
              const cfgKey = item.state === "full" ? "full" : item.state;
              const cfg = BATCH_STATUS_CONFIG[cfgKey];
              const maxSpots = item.batch.max_spots;
              const pct = maxSpots
                ? Math.min(100, Math.round((item.usedSpots / maxSpots) * 100))
                : 0;

              return (
                <div
                  key={item.batch.id}
                  className="flex flex-col justify-between gap-3 rounded-lg border border-border bg-muted/20 p-4"
                >
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-bold text-foreground leading-snug">
                        {item.batch.name}
                      </span>
                      <Badge variant="outline" className={cfg.badgeClass}>
                        {cfg.label}
                      </Badge>
                    </div>

                    <div className="text-lg font-extrabold text-foreground">
                      {hasPayment
                        ? formatBatchPriceLabel(item.batch.price)
                        : "Gratuito"}
                    </div>

                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Calendar className="size-3.5 shrink-0" />
                      <span>{formatBatchWindow(item.batch.start_at, item.batch.end_at)}</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5 border-t border-border/50 pt-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1 text-muted-foreground font-medium">
                        <Users className="size-3.5" />
                        Inscritos
                      </span>
                      <span className="font-bold text-foreground">
                        {maxSpots
                          ? `${item.usedSpots} / ${maxSpots}`
                          : `${item.usedSpots} (sem limite)`}
                      </span>
                    </div>
                    {maxSpots && <Progress value={pct} className="h-2" />}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <RetreatBatchesSection
        batches={drafts}
        onChange={handleDraftsChange}
        hasPayment={hasPayment}
        defaultPrice={Number(retreat.price || 0)}
        batchCounts={batchCounts}
        fieldErrors={fieldErrors}
        validationErrors={validationErrors}
        disabled={saving}
      />

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Button
          type="submit"
          disabled={saving || !isDirty}
          className="min-h-[44px] px-5 text-xs font-bold"
        >
          {saving ? (
            <>
              <Spinner data-icon="inline-start" />
              Salvando Lotes...
            </>
          ) : (
            <>
              <Save data-icon="inline-start" />
              Salvar Alterações nos Lotes
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
