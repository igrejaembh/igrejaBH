import type { Database, Json } from "@/lib/database.types"
import type { RefundStatus } from "@/constants/colors"
import type { FlightDetailsValue } from "@/lib/schemas"

export type PortalMessage = Database["public"]["Tables"]["retreat_participant_messages"]["Row"]

export interface PortalAnnouncement {
  id: string
  title: string
  content: string
  category: Database["public"]["Enums"]["post_category"]
  event_label: string | null
  is_public: boolean
  image_urls: string[] | null
  created_at: string
  updated_at: string
}

export interface PortalRetreatInfo {
  id: string
  title: string
  description: string | null
  start_date: string | null
  end_date: string | null
  location_text: string | null
  image_url: string | null
  status: string | null
  price: number | null
  has_payment: boolean | null
  form_id: string | null
}

export interface PortalRegistrationInfo {
  id: string
  retreat_id: string | null
  profile_id: string | null
  portal_token: string
  status: "confirmado" | "presente" | "cancelado"
  paid: boolean
  payment_method: string | null
  payment_reference: string | null
  room_allocation: string | null
  custom_responses: Record<string, unknown> | null
  guest_data: Record<string, unknown> | null
  notes: string | null
  service_team: string | null
  checked_in_at: string | null
  cancellation_reason: string | null
  cancelled_at: string | null
  refund_requested: boolean
  refund_status: RefundStatus | null
  refund_pix_key: string | null
  refund_notes: string | null
  refund_requested_at: string | null
  refund_resolved_at: string | null
  flight_details: FlightDetailsValue | null
  created_at: string | null
  participant_name: string
  participant_email: string | null
  participant_phone: string | null
}

export interface ParticipantPortalData {
  registration: PortalRegistrationInfo
  retreat: PortalRetreatInfo | null
  posts: PortalAnnouncement[]
  messages: PortalMessage[]
}

/**
 * Gera token criptográfico aleatório de 32 caracteres hexadecimais (128 bits),
 * compatível com o default encode(extensions.gen_random_bytes(16), 'hex') no Postgres.
 */
export function generatePortalToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Normaliza o JSON de flight_details vindo do banco para o formato tipado do formulário.
 */
export function parseFlightDetails(raw: Json | null | undefined): FlightDetailsValue | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null
  }

  const obj = raw as Record<string, unknown>
  const getString = (key: string): string =>
    typeof obj[key] === "string" ? (obj[key] as string) : ""

  const hasAny =
    Boolean(getString("arrivalAirline")) ||
    Boolean(getString("arrivalFlightNumber")) ||
    Boolean(getString("arrivalAirport")) ||
    Boolean(getString("arrivalDateTime")) ||
    Boolean(getString("departureAirline")) ||
    Boolean(getString("departureFlightNumber")) ||
    Boolean(getString("departureDateTime")) ||
    Boolean(obj.needsAirportTransfer) ||
    Boolean(getString("notes"))

  if (!hasAny) {
    return null
  }

  return {
    arrivalAirline: getString("arrivalAirline"),
    arrivalFlightNumber: getString("arrivalFlightNumber"),
    arrivalAirport: getString("arrivalAirport"),
    arrivalDateTime: getString("arrivalDateTime"),
    departureAirline: getString("departureAirline"),
    departureFlightNumber: getString("departureFlightNumber"),
    departureDateTime: getString("departureDateTime"),
    needsAirportTransfer: Boolean(obj.needsAirportTransfer),
    notes: getString("notes"),
  }
}

/**
 * Formata valores de datetime-local (YYYY-MM-DDTHH:MM) ou ISO para exibição legível em pt-BR.
 */
export function formatFlightDateTime(value?: string | null): string {
  if (!value) return "Não informado"
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (match && !value.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(value)) {
    const [, y, m, d, hh, mm] = match
    return `${d}/${m}/${y} às ${hh}:${mm}`
  }
  const parsed = new Date(value)
  if (isNaN(parsed.getTime())) return value
  return parsed.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/**
 * Retorna rótulo humano amigável do método/situação de pagamento.
 */
export function getPortalPaymentLabel(
  method: string | null | undefined,
  paid: boolean | null | undefined
): string {
  const m = (method || "").toLowerCase()
  if (m === "gratuito") return "Inscrição Gratuita"
  if (m === "cupom") return paid ? "Isenção Confirmada (Cupom)" : "Cupom Pendente"
  if (m === "pix") return paid ? "Pago via PIX" : "PIX (Aguardando Confirmação)"
  if (m === "cartao" || m === "card" || m === "credit_card") {
    return paid ? "Pago no Cartão" : "Cartão (Pendente)"
  }
  if (m === "dinheiro") return paid ? "Pago em Dinheiro" : "Dinheiro (Pendente)"
  if (m === "boleto") return paid ? "Pago via Boleto" : "Boleto (Pendente)"
  return paid ? "Pagamento Confirmado" : "Aguardando Pagamento"
}

/**
 * Verifica se uma inscrição teve pagamento financeiro elegível para reembolso.
 */
export function isRefundEligible(reg: {
  paid?: boolean | null
  payment_method?: string | null
  payment_reference?: string | null
}): boolean {
  if (!reg.paid) return false
  const method = (reg.payment_method || "").toLowerCase()
  if (method === "gratuito") return false
  if (method === "cupom" && reg.payment_reference?.includes("100%")) return false
  return true
}

/**
 * Formata respostas dinâmicas para leitura clara na Área do Inscrito.
 */
export function formatRegistrationAnswer(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : "—"
  }
  if (typeof value === "boolean") {
    return value ? "Sim" : "Não"
  }
  if (typeof value === "object") {
    return JSON.stringify(value)
  }
  return String(value)
}
