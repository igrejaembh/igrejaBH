import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, Plus, ShieldCheck, Trash2, UserCheck } from "lucide-react"
import { toast } from "sonner"
import supabase from "@/lib/supabase"
import { useCurrentUserProfile } from "@/hooks/useCurrentUserProfile"
import type { ResourceType } from "@/lib/permissions"
import { THEME_CLASSES } from "@/constants/colors"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "@/components/ui/searchable-select"

interface ResourcePermissionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  resourceType: ResourceType
  resourceId: string
  resourceTitle: string
}

interface DirectoryPerson {
  id: string
  full_name: string
  avatar_url: string | null
}

interface PermissionRow {
  id: string
  profile_id: string
  created_at: string
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
}

export function ResourcePermissionsDialog({
  open,
  onOpenChange,
  resourceType,
  resourceId,
  resourceTitle,
}: ResourcePermissionsDialogProps) {
  const { profile: currentUserProfile, refresh } = useCurrentUserProfile()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [people, setPeople] = useState<DirectoryPerson[]>([])
  const [permissions, setPermissions] = useState<PermissionRow[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string>("")

  const loadData = useCallback(async () => {
    if (!open || !resourceId) return
    setLoading(true)
    try {
      const [dirRes, permRes] = await Promise.all([
        supabase
          .from("profile_directory")
          .select("id, full_name, avatar_url")
          .eq("account_type", "disciple")
          .order("full_name"),
        supabase
          .from("resource_permissions")
          .select("id, profile_id, created_at")
          .eq("resource_type", resourceType)
          .eq("resource_id", resourceId)
          .order("created_at", { ascending: true }),
      ])

      if (dirRes.error) throw dirRes.error
      if (permRes.error) throw permRes.error

      setPeople(dirRes.data || [])
      setPermissions(permRes.data || [])
    } catch (err) {
      console.error("Erro ao carregar permissões do recurso:", err)
      toast.error("Não foi possível carregar as permissões.")
    } finally {
      setLoading(false)
    }
  }, [open, resourceType, resourceId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const peopleMap = useMemo(() => {
    const map = new Map<string, DirectoryPerson>()
    people.forEach((p) => map.set(p.id, p))
    return map
  }, [people])

  const assignedProfileIds = useMemo(
    () => new Set(permissions.map((p) => p.profile_id)),
    [permissions]
  )

  const availableOptions = useMemo<SearchableSelectOption[]>(() => {
    return people
      .filter((p) => !assignedProfileIds.has(p.id))
      .map((p) => ({
        value: p.id,
        label: p.full_name,
      }))
  }, [people, assignedProfileIds])

  const handleGrant = async () => {
    if (!selectedProfileId) return
    setSaving(true)
    try {
      const { error } = await supabase.from("resource_permissions").insert({
        profile_id: selectedProfileId,
        resource_type: resourceType,
        resource_id: resourceId,
        granted_by: currentUserProfile?.id || null,
      })
      if (error) throw error
      toast.success("Permissão concedida com sucesso.")
      setSelectedProfileId("")
      await loadData()
      void refresh()
    } catch (err) {
      console.error("Erro ao conceder permissão:", err)
      toast.error("Não foi possível conceder a permissão.")
    } finally {
      setSaving(false)
    }
  }

  const handleRevoke = async (permId: string) => {
    setSaving(true)
    try {
      const { error } = await supabase
        .from("resource_permissions")
        .delete()
        .eq("id", permId)
      if (error) throw error
      toast.success("Permissão removida.")
      await loadData()
      void refresh()
    } catch (err) {
      console.error("Erro ao remover permissão:", err)
      toast.error("Não foi possível remover a permissão.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-5 w-5 text-primary shrink-0" />
            <span>
              Permissões de Acesso —{" "}
              {resourceType === "event" ? "Evento" : "Formulário"}
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            <strong className="text-foreground">{resourceTitle}</strong>:{" "}
            {resourceType === "event"
              ? "Discípulos adicionados aqui podem editar e gerenciar este evento e publicar comunicados vinculados a ele no Mural (sem acesso a postagens gerais)."
              : "Discípulos adicionados aqui podem editar este formulário e visualizar suas respostas."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 min-w-0">
              <SearchableSelect
                options={availableOptions}
                value={selectedProfileId}
                onValueChange={setSelectedProfileId}
                placeholder="Selecionar discípulo..."
                emptyMessage="Todos os discípulos já possuem acesso ou nenhum encontrado."
                disabled={loading || saving}
              />
            </div>
            <Button
              type="button"
              onClick={handleGrant}
              disabled={!selectedProfileId || loading || saving}
              className="min-h-[44px] gap-1.5 rounded-xl shrink-0"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              <span>Conceder</span>
            </Button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Pessoas com acesso específico
              </span>
              <Badge variant="outline" className={THEME_CLASSES.badgeNeutral}>
                {permissions.length}
              </Badge>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : permissions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                Nenhuma permissão pontual concedida ainda. Apenas Diáconos e Desenvolvedores acessam por padrão.
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                {permissions.map((perm) => {
                  const person = peopleMap.get(perm.profile_id)
                  const displayName = person?.full_name || "Discípulo"
                  return (
                    <div
                      key={perm.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/60 px-3 py-2"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar className="h-8 w-8 border border-border shrink-0">
                          <AvatarImage src={person?.avatar_url || undefined} />
                          <AvatarFallback className="bg-primary/15 text-[11px] font-bold text-primary">
                            {getInitials(displayName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="truncate text-sm font-medium text-foreground">
                            {displayName}
                          </span>
                          <UserCheck className="h-3.5 w-3.5 text-primary shrink-0" />
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRevoke(perm.id)}
                        disabled={saving}
                        aria-label={`Remover acesso de ${displayName}`}
                        className="min-h-[44px] min-w-[44px] text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
