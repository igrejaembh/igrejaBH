import { useCurrentUserProfile } from "@/hooks/useCurrentUserProfile"
import { isRestrictedGroupMode } from "@/lib/restrictedMode"
import { Loader2 } from "lucide-react"
import { Navigate, Outlet, useLocation } from "react-router-dom"
import type { ReactNode } from "react"

export interface RoutePermissionProps {
  requireAdmin?: boolean
  requireManagement?: boolean
  requireCanPost?: boolean
  requireManageEvents?: boolean
  requireManageForms?: boolean
  requireEventsAccess?: boolean
}

interface ProtectedRouteProps extends RoutePermissionProps {
  children?: ReactNode
}

export function ProtectedRoute({
  children,
  requireAdmin,
  requireManagement,
  requireCanPost,
  requireManageEvents,
  requireManageForms,
  requireEventsAccess,
}: ProtectedRouteProps) {
  const {
    user,
    profile,
    isAdmin,
    isManagement,
    canPost,
    canManageEvents,
    canManageForms,
    canViewEventsNav,
    loading,
  } = useCurrentUserProfile()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!user && !profile) {
    return <Navigate to="/entrar" state={{ from: location }} replace />
  }

  const fallbackPath = isRestrictedGroupMode() ? "/meu-grupo" : "/dashboard"

  if (requireAdmin && !isAdmin) {
    return <Navigate to={fallbackPath} replace />
  }

  if (requireManagement && !isManagement) {
    return <Navigate to={fallbackPath} replace />
  }

  if (requireCanPost && !canPost) {
    return <Navigate to={fallbackPath} replace />
  }

  if (requireManageEvents && !canManageEvents) {
    return <Navigate to={fallbackPath} replace />
  }

  if (requireManageForms && !canManageForms) {
    return <Navigate to={fallbackPath} replace />
  }

  if (requireEventsAccess && !canViewEventsNav) {
    return <Navigate to={fallbackPath} replace />
  }

  return children ? <>{children}</> : <Outlet />
}
