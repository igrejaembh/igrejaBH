export type AccountType =
  | "study"
  | "frequent_participant"
  | "unlinked"
  | "disciple"

export type ProfileRole = "dev" | "presbyter" | "deacon" | "publisher"

export type ResourceType = "event" | "form"

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  study: "Estudo",
  frequent_participant: "Participante Frequente",
  unlinked: "Desvinculado",
  disciple: "Discípulo",
}

export const ROLE_LABELS: Record<ProfileRole, string> = {
  dev: "Desenvolvedor",
  presbyter: "Presbítero",
  deacon: "Diácono",
  publisher: "Publicador",
}

export function normalizeAccountType(
  rawAccountType?: string | null,
  legacyIsChurchLinked?: boolean | null
): AccountType {
  if (
    rawAccountType === "study" ||
    rawAccountType === "frequent_participant" ||
    rawAccountType === "unlinked" ||
    rawAccountType === "disciple"
  ) {
    return rawAccountType
  }
  return legacyIsChurchLinked ? "disciple" : "study"
}

export function isProfileRole(value: string): value is ProfileRole {
  return (
    value === "dev" ||
    value === "presbyter" ||
    value === "deacon" ||
    value === "publisher"
  )
}

/**
 * Verifica quais papéis administrativos o usuário atual pode atribuir ou remover.
 * - dev: todos os papéis
 * - presbyter: presbyter e deacon
 * - deacon: publisher
 */
export function canAssignProfileRole(
  callerRoles: ReadonlySet<ProfileRole> | readonly ProfileRole[],
  targetRole: ProfileRole
): boolean {
  const has = (r: ProfileRole) =>
    "has" in callerRoles ? callerRoles.has(r) : callerRoles.includes(r)

  if (has("dev")) return true
  if (has("presbyter") && (targetRole === "presbyter" || targetRole === "deacon")) {
    return true
  }
  if (has("deacon") && targetRole === "publisher") {
    return true
  }
  return false
}
