import supabase from "@/lib/supabase"
import { formatValue } from "@/lib/forms"

export const GUEST_PREFILL_STORAGE_KEY = "igrejaBH_guest_registration_prefill"

export interface GuestRegistrationPrefill {
  fullName?: string
  email?: string
  phone?: string
  cpf?: string
  birthDate?: string
  gender?: string
  cityState?: string
  dietaryRestrictions?: string
  emergencyContact?: string
  retreatTitle?: string
}

/**
 * Normaliza um telefone salvo (inclusive com DDI +55) para o formato nacional (DDD) 9XXXX-XXXX.
 */
export function normalizeNationalPhoneForForm(phone?: string | null): string {
  if (!phone) return ""
  const digits = phone.replace(/\D/g, "")
  if (!digits) return ""
  const nationalDigits =
    (digits.length === 12 || digits.length === 13) && digits.startsWith("55")
      ? digits.slice(2)
      : digits
  return formatValue(nationalDigits, "phone")
}

/**
 * Converte gênero salvo no perfil para o valor esperado em inscrições de eventos ("Masculino" | "Feminino" | "").
 * Retorna string vazia quando não houver gênero salvo para evitar preenchimento incorreto.
 */
export function toEventGenderLabel(
  gender?: string | null
): "Masculino" | "Feminino" | "" {
  if (!gender) return ""
  const lower = gender.toLowerCase().trim()
  if (lower === "m" || lower === "masculino" || lower === "homem") {
    return "Masculino"
  }
  if (lower === "f" || lower === "feminino" || lower === "mulher") {
    return "Feminino"
  }
  return ""
}

/**
 * Converte gênero para os valores do perfil ("masculino" | "feminino" | "outro" | "").
 */
export function toProfileGenderValue(
  gender?: string | null
): "masculino" | "feminino" | "outro" | "" {
  if (!gender) return ""
  const lower = gender.toLowerCase().trim()
  if (lower === "m" || lower === "masculino" || lower === "homem") {
    return "masculino"
  }
  if (lower === "f" || lower === "feminino" || lower === "mulher") {
    return "feminino"
  }
  if (lower === "outro") return "outro"
  return ""
}

/**
 * Resolve cidade/estado priorizando `city_state` e usando endereço residencial como fallback.
 */
export function resolveProfileCityState(profile: {
  city_state?: string | null
  address_city?: string | null
  address_state?: string | null
}): string {
  if (profile.city_state && profile.city_state.trim()) {
    return profile.city_state.trim()
  }
  if (profile.address_city && profile.address_state) {
    return `${profile.address_city.trim()} / ${profile.address_state.trim()}`
  }
  return profile.address_city?.trim() || ""
}

/**
 * Valida caminho de redirecionamento interno seguro (evita open redirect).
 */
export function getSafeRedirectPath(redirect?: string | null): string | null {
  if (!redirect) return null
  const trimmed = redirect.trim()
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null
  return trimmed
}

export function saveGuestPrefillToSession(prefill: GuestRegistrationPrefill): void {
  try {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(
        GUEST_PREFILL_STORAGE_KEY,
        JSON.stringify(prefill)
      )
    }
  } catch (err) {
    console.warn("Não foi possível salvar pré-preenchimento temporário:", err)
  }
}

export function readGuestPrefillFromSession(): GuestRegistrationPrefill | null {
  try {
    if (typeof window === "undefined") return null
    const raw = window.sessionStorage.getItem(GUEST_PREFILL_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object"
      ? (parsed as GuestRegistrationPrefill)
      : null
  } catch {
    return null
  }
}

export function clearGuestPrefillSession(): void {
  try {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(GUEST_PREFILL_STORAGE_KEY)
    }
  } catch {
    // noop
  }
}

export function buildSignUpUrlWithPrefill(
  prefill: GuestRegistrationPrefill,
  redirect = "/eventos"
): string {
  saveGuestPrefillToSession(prefill)
  const params = new URLSearchParams()
  params.set("tab", "participante")
  if (prefill.fullName?.trim()) params.set("nome", prefill.fullName.trim())
  if (prefill.email?.trim()) params.set("email", prefill.email.trim())
  if (prefill.cpf?.trim()) params.set("cpf", prefill.cpf.trim())
  if (prefill.phone?.trim()) params.set("telefone", prefill.phone.trim())
  if (prefill.cityState?.trim()) params.set("cidade", prefill.cityState.trim())
  if (prefill.birthDate?.trim()) params.set("nascimento", prefill.birthDate.trim())
  if (prefill.gender?.trim()) params.set("genero", prefill.gender.trim())
  const safeRedirect = getSafeRedirectPath(redirect)
  if (safeRedirect) params.set("redirect", safeRedirect)
  return `/cadastro?${params.toString()}`
}

/**
 * Chama a RPC `claim_participant_registrations()` de forma segura após cadastro/login.
 */
export async function claimParticipantRegistrationsSafe(): Promise<number> {
  try {
    const { data, error } = await supabase.rpc("claim_participant_registrations")
    if (error) {
      console.warn("Erro ao vincular inscrições anteriores:", error.message)
      return 0
    }
    return typeof data === "number" ? data : Number(data) || 0
  } catch (err) {
    console.warn("Falha inesperada ao vincular inscrições anteriores:", err)
    return 0
  }
}
