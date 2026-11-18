import supabase from "@/lib/supabase";
import { parseEndOfDay } from "@/lib/dateUtils";

export interface SyncExpiredRetreatsResult {
  closedCount: number;
  usedFallback: boolean;
}

/**
 * Verifica se a data de término do retiro já passou (após 23:59:59.999 do dia de end_date).
 */
export function isRetreatExpiredByDate(
  endDate?: string | null,
  referenceDate: Date = new Date()
): boolean {
  if (!endDate) return false;
  const endOfDay = parseEndOfDay(endDate);
  if (Number.isNaN(endOfDay.getTime())) return false;
  return referenceDate.getTime() > endOfDay.getTime();
}

/**
 * Indica se um retiro está encerrado e sua data de término já passou.
 */
export function isRetreatAutoClosed(
  status?: string | null,
  endDate?: string | null
): boolean {
  return status === "encerrado" && isRetreatExpiredByDate(endDate);
}

/**
 * Calcula o status efetivo no cliente como fallback caso a RPC não esteja disponível.
 * Apenas retiros com status "ativo" e end_date no passado são tratados como "encerrado".
 */
export function getEffectiveRetreatStatus(
  status?: string | null,
  endDate?: string | null
): string {
  const normalized = status || "ativo";
  if (normalized === "ativo" && isRetreatExpiredByDate(endDate)) {
    return "encerrado";
  }
  return normalized;
}

/**
 * Invoca a RPC close_expired_retreats() no Supabase para transicionar retiros ativos
 * cuja data de término já passou em America/Sao_Paulo para "encerrado".
 * Caso a RPC falhe ou esteja indisponível, retorna usedFallback=true sem lançar exceção.
 */
export async function syncExpiredRetreats(): Promise<SyncExpiredRetreatsResult> {
  try {
    const { data, error } = await supabase.rpc("close_expired_retreats");
    if (error) {
      console.warn(
        "Falha ao sincronizar retiros expirados via RPC (usando fallback cliente):",
        error.message
      );
      return { closedCount: 0, usedFallback: true };
    }
    return {
      closedCount: typeof data === "number" ? data : 0,
      usedFallback: false,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    console.warn(
      "Exceção ao sincronizar retiros expirados via RPC (usando fallback cliente):",
      msg
    );
    return { closedCount: 0, usedFallback: true };
  }
}
