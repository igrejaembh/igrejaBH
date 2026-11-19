import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, Megaphone, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import supabase from "@/lib/supabase"
import { useCurrentUserProfile } from "@/hooks/useCurrentUserProfile"
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

interface PublisherRolesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface DirectoryPerson {
  id: string
  full_name: string
  avatar_url: string | null
}

interface PublisherRoleRow {
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

export function PublisherRolesDialog({
  open,
  onOpenChange,
}: PublisherRolesDialogProps) {
  const { profile: currentUserProfile, refresh } = useCurrentUserProfile()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [people, setPeople] = useState<DirectoryPerson[]>([])
  const [publishers, setPublishers] = useState<PublisherRoleRow[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string>("")

  const loadData = useCallback(async () => {
    if (!open) return
    setLoading(true)
    try {
      const [dirRes, roleRes] = await Promise.all([
        supabase
          .from("profile_directory")
          .select("id, full_name, avatar_url")
          .eq("account_type", "disciple")
          .order("full_name"),
        supabase
          .from("profile_roles")
          .select("id, profile_id, created_at")
          .eq("role", "publisher")
          .order("created_at", { ascending: true }),
      ])

      if (dirRes.error) throw dirRes.error
      if (roleRes.error) throw roleRes.error

      setPeople(dirRes.data || [])
      setPublishers(roleRes.data || [])
    } catch (err) {
      console.error("Erro ao carregar publicadores:", err)
      toast.error("Não foi possível carregar a lista de publicadores.")
    } finally {
      setLoading(false)
    }
  }, [open])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const peopleMap = useMemo(() => {
    const map = new Map<string, DirectoryPerson>()
    people.forEach((p) => map.set(p.id, p))
    return map
  }, [people])

  const assignedIds = useMemo(
    () => new Set(publishers.map((p) => p.profile_id)),
    [publishers]
  )

  const availableOptions = useMemo<SearchableSelectOption[]>(() => {
    return people
      .filter((p) => !assignedIds.has(p.id))
      .map((p) => ({
        value: p.id,
        label: p.full_name,
      }))
  }, [people, assignedIds])

  const handleGrant = async () => {
    if (!selectedProfileId) return
    setSaving(true)
    try {
      const { error } = await supabase.from("profile_roles").insert({
        profile_id: selectedProfileId,
        role: "publisher",
        granted_by: currentUserProfile?.id || null,
      })
      if (error) throw error
      toast.success("Permissão de publicador concedida.")
      setSelectedProfileId("")
      await loadData()
      void refresh()
    } catch (err) {
      console.error("Erro ao conceder permissão de publicador:", err)
      toast.error("Não foi possível conceder a permissão.")
    } finally {
      setSaving(false)
    }
  }

  const handleRevoke = async (roleId: string) => {
    setSaving(true)
    try {
      const { error } = await supabase
        .from("profile_roles")
        .delete()
        .eq("id", roleId)
      if (error) throw error
      toast.success("Permissão de publicador removida.")
      await loadData()
      void refresh()
    } catch (err) {
      console.error("Erro ao remover permissão de publicador:", err)
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
            <Megaphone className="h-5 w-5 text-primary shrink-0" />
            <span>Permissões de Publicação no Mural</span>
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            Discípulos listados aqui recebem permissão global para criar e editar avisos e notícias no Mural da Comunidade. Diáconos e Desenvolvedores já possuem este acesso por padrão.
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
                emptyMessage="Nenhum discípulo disponível."
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
              <span>Adicionar</span>
            </Button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Publicadores autorizados
              </span>
              <Badge variant="outline" className={THEME_CLASSES.badgeNeutral}>
                {publishers.length}
              </Badge>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : publishers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                Nenhum discípulo com papel avulso de Publicador no momento.
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                {publishers.map((pub) => {
                  const person = peopleMap.get(pub.profile_id)
                  const displayName = person?.full_name || "Discípulo"
                  return (
                    <div
                      key={pub.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/60 px-3 py-2"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar className="h-8 w-8 border border-border shrink-0">
                          <AvatarImage src={person?.avatar_url || undefined} />
                          <AvatarFallback className="bg-primary/15 text-[11px] font-bold text-primary">
                            {getInitials(displayName)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="truncate text-sm font-medium text-foreground">
                          {displayName}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRevoke(pub.id)}
                        disabled={saving}
                        aria-label={`Remover permissão de ${displayName}`}
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
