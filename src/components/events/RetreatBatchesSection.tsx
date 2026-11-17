import { useMemo } from "react";
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Layers,
  Clock,
  AlertCircle,
  CheckCircle2,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@/components/ui/field";
import { BATCH_STATUS_CONFIG } from "@/constants/colors";
import {
  resolveActiveBatch,
  fromDateTimeLocalInput,
  toDateTimeLocalInput,
  formatBatchDateTime,
  formatBatchPriceLabel,
  type BatchCandidate,
  type BatchDraft,
  type BatchFieldErrors,
} from "@/lib/retreatBatches";

interface RetreatBatchesSectionProps {
  batches: BatchDraft[];
  onChange: (nextBatches: BatchDraft[]) => void;
  hasPayment: boolean;
  defaultPrice?: number;
  batchCounts?: Record<string, number>;
  fieldErrors?: Record<number, BatchFieldErrors>;
  validationErrors?: string[];
  disabled?: boolean;
}

function buildDefaultDraft(
  index: number,
  previousDraft: BatchDraft | undefined,
  hasPayment: boolean,
  defaultPrice: number
): BatchDraft {
  const now = new Date();
  let startDate: Date;

  if (previousDraft?.end_at) {
    const prevEnd = new Date(previousDraft.end_at);
    startDate = Number.isNaN(prevEnd.getTime())
      ? now
      : new Date(prevEnd.getTime() + 60 * 1000);
  } else {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  }

  const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  endDate.setHours(23, 59, 0, 0);

  return {
    name: `${index + 1}º Lote`,
    price: hasPayment ? defaultPrice : 0,
    start_at: toDateTimeLocalInput(startDate.toISOString()),
    end_at: toDateTimeLocalInput(endDate.toISOString()),
    max_spots: null,
    sort_order: index,
  };
}

export function RetreatBatchesSection({
  batches,
  onChange,
  hasPayment,
  defaultPrice = 0,
  batchCounts = {},
  fieldErrors = {},
  validationErrors = [],
  disabled = false,
}: RetreatBatchesSectionProps) {
  const previewResolution = useMemo(() => {
    const candidates: BatchCandidate[] = [];
    batches.forEach((b, idx) => {
      const startIso = fromDateTimeLocalInput(b.start_at);
      const endIso = fromDateTimeLocalInput(b.end_at);
      if (!startIso || !endIso) return;
      candidates.push({
        id: b.id || `draft-${idx}`,
        name: b.name.trim() || `${idx + 1}º Lote`,
        price: hasPayment ? Math.max(0, Number(b.price || 0)) : 0,
        start_at: startIso,
        end_at: endIso,
        max_spots:
          b.max_spots === null || b.max_spots === undefined || b.max_spots === ""
            ? null
            : Number(b.max_spots),
        sort_order: idx,
      });
    });
    return resolveActiveBatch(candidates, batchCounts, new Date());
  }, [batches, batchCounts, hasPayment]);

  const handleAddBatch = () => {
    const prev = batches[batches.length - 1];
    const nextDraft = buildDefaultDraft(batches.length, prev, hasPayment, defaultPrice);
    onChange([...batches, nextDraft]);
  };

  const handleUpdateField = (
    index: number,
    key: keyof BatchDraft,
    value: string | number | null
  ) => {
    const updated = batches.map((item, idx) =>
      idx === index ? { ...item, [key]: value } : item
    );
    onChange(updated);
  };

  const handleRemoveBatch = (index: number) => {
    const target = batches[index];
    const used = target?.id ? batchCounts[target.id] || 0 : 0;
    if (
      used > 0 &&
      !confirm(
        `O lote "${target.name}" já possui ${used} inscrição(ões) vinculada(s). Os valores históricos já registrados serão preservados, mas o vínculo com o lote será desfeito. Deseja remover este lote?`
      )
    ) {
      return;
    }
    const filtered = batches
      .filter((_, idx) => idx !== index)
      .map((item, idx) => ({ ...item, sort_order: idx }));
    onChange(filtered);
  };

  const handleMoveBatch = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= batches.length) return;
    const copy = [...batches];
    const [moved] = copy.splice(index, 1);
    copy.splice(targetIndex, 0, moved);
    onChange(copy.map((item, idx) => ({ ...item, sort_order: idx })));
  };

  return (
    <Card size="sm" className="border border-border bg-card">
      <CardHeader className="border-b border-border/60 pb-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-0.5">
            <CardTitle className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Layers className="size-4 text-primary shrink-0" />
              <span>Lotes de Inscrição</span>
              {batches.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {batches.length} {batches.length === 1 ? "lote" : "lotes"}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Configure janelas de datas, valores diferenciados e limite opcional de vagas por lote.
            </CardDescription>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={handleAddBatch}
            disabled={disabled}
            className="min-h-[44px] px-3 text-xs font-semibold shrink-0 self-start sm:self-auto"
          >
            <Plus data-icon="inline-start" />
            Adicionar Lote
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 pt-2">
        {batches.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-xs text-muted-foreground">
            Nenhum lote configurado. Este encontro utilizará o valor único e o prazo limite padrão do cadastro.
          </div>
        ) : (
          <>
            {validationErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>Revise as janelas dos lotes</AlertTitle>
                <AlertDescription>
                  <ul className="flex flex-col gap-1 list-disc pl-4">
                    {validationErrors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {validationErrors.length === 0 && previewResolution.hasBatches && (
              <Alert
                className={
                  previewResolution.activeBatch
                    ? BATCH_STATUS_CONFIG.active.alertClass
                    : previewResolution.nextBatch
                    ? BATCH_STATUS_CONFIG.upcoming.alertClass
                    : BATCH_STATUS_CONFIG.ended.alertClass
                }
              >
                {previewResolution.activeBatch ? <CheckCircle2 /> : <Clock />}
                <AlertTitle>
                  {previewResolution.activeBatch
                    ? `Lote ativo agora: ${previewResolution.activeBatch.name} (${formatBatchPriceLabel(previewResolution.activeBatch.price)})`
                    : previewResolution.nextBatch
                    ? `Fora de janela aberta — próximo: ${previewResolution.nextBatch.name}`
                    : previewResolution.status === "all_full"
                    ? "Todos os lotes atuais atingiram o limite de vagas"
                    : "Todos os lotes configurados já encerraram"}
                </AlertTitle>
                <AlertDescription className="text-current/90">
                  {previewResolution.activeBatch
                    ? `Vigência até ${formatBatchDateTime(previewResolution.activeBatch.end_at)}. Quando houver lotes configurados, as inscrições seguem a janela e o valor do lote ativo.`
                    : previewResolution.nextBatch
                    ? `Inscrições serão bloqueadas até ${formatBatchDateTime(previewResolution.nextBatch.start_at)} (${formatBatchPriceLabel(previewResolution.nextBatch.price)}).`
                    : "Novas inscrições ficam bloqueadas enquanto nenhum lote estiver aberto."}
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-col gap-3">
              {batches.map((batch, index) => {
                const errors = fieldErrors[index] || {};
                const batchId = batch.id || `draft-${index}`;
                const usedSpots = batch.id ? batchCounts[batch.id] || 0 : 0;
                const resolvedItem = previewResolution.batches.find(
                  (item) => item.batch.id === batchId
                );
                const stateKey = resolvedItem
                  ? resolvedItem.state === "full"
                    ? "full"
                    : resolvedItem.state
                  : "upcoming";
                const statusCfg = BATCH_STATUS_CONFIG[stateKey];

                return (
                  <Card
                    key={batchId}
                    size="sm"
                    className="border border-border/80 bg-muted/15"
                  >
                    <CardHeader className="border-b border-border/50 pb-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                          <span className="text-xs font-bold text-foreground">
                            #{index + 1}
                          </span>
                          <Badge variant="outline" className={statusCfg.badgeClass}>
                            {statusCfg.label}
                          </Badge>
                          {usedSpots > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                              <Users className="size-3.5" />
                              {usedSpots} {usedSpots === 1 ? "inscrito" : "inscritos"}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={disabled || index === 0}
                            onClick={() => handleMoveBatch(index, -1)}
                            className="min-h-[44px] min-w-[44px]"
                            aria-label={`Mover ${batch.name || `Lote ${index + 1}`} para cima`}
                          >
                            <ArrowUp />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={disabled || index === batches.length - 1}
                            onClick={() => handleMoveBatch(index, 1)}
                            className="min-h-[44px] min-w-[44px]"
                            aria-label={`Mover ${batch.name || `Lote ${index + 1}`} para baixo`}
                          >
                            <ArrowDown />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={disabled}
                            onClick={() => handleRemoveBatch(index)}
                            className="min-h-[44px] min-w-[44px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                            aria-label={`Remover ${batch.name || `Lote ${index + 1}`}`}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent className="pt-2">
                      <FieldGroup>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <Field data-invalid={!!errors.name || undefined}>
                            <FieldLabel htmlFor={`batch-name-${index}`}>
                              Nome do Lote *
                            </FieldLabel>
                            <Input
                              id={`batch-name-${index}`}
                              value={batch.name}
                              onChange={(e) =>
                                handleUpdateField(index, "name", e.target.value)
                              }
                              placeholder="Ex: 1º Lote / Promocional"
                              aria-invalid={!!errors.name || undefined}
                              disabled={disabled}
                              className="min-h-[44px] bg-background"
                            />
                            {errors.name && <FieldError>{errors.name}</FieldError>}
                          </Field>

                          <Field
                            data-invalid={!!errors.price || undefined}
                            data-disabled={!hasPayment || disabled || undefined}
                          >
                            <FieldLabel htmlFor={`batch-price-${index}`}>
                              Valor do Lote (R$) *
                            </FieldLabel>
                            <Input
                              id={`batch-price-${index}`}
                              type="number"
                              step="0.01"
                              min="0"
                              value={hasPayment ? batch.price : 0}
                              onChange={(e) =>
                                handleUpdateField(index, "price", e.target.value)
                              }
                              placeholder="Ex: 150.00"
                              aria-invalid={!!errors.price || undefined}
                              disabled={disabled || !hasPayment}
                              className="min-h-[44px] bg-background"
                            />
                            {!hasPayment && (
                              <FieldDescription>
                                Evento marcado como gratuito (R$ 0,00).
                              </FieldDescription>
                            )}
                            {errors.price && <FieldError>{errors.price}</FieldError>}
                          </Field>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <Field data-invalid={!!errors.start_at || undefined}>
                            <FieldLabel htmlFor={`batch-start-${index}`}>
                              Início da Vigência *
                            </FieldLabel>
                            <Input
                              id={`batch-start-${index}`}
                              type="datetime-local"
                              value={batch.start_at}
                              onChange={(e) =>
                                handleUpdateField(index, "start_at", e.target.value)
                              }
                              aria-invalid={!!errors.start_at || undefined}
                              disabled={disabled}
                              className="min-h-[44px] bg-background"
                            />
                            {errors.start_at && (
                              <FieldError>{errors.start_at}</FieldError>
                            )}
                          </Field>

                          <Field data-invalid={!!errors.end_at || undefined}>
                            <FieldLabel htmlFor={`batch-end-${index}`}>
                              Término da Vigência *
                            </FieldLabel>
                            <Input
                              id={`batch-end-${index}`}
                              type="datetime-local"
                              value={batch.end_at}
                              onChange={(e) =>
                                handleUpdateField(index, "end_at", e.target.value)
                              }
                              aria-invalid={!!errors.end_at || undefined}
                              disabled={disabled}
                              className="min-h-[44px] bg-background"
                            />
                            {errors.end_at && <FieldError>{errors.end_at}</FieldError>}
                          </Field>
                        </div>

                        <Field data-invalid={!!errors.max_spots || undefined}>
                          <FieldLabel htmlFor={`batch-spots-${index}`}>
                            Limite de Vagas do Lote (Opcional)
                          </FieldLabel>
                          <Input
                            id={`batch-spots-${index}`}
                            type="number"
                            min="1"
                            step="1"
                            value={
                              batch.max_spots === null || batch.max_spots === undefined
                                ? ""
                                : batch.max_spots
                            }
                            onChange={(e) =>
                              handleUpdateField(
                                index,
                                "max_spots",
                                e.target.value === "" ? null : e.target.value
                              )
                            }
                            placeholder="Ilimitado (usa capacidade geral do encontro)"
                            aria-invalid={!!errors.max_spots || undefined}
                            disabled={disabled}
                            className="min-h-[44px] bg-background"
                          />
                          <FieldDescription>
                            Opcional. Ao atingir este limite de inscritos ativos, este lote é fechado automaticamente.
                          </FieldDescription>
                          {errors.max_spots && (
                            <FieldError>{errors.max_spots}</FieldError>
                          )}
                        </Field>
                      </FieldGroup>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={handleAddBatch}
              disabled={disabled}
              className="min-h-[44px] w-full text-xs font-semibold"
            >
              <Plus data-icon="inline-start" />
              Adicionar Outro Lote
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
