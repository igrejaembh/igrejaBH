import {
  Home,
  Users,
  BookOpen,
  Calendar,
  ClipboardList,
  Ticket,
  type LucideIcon,
} from "lucide-react"
import type { ProfileCacheState } from "@/hooks/useCurrentUserProfile"

export interface NavItem {
  name: string
  href: string
  icon: LucideIcon
  requireAdmin?: boolean
  requireManagement?: boolean
  requireCanPost?: boolean
  requireManageEvents?: boolean
  requireManageForms?: boolean
  requireEventsAccess?: boolean
}

export const navItems: NavItem[] = [
  { name: "Início", href: "/dashboard", icon: Home },
  { name: "Ensinos", href: "/ensinos", icon: BookOpen },
  {
    name: "Minhas Inscrições",
    href: "/minhas-inscricoes",
    icon: Ticket,
    requireEventsAccess: true,
  },
  {
    name: "Gestão de Eventos",
    href: "/manage-events",
    icon: Calendar,
    requireManageEvents: true,
  },
  {
    name: "Gestão do Corpo",
    href: "/gestao",
    icon: Users,
    requireManagement: true,
  },
  {
    name: "Formulários",
    href: "/gestao/formularios",
    icon: ClipboardList,
    requireManageForms: true,
  },
]

export function isNavItemVisible(
  item: NavItem,
  state: Pick<
    ProfileCacheState,
    | "isAdmin"
    | "isManagement"
    | "canPost"
    | "canManageEvents"
    | "canManageForms"
    | "canViewEventsNav"
  >
): boolean {
  if (item.requireAdmin && !state.isAdmin) return false
  if (item.requireManagement && !state.isManagement) return false
  if (item.requireCanPost && !state.canPost) return false
  if (item.requireManageEvents && !state.canManageEvents) return false
  if (item.requireManageForms && !state.canManageForms) return false
  if (item.requireEventsAccess && !state.canViewEventsNav) return false
  return true
}
