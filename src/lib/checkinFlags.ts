import type { Json } from "@/lib/database.types";

export interface CheckinChecklistItem {
  key: string;
  label: string;
}

export type CheckinFlagsMap = Record<string, boolean>;

export const DEFAULT_CHECKIN_CHECKLIST: CheckinChecklistItem[] = [
  { key: "camisa_entregue", label: "Camisa entregue" },
  { key: "pagou_dinheiro", label: "Pagou em dinheiro" },
  { key: "cracha_entregue", label: "Crachá entregue" },
];

export const CHECKIN_CHECKLIST_PRESETS: CheckinChecklistItem[] = [
  { key: "camisa_entregue", label: "Camisa entregue" },
  { key: "pagou_dinheiro", label: "Pagou em dinheiro" },
  { key: "cracha_entregue", label: "Crachá entregue" },
  { key: "termo_assinado", label: "Termo assinado" },
  { key: "chave_quarto", label: "Chave do quarto entregue" },
  { key: "kit_boas_vindas", label: "Kit / material entregue" },
  { key: "pulseira_identificacao", label: "Pulseira entregue" },
  { key: "autorizacao_menor", label: "Autorização de menor conferida" },
];

/**
 * Converte o campo JSONB `retreats.checkin_checklist_config` para uma lista tipada.
 */
export function parseChecklistConfig(
  raw: Json | null | undefined
): CheckinChecklistItem[] {
  if (raw === null || raw === undefined) {
    return DEFAULT_CHECKIN_CHECKLIST;
  }
  if (!Array.isArray(raw)) {
    return DEFAULT_CHECKIN_CHECKLIST;
  }

  const parsed: CheckinChecklistItem[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      typeof item.key === "string" &&
      typeof item.label === "string"
    ) {
      const key = item.key.trim();
      const label = item.label.trim();
      if (key && label && !seen.has(key)) {
        seen.add(key);
        parsed.push({ key, label });
      }
    }
  }

  return parsed;
}

/**
 * Converte o campo JSONB `registrations.checkin_flags` em mapa booleano seguro.
 */
export function parseCheckinFlags(
  raw: Json | null | undefined
): CheckinFlagsMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const result: CheckinFlagsMap = {};
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val === "boolean") {
      result[key] = val;
    } else if (val === "true" || val === 1) {
      result[key] = true;
    }
  }
  return result;
}

/**
 * Gera uma chave snake_case única a partir de um rótulo digitado pelo usuário.
 */
export function slugifyChecklistKey(
  label: string,
  existingKeys: string[]
): string {
  const base = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "item";

  const used = new Set(existingKeys);
  if (!used.has(base)) return base;

  let suffix = 2;
  while (used.has(`${base}_${suffix}`)) {
    suffix += 1;
  }
  return `${base}_${suffix}`;
}

/**
 * Extrai o token hexadecimal de QR Code a partir de leitura bruta (texto, URL ou JSON).
 */
export function extractQrToken(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { qr_token?: unknown; token?: unknown };
      if (typeof parsed.qr_token === "string" && parsed.qr_token.trim()) {
        return parsed.qr_token.trim().toLowerCase();
      }
      if (typeof parsed.token === "string" && parsed.token.trim()) {
        return parsed.token.trim().toLowerCase();
      }
    } catch {
      // Ignora JSON inválido e continua extração textual
    }
  }

  if (trimmed.includes("?") || trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const url = new URL(trimmed.startsWith("http") ? trimmed : `https://local.test/${trimmed.replace(/^\/+/, "")}`);
      const qToken = url.searchParams.get("qr_token") || url.searchParams.get("qr") || url.searchParams.get("token");
      if (qToken && qToken.trim()) {
        return qToken.trim().toLowerCase();
      }
    } catch {
      // Segue para fallback textual
    }
  }

  if (trimmed.toUpperCase().startsWith("IBH:REG:")) {
    return trimmed.slice(8).trim().toLowerCase();
  }

  return trimmed.toLowerCase();
}
