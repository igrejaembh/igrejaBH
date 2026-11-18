import * as z from "zod";
import type { Database } from "@/lib/database.types";

export type RetreatBatch = Database["public"]["Tables"]["retreat_batches"]["Row"];
export type RetreatBatchInsert = Database["public"]["Tables"]["retreat_batches"]["Insert"];
export type RetreatBatchUpdate = Database["public"]["Tables"]["retreat_batches"]["Update"];

export interface BatchCandidate {
  id: string;
  retreat_id?: string;
  name: string;
  price: number;
  start_at: string;
  end_at: string;
  max_spots: number | null;
  sort_order: number;
  created_at?: string | null;
}

export type BatchItemState = "active" | "upcoming" | "full" | "ended";

export interface BatchWithAvailability<T extends BatchCandidate = BatchCandidate> {
  batch: T;
  usedSpots: number;
  remainingSpots: number | null;
  isFull: boolean;
  isWithinWindow: boolean;
  isUpcoming: boolean;
  isExpired: boolean;
  state: BatchItemState;
}

export type BatchResolutionStatus =
  | "no_batches"
  | "active"
  | "upcoming"
  | "between"
  | "all_full"
  | "ended";

export interface BatchResolutionResult<T extends BatchCandidate = BatchCandidate> {
  hasBatches: boolean;
  status: BatchResolutionStatus;
  isRegistrationOpen: boolean;
  activeBatch: T | null;
  activeBatchInfo: BatchWithAvailability<T> | null;
  nextBatch: T | null;
  nextBatchInfo: BatchWithAvailability<T> | null;
  batches: BatchWithAvailability<T>[];
  totalBatchSpotsUsed: number;
}

export interface BatchDraft {
  id?: string;
  name: string;
  price: number | string;
  start_at: string;
  end_at: string;
  max_spots?: number | string | null;
  sort_order?: number;
}

export interface BatchFieldErrors {
  name?: string;
  price?: string;
  start_at?: string;
  end_at?: string;
  max_spots?: string;
}

export interface BatchValidationResult {
  valid: boolean;
  errors: string[];
  fieldErrors: Record<number, BatchFieldErrors>;
}

/**
 * Ordena lotes de forma determinística por sort_order ASC e depois por start_at ASC.
 */
export function sortBatches<T extends Pick<BatchCandidate, "sort_order" | "start_at" | "created_at">>(
  batches: readonly T[]
): T[] {
  return [...batches].sort((a, b) => {
    const orderDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (orderDiff !== 0) return orderDiff;

    const startA = new Date(a.start_at).getTime();
    const startB = new Date(b.start_at).getTime();
    if (!Number.isNaN(startA) && !Number.isNaN(startB) && startA !== startB) {
      return startA - startB;
    }

    const createdA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const createdB = b.created_at ? new Date(b.created_at).getTime() : 0;
    return createdA - createdB;
  });
}

/**
 * Conta inscrições ativas ('confirmado' e 'presente') agrupadas por batch_id.
 * Inscrições com status 'cancelado' não consomem vagas do lote.
 */
export function getBatchRegistrationCounts(
  registrations: ReadonlyArray<{ batch_id?: string | null; status?: string | null }>
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const reg of registrations) {
    if (!reg.batch_id) continue;
    const status = reg.status || "confirmado";
    if (status === "cancelado") continue;
    counts[reg.batch_id] = (counts[reg.batch_id] || 0) + 1;
  }
  return counts;
}

/**
 * Converte linhas retornadas pela RPC get_retreat_batch_counts em mapa por batch_id.
 */
export function buildBatchCountsMapFromRpcRows(
  rows: ReadonlyArray<{ retreat_id?: string | null; batch_id?: string | null; active_count?: number | string | null }>
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (!row.batch_id) continue;
    counts[row.batch_id] = Number(row.active_count || 0);
  }
  return counts;
}

/**
 * Resolve qual lote está ativo no instante `now` e fornece diagnóstico completo
 * para estados de janela fechada (antes do 1º lote, intervalo entre lotes, esgotado ou encerrado).
 */
export function resolveActiveBatch<T extends BatchCandidate>(
  batches: readonly T[],
  batchCounts: Record<string, number> = {},
  now: Date = new Date()
): BatchResolutionResult<T> {
  if (!batches || batches.length === 0) {
    return {
      hasBatches: false,
      status: "no_batches",
      isRegistrationOpen: true,
      activeBatch: null,
      activeBatchInfo: null,
      nextBatch: null,
      nextBatchInfo: null,
      batches: [],
      totalBatchSpotsUsed: 0,
    };
  }

  const nowMs = now.getTime();
  const sorted = sortBatches(batches);
  let totalBatchSpotsUsed = 0;

  const enriched: BatchWithAvailability<T>[] = sorted.map((batch) => {
    const startMs = new Date(batch.start_at).getTime();
    const endMs = new Date(batch.end_at).getTime();
    const usedSpots = Math.max(0, batchCounts[batch.id] || 0);
    totalBatchSpotsUsed += usedSpots;

    const hasCap = batch.max_spots !== null && batch.max_spots !== undefined;
    const remainingSpots = hasCap ? Math.max(0, Number(batch.max_spots) - usedSpots) : null;
    const isFull = hasCap && usedSpots >= Number(batch.max_spots);

    const isWithinWindow =
      !Number.isNaN(startMs) && !Number.isNaN(endMs) && nowMs >= startMs && nowMs <= endMs;
    const isUpcoming = !Number.isNaN(startMs) && nowMs < startMs;
    const isExpired = !Number.isNaN(endMs) && nowMs > endMs;

    let state: BatchItemState;
    if (isWithinWindow && !isFull) {
      state = "active";
    } else if (isFull && !isExpired) {
      state = "full";
    } else if (isUpcoming) {
      state = "upcoming";
    } else {
      state = "ended";
    }

    return {
      batch,
      usedSpots,
      remainingSpots,
      isFull,
      isWithinWindow,
      isUpcoming,
      isExpired,
      state,
    };
  });

  const activeBatchInfo = enriched.find((item) => item.isWithinWindow && !item.isFull) ?? null;

  const upcomingCandidates = [...enriched]
    .filter((item) => item.isUpcoming && !item.isFull)
    .sort((a, b) => {
      const startDiff =
        new Date(a.batch.start_at).getTime() - new Date(b.batch.start_at).getTime();
      if (startDiff !== 0) return startDiff;
      return (a.batch.sort_order ?? 0) - (b.batch.sort_order ?? 0);
    });

  const nextBatchInfo = upcomingCandidates[0] ?? null;

  if (activeBatchInfo) {
    return {
      hasBatches: true,
      status: "active",
      isRegistrationOpen: true,
      activeBatch: activeBatchInfo.batch,
      activeBatchInfo,
      nextBatch: nextBatchInfo ? nextBatchInfo.batch : null,
      nextBatchInfo,
      batches: enriched,
      totalBatchSpotsUsed,
    };
  }

  let status: BatchResolutionStatus;
  if (nextBatchInfo) {
    const hasStartedOrPastBatch = enriched.some((item) => !item.isUpcoming);
    status = hasStartedOrPastBatch ? "between" : "upcoming";
  } else if (enriched.some((item) => item.isWithinWindow && item.isFull)) {
    status = "all_full";
  } else if (enriched.every((item) => item.isExpired)) {
    status = "ended";
  } else {
    status = "all_full";
  }

  return {
    hasBatches: true,
    status,
    isRegistrationOpen: false,
    activeBatch: null,
    activeBatchInfo: null,
    nextBatch: nextBatchInfo ? nextBatchInfo.batch : null,
    nextBatchInfo,
    batches: enriched,
    totalBatchSpotsUsed,
  };
}

/**
 * Formata um valor monetário em Real Brasileiro (R$).
 */
export function formatCurrencyBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(value) ? value : 0);
}

/**
 * Formata o preço do lote exibindo "Gratuito" quando igual a zero.
 */
export function formatBatchPriceLabel(price: number): string {
  const numeric = Number(price || 0);
  return numeric <= 0 ? "Gratuito" : formatCurrencyBRL(numeric);
}

/**
 * Formata uma data/hora ISO (timestamptz) no fuso local brasileiro (DD/MM/AAAA às HH:MM)
 * usando o mesmo objeto Date para evitar deslocamento de dia perto da meia-noite UTC.
 */
export function formatBatchDateTime(isoStr?: string | null): string {
  if (!isoStr) return "";
  const parsed = new Date(isoStr);
  if (Number.isNaN(parsed.getTime())) return "";
  const datePart = parsed.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const timePart = parsed.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${datePart} às ${timePart}`;
}

/**
 * Formata a janela de vigência completa de um lote em português.
 */
export function formatBatchWindow(startAt: string, endAt: string): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "Período inválido";
  }

  const startDate = start.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const startTime = start.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const endDate = end.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const endTime = end.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (startDate === endDate) {
    return `${startDate}, ${startTime} às ${endTime}`;
  }
  return `${startDate} ${startTime} até ${endDate} ${endTime}`;
}

/**
 * Retorna texto legível de contagem regressiva até a abertura de um próximo lote.
 */
export function formatCountdownToBatchOpen(startAt: string, now: Date = new Date()): string {
  const targetMs = new Date(startAt).getTime();
  if (Number.isNaN(targetMs)) return "";
  const diffMs = targetMs - now.getTime();
  if (diffMs <= 0) return "Abre agora";

  const totalMinutes = Math.ceil(diffMs / 60000);
  if (totalMinutes < 60) {
    return totalMinutes <= 1
      ? "Abre em menos de 1 minuto"
      : `Abre em ${totalMinutes} minutos`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    const remMinutes = totalMinutes % 60;
    const hourText = totalHours === 1 ? "1 hora" : `${totalHours} horas`;
    return remMinutes > 0 ? `Abre em ${hourText} e ${remMinutes} min` : `Abre em ${hourText}`;
  }

  const totalDays = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  const dayText = totalDays === 1 ? "1 dia" : `${totalDays} dias`;
  return remHours > 0 ? `Abre em ${dayText} e ${remHours}h` : `Abre em ${dayText}`;
}

/**
 * Converte ISO timestamptz para valor compatível com <input type="datetime-local"> no fuso local.
 */
export function toDateTimeLocalInput(isoStr?: string | null): string {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Converte valor de <input type="datetime-local"> (horário local) para string ISO UTC.
 */
export function fromDateTimeLocalInput(localStr: string): string {
  if (!localStr) return "";
  const d = new Date(localStr);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

export const retreatBatchDraftSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Informe o nome do lote (ex: 1º Lote)."),
  price: z.union([z.number(), z.string()]),
  start_at: z.string().min(1, "Informe a data e hora de início."),
  end_at: z.string().min(1, "Informe a data e hora de término."),
  max_spots: z.union([z.number(), z.string(), z.null()]).optional(),
  sort_order: z.number().optional(),
});

export const retreatBatchesFormSchema = z
  .object({
    batches: z.array(retreatBatchDraftSchema),
  })
  .superRefine((data, ctx) => {
    const res = validateBatchWindows(data.batches);
    if (!res.valid) {
      res.errors.forEach((message) => {
        ctx.addIssue({
          code: "custom",
          message,
          path: ["batches"],
        });
      });
    }
  });

export type RetreatBatchesFormValues = z.infer<typeof retreatBatchesFormSchema>;

/**
 * Valida campos individuais, limites de vagas e sobreposição de janelas entre lotes.
 */
export function validateBatchWindows(batches: readonly BatchDraft[]): BatchValidationResult {
  const errors: string[] = [];
  const fieldErrors: Record<number, BatchFieldErrors> = {};

  const setFieldError = (index: number, key: keyof BatchFieldErrors, msg: string) => {
    if (!fieldErrors[index]) fieldErrors[index] = {};
    if (!fieldErrors[index][key]) {
      fieldErrors[index][key] = msg;
    }
  };

  interface ParsedEntry {
    index: number;
    name: string;
    startMs: number;
    endMs: number;
  }

  const validWindows: ParsedEntry[] = [];

  batches.forEach((batch, index) => {
    const label = batch.name.trim() || `Lote ${index + 1}`;
    if (!batch.name.trim()) {
      const msg = "Informe o nome do lote (ex: 1º Lote).";
      setFieldError(index, "name", msg);
      errors.push(`${label}: ${msg}`);
    }

    const priceNum = Number(batch.price);
    if (batch.price === "" || Number.isNaN(priceNum) || priceNum < 0) {
      const msg = "Informe um valor igual ou maior que zero.";
      setFieldError(index, "price", msg);
      errors.push(`${label}: ${msg}`);
    }

    if (batch.max_spots !== null && batch.max_spots !== undefined && batch.max_spots !== "") {
      const spotsNum = Number(batch.max_spots);
      if (!Number.isInteger(spotsNum) || spotsNum <= 0) {
        const msg = "O limite de vagas deve ser um número inteiro maior que zero.";
        setFieldError(index, "max_spots", msg);
        errors.push(`${label}: ${msg}`);
      }
    }

    const startMs = batch.start_at ? new Date(batch.start_at).getTime() : NaN;
    const endMs = batch.end_at ? new Date(batch.end_at).getTime() : NaN;

    if (Number.isNaN(startMs)) {
      const msg = "Informe a data e hora de início.";
      setFieldError(index, "start_at", msg);
      errors.push(`${label}: ${msg}`);
    }
    if (Number.isNaN(endMs)) {
      const msg = "Informe a data e hora de término.";
      setFieldError(index, "end_at", msg);
      errors.push(`${label}: ${msg}`);
    }

    if (!Number.isNaN(startMs) && !Number.isNaN(endMs)) {
      if (endMs <= startMs) {
        const msg = "A data/hora de término deve ser posterior ao início.";
        setFieldError(index, "end_at", msg);
        errors.push(`${label}: ${msg}`);
      } else {
        validWindows.push({
          index,
          name: label,
          startMs,
          endMs,
        });
      }
    }
  });

  // Verificar sobreposição de janelas entre quaisquer dois lotes válidos
  const sortedByStart = [...validWindows].sort((a, b) => a.startMs - b.startMs);
  for (let i = 0; i < sortedByStart.length; i++) {
    for (let j = i + 1; j < sortedByStart.length; j++) {
      const a = sortedByStart[i];
      const b = sortedByStart[j];
      if (b.startMs < a.endMs && a.startMs < b.endMs) {
        const msg = `A janela do lote "${b.name}" sobrepõe a do lote "${a.name}".`;
        errors.push(msg);
        setFieldError(a.index, "end_at", `Conflito de horário com "${b.name}".`);
        setFieldError(b.index, "start_at", `Conflito de horário com "${a.name}".`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    fieldErrors,
  };
}
