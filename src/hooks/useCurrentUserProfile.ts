import { useEffect, useSyncExternalStore } from "react"
import supabase from "@/lib/supabase"
import type { User } from "@supabase/supabase-js"
import {
  isProfileRole,
  normalizeAccountType,
  type AccountType,
  type ProfileRole,
} from "@/lib/permissions"

export interface CurrentUserProfile {
  id: string
  user_id: string
  full_name: string
  avatar_url?: string | null
  account_type: AccountType
  unlinked_at?: string | null
  roles: ProfileRole[]
  scoped_event_ids: string[]
  scoped_form_ids: string[]
  is_dev: boolean
  is_presbyter: boolean
  is_deacon: boolean
  is_publisher: boolean
  can_post: boolean
  is_church_linked: boolean
  is_leader: boolean
}

export interface ProfileCacheState {
  user: User | null
  profile: CurrentUserProfile | null
  accountType: AccountType
  roles: ProfileRole[]
  scopedEventIds: string[]
  scopedFormIds: string[]
  isDev: boolean
  isPresbyter: boolean
  isDeacon: boolean
  isPublisher: boolean
  isLeader: boolean
  /** Acesso a /grupos-caseiros (Presbítero ou Dev) */
  isAdmin: boolean
  /** Acesso a /gestao (Presbítero, Diácono [somente leitura], Dev ou Líder de GC) */
  isManagement: boolean
  /** Pode editar pessoas, grupos ou juntas em /gestao (exclui Diácono) */
  canEditPeople: boolean
  /** Pode ver abas/rotas de eventos e minhas inscrições (oculto para Estudo) */
  canViewEventsNav: boolean
  /** Pode acessar gestão de eventos (/manage-events) — geral ou escopada */
  canManageEvents: boolean
  /** Pode criar/excluir novos eventos ou gerenciar todos os eventos */
  canCreateEvents: boolean
  /** Pode acessar gestão de formulários (/gestao/formularios) — geral ou escopada */
  canManageForms: boolean
  /** Pode criar/excluir formulários */
  canCreateForms: boolean
  /** Pode publicar notícias gerais (Diácono, Dev ou Publicador) */
  canPostGeneral: boolean
  /** Pode publicar notícias (geral ou vinculadas a evento permitido) */
  canPost: boolean
  /** Pode adicionar/excluir materiais e estudos em /ensinos */
  canAddTeachingMaterial: boolean
  /** Pode conceder permissões por evento/formulário e papel de Publicador */
  canAssignResourcePermissions: boolean
  loading: boolean
  timestamp: number
}

const CACHE_KEY = "igrejaBH_profile_cache_v2"

function buildEmptyState(loading: boolean): ProfileCacheState {
  return {
    user: null,
    profile: null,
    accountType: "study",
    roles: [],
    scopedEventIds: [],
    scopedFormIds: [],
    isDev: false,
    isPresbyter: false,
    isDeacon: false,
    isPublisher: false,
    isLeader: false,
    isAdmin: false,
    isManagement: false,
    canEditPeople: false,
    canViewEventsNav: false,
    canManageEvents: false,
    canCreateEvents: false,
    canManageForms: false,
    canCreateForms: false,
    canPostGeneral: false,
    canPost: false,
    canAddTeachingMaterial: false,
    canAssignResourcePermissions: false,
    loading,
    timestamp: loading ? 0 : Date.now(),
  }
}

function deriveCapabilities(
  user: User,
  profile: CurrentUserProfile
): ProfileCacheState {
  const {
    account_type: accountType,
    roles,
    scoped_event_ids: scopedEventIds,
    scoped_form_ids: scopedFormIds,
    is_dev: isDev,
    is_presbyter: isPresbyter,
    is_deacon: isDeacon,
    is_publisher: isPublisher,
    is_leader: isLeader,
  } = profile

  const canCreateEvents = isDev || isDeacon
  const canManageEvents = canCreateEvents || scopedEventIds.length > 0
  const canCreateForms = isDev || isDeacon
  const canManageForms = canCreateForms || scopedFormIds.length > 0
  const canPostGeneral = isDev || isDeacon || isPublisher
  const canPost = canPostGeneral || scopedEventIds.length > 0
  const canEditPeople = isDev || isPresbyter || isLeader
  const isManagement = isDev || isPresbyter || isDeacon || isLeader
  const isAdmin = isDev || isPresbyter
  const canViewEventsNav =
    accountType !== "study" || canManageEvents || isPresbyter
  const canAddTeachingMaterial = isDev || isDeacon
  const canAssignResourcePermissions = isDev || isDeacon

  return {
    user,
    profile,
    accountType,
    roles,
    scopedEventIds,
    scopedFormIds,
    isDev,
    isPresbyter,
    isDeacon,
    isPublisher,
    isLeader,
    isAdmin,
    isManagement,
    canEditPeople,
    canViewEventsNav,
    canManageEvents,
    canCreateEvents,
    canManageForms,
    canCreateForms,
    canPostGeneral,
    canPost,
    canAddTeachingMaterial,
    canAssignResourcePermissions,
    loading: false,
    timestamp: Date.now(),
  }
}

function getInitialCache(): ProfileCacheState {
  try {
    if (typeof window !== "undefined") {
      // Remove chave legada v1 se existir
      localStorage.removeItem("igrejaBH_profile_cache_v1")
      const raw = localStorage.getItem(CACHE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === "object" && parsed.profile && parsed.user) {
          return deriveCapabilities(parsed.user, {
            ...parsed.profile,
            roles: Array.isArray(parsed.profile.roles) ? parsed.profile.roles : [],
            scoped_event_ids: Array.isArray(parsed.profile.scoped_event_ids)
              ? parsed.profile.scoped_event_ids
              : [],
            scoped_form_ids: Array.isArray(parsed.profile.scoped_form_ids)
              ? parsed.profile.scoped_form_ids
              : [],
            account_type: normalizeAccountType(
              parsed.profile.account_type,
              parsed.profile.is_church_linked
            ),
          })
        }
      }
    }
  } catch (e) {
    console.warn("Falha ao recuperar cache de perfil:", e)
  }

  return buildEmptyState(true)
}

let currentState: ProfileCacheState = getInitialCache()
const listeners = new Set<() => void>()

function emitChange() {
  for (const listener of listeners) {
    listener()
  }
}

function updateState(next: ProfileCacheState) {
  currentState = next
  try {
    if (typeof window !== "undefined") {
      if (currentState.user && currentState.profile) {
        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({
            user: currentState.user,
            profile: currentState.profile,
            timestamp: currentState.timestamp,
          })
        )
      } else if (!currentState.loading && !currentState.user) {
        localStorage.removeItem(CACHE_KEY)
      }
    }
  } catch (e) {
    console.warn("Falha ao salvar cache de perfil:", e)
  }
  emitChange()
}

let activeFetchPromise: Promise<ProfileCacheState | null> | null = null
let fetchGeneration = 0

export async function fetchUserProfile(
  forceRefresh = false
): Promise<ProfileCacheState | null> {
  if (activeFetchPromise && !forceRefresh) {
    return activeFetchPromise
  }

  const gen = ++fetchGeneration

  if (!currentState.user && !currentState.profile && !currentState.loading) {
    updateState({ ...currentState, loading: true })
  }

  activeFetchPromise = (async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (gen !== fetchGeneration) {
        return currentState
      }

      if (!session?.user) {
        updateState(buildEmptyState(false))
        return currentState
      }

      const userId = session.user.id

      // 1. Buscar perfil base
      const { data: profileData, error: profileErr } = await supabase
        .from("profiles")
        .select(
          "id, user_id, full_name, avatar_url, account_type, unlinked_at, is_dev, is_presbyter, is_deacon, can_post, is_church_linked"
        )
        .eq("user_id", userId)
        .maybeSingle()

      if (gen !== fetchGeneration) {
        return currentState
      }

      if (profileErr) {
        console.error("Erro ao buscar perfil:", profileErr)
      }

      if (!profileData) {
        updateState({ ...buildEmptyState(false), user: session.user })
        return currentState
      }

      // 2. Buscar papéis N:N, permissões por recurso e liderança de GC em paralelo
      const [rolesRes, permsRes, leaderRes] = await Promise.all([
        supabase
          .from("profile_roles")
          .select("role")
          .eq("profile_id", profileData.id),
        supabase
          .from("resource_permissions")
          .select("resource_type, resource_id")
          .eq("profile_id", profileData.id),
        supabase
          .from("home_groups")
          .select("id", { count: "exact", head: true })
          .or(`leader_1_id.eq.${profileData.id},leader_2_id.eq.${profileData.id}`),
      ])

      if (gen !== fetchGeneration) {
        return currentState
      }

      const rolesSet = new Set<ProfileRole>()
      if (rolesRes.data && rolesRes.data.length > 0) {
        for (const r of rolesRes.data) {
          if (isProfileRole(r.role)) {
            rolesSet.add(r.role)
          }
        }
      } else {
        // Fallback defensivo caso a tabela ainda não tenha retornado
        if (profileData.is_dev) rolesSet.add("dev")
        if (profileData.is_presbyter) rolesSet.add("presbyter")
        if (profileData.is_deacon) rolesSet.add("deacon")
        if (profileData.can_post) rolesSet.add("publisher")
      }

      const scopedEventIds: string[] = []
      const scopedFormIds: string[] = []
      if (permsRes.data) {
        for (const p of permsRes.data) {
          if (p.resource_type === "event") {
            scopedEventIds.push(p.resource_id)
          } else if (p.resource_type === "form") {
            scopedFormIds.push(p.resource_id)
          }
        }
      }

      const roles = Array.from(rolesSet)
      const isLeader = (leaderRes.count || 0) > 0
      const accountType = normalizeAccountType(
        profileData.account_type,
        profileData.is_church_linked
      )

      const isDev = rolesSet.has("dev")
      const isPresbyter = rolesSet.has("presbyter")
      const isDeacon = rolesSet.has("deacon")
      const isPublisher = rolesSet.has("publisher")

      const fullProfile: CurrentUserProfile = {
        id: profileData.id,
        user_id: profileData.user_id || session.user.id,
        full_name: profileData.full_name,
        avatar_url: profileData.avatar_url || null,
        account_type: accountType,
        unlinked_at: profileData.unlinked_at || null,
        roles,
        scoped_event_ids: scopedEventIds,
        scoped_form_ids: scopedFormIds,
        is_dev: isDev,
        is_presbyter: isPresbyter,
        is_deacon: isDeacon,
        is_publisher: isPublisher,
        can_post: isDev || isDeacon || isPublisher || scopedEventIds.length > 0,
        is_church_linked: accountType === "disciple",
        is_leader: isLeader,
      }

      updateState(deriveCapabilities(session.user, fullProfile))
      return currentState
    } catch (err) {
      console.error("Erro inesperado ao carregar dados do usuário:", err)
      if (gen === fetchGeneration) {
        updateState({ ...currentState, loading: false })
      }
      return currentState
    } finally {
      if (gen === fetchGeneration) {
        activeFetchPromise = null
      }
    }
  })()

  return activeFetchPromise
}

export function invalidateCurrentUserProfileCache() {
  return fetchUserProfile(true)
}

if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "USER_UPDATED") {
      fetchUserProfile(true)
    } else if (event === "SIGNED_OUT") {
      updateState(buildEmptyState(false))
    }
  })
}

export function useCurrentUserProfile() {
  const state = useSyncExternalStore(
    (callback) => {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },
    () => currentState,
    () => currentState
  )

  useEffect(() => {
    const isStale = Date.now() - state.timestamp > 3 * 60 * 1000
    if (state.loading || isStale || !state.profile) {
      fetchUserProfile()
    }
  }, [state.loading, state.timestamp, state.profile])

  return {
    ...state,
    refresh: () => fetchUserProfile(true),
  }
}
