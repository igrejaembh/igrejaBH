import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  Bed,
  Calendar,
  ExternalLink,
  HeartHandshake,
  MapPin,
  QrCode,
  Search,
  Ticket,
} from "lucide-react"
import { toast } from "sonner"
import supabase from "@/lib/supabase"
import { useCurrentUserProfile } from "@/hooks/useCurrentUserProfile"
import type { Database } from "@/lib/database.types"
import { formatDateBR, cn } from "@/lib/utils"
import { getEffectiveRetreatStatus, syncExpiredRetreats } from "@/lib/retreatStatus"
import { REFUND_STATUS_CONFIG, THEME_CLASSES, type RefundStatus } from "@/constants/colors"
import { getServiceTeam, getServiceTeamBadgeStyle } from "@/constants/serviceTeams"
import { ParticipantQrBadgeDialog } from "@/components/events/ParticipantQrBadge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

type RetreatRow = Database["public"]["Tables"]["retreats"]["Row"]
type RegistrationWithRetreat = Database["public"]["Tables"]["registrations"]["Row"] & {
  retreats?: RetreatRow | null
}

type RegistrationFilter = "all" | "open" | "past"

export default function MyRegistrations() {
  const { user, profile } = useCurrentUserProfile()
  const [registrations, setRegistrations] = useState<RegistrationWithRetreat[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<RegistrationFilter>("all")
  const [searchTerm, setSearchTerm] = useState("")
  const [badgeDialogRegistration, setBadgeDialogRegistration] =
    useState<RegistrationWithRetreat | null>(null)

  const fetchMyRegistrations = useCallback(async () => {
    if (!profile?.id) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      await syncExpiredRetreats()

      const { data, error } = await supabase
        .from("registrations")
        .select("*, retreats(*)")
        .eq("profile_id", profile.id)
        .order("created_at", { ascending: false })

      if (error) throw error
      setRegistrations((data as unknown as RegistrationWithRetreat[]) || [])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro inesperado"
      toast.error("Não foi possível carregar suas inscrições: " + msg)
    } finally {
      setLoading(false)
    }
  }, [profile?.id])

  useEffect(() => {
    fetchMyRegistrations()
  }, [fetchMyRegistrations])

  const counts = useMemo(() => {
    let open = 0
    let past = 0
    for (const reg of registrations) {
      const retreat = reg.retreats
      if (!retreat) continue
      const effectiveStatus = getEffectiveRetreatStatus(retreat.status, retreat.end_date)
      if (effectiveStatus === "ativo") {
        open += 1
      } else {
        past += 1
      }
    }
    return {
      all: open + past,
      open,
      past,
    }
  }, [registrations])

  const filteredRegistrations = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    return registrations.filter((reg) => {
      const retreat = reg.retreats
      if (!retreat) return false

      const effectiveStatus = getEffectiveRetreatStatus(retreat.status, retreat.end_date)
      if (filter === "open" && effectiveStatus !== "ativo") return false
      if (filter === "past" && effectiveStatus === "ativo") return false

      if (query) {
        const titleMatch = retreat.title.toLowerCase().includes(query)
        const locMatch = (retreat.location_text || "").toLowerCase().includes(query)
        return titleMatch || locMatch
      }
      return true
    })
  }, [registrations, filter, searchTerm])

  const participantDisplayName =
    profile?.full_name || user?.email || "Participante"

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 pb-12 animate-in fade-in duration-300">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-border/60 pb-5">
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <Ticket className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Minhas Inscrições
            </h1>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground max-w-2xl">
            Acompanhe seus retiros e encontros — em aberto e anteriores — acesse seu crachá digital, respostas enviadas, avisos e atendimento com a organização.
          </p>
        </div>

        <Button
          asChild
          variant="outline"
          className="min-h-[44px] shrink-0 font-semibold"
        >
          <Link to="/eventos">
            <Calendar className="mr-2 h-4 w-4" />
            Explorar Eventos Abertos
          </Link>
        </Button>
      </div>

      {/* Filtros e Busca */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={filter}
          onValueChange={(v) => setFilter(v as RegistrationFilter)}
          className="w-full sm:w-auto"
        >
          <TabsList className="grid w-full grid-cols-3 sm:inline-flex sm:w-auto min-h-[52px] h-auto items-center p-1">
            <TabsTrigger
              value="all"
              className="min-h-[44px] px-2.5 sm:px-3 text-xs sm:text-sm font-semibold cursor-pointer"
            >
              Todas ({counts.all})
            </TabsTrigger>
            <TabsTrigger
              value="open"
              className="min-h-[44px] px-2.5 sm:px-3 text-xs sm:text-sm font-semibold cursor-pointer"
            >
              Em Aberto ({counts.open})
            </TabsTrigger>
            <TabsTrigger
              value="past"
              className="min-h-[44px] px-2.5 sm:px-3 text-xs sm:text-sm font-semibold cursor-pointer"
            >
              Anteriores ({counts.past})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar retiro ou local..."
            aria-label="Buscar retiro ou local"
            className="min-h-[44px] pl-9"
          />
        </div>
      </div>

      {/* Lista de Inscrições */}
      {loading ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-64 w-full rounded-xl" />
          ))}
        </div>
      ) : filteredRegistrations.length === 0 ? (
        <Card className={cn(THEME_CLASSES.card, "p-8 sm:p-12 text-center")}>
          <div className="mx-auto flex max-w-md flex-col items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted/40 text-muted-foreground">
              <Ticket className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-bold text-foreground">
              {registrations.length === 0
                ? "Você ainda não possui inscrições"
                : "Nenhuma inscrição encontrada neste filtro"}
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {registrations.length === 0
                ? "Quando você se inscrever em um retiro ou encontro, ele aparecerá aqui com seu crachá digital, avisos e histórico."
                : "Tente limpar a busca ou selecionar a aba Todas para visualizar seus encontros anteriores."}
            </p>
            {registrations.length === 0 ? (
              <Button asChild className="mt-2 min-h-[44px] font-semibold">
                <Link to="/eventos">Ver Eventos Disponíveis</Link>
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setFilter("all")
                  setSearchTerm("")
                }}
                className="mt-2 min-h-[44px] font-semibold cursor-pointer"
              >
                Mostrar Todas as Inscrições
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {filteredRegistrations.map((reg) => {
            const retreat = reg.retreats
            if (!retreat) return null

            const effectiveRetreatStatus = getEffectiveRetreatStatus(
              retreat.status,
              retreat.end_date
            )
            const isRetreatOpen = effectiveRetreatStatus === "ativo"
            const isCancelled = reg.status === "cancelado"
            const isPresent = reg.status === "presente" || Boolean(reg.checked_in_at)
            const teamDef = getServiceTeam(reg.service_team)
            const TeamIcon = teamDef?.icon

            let statusLabel = "Aguardando Pagamento"
            let statusClass =
              "border-amber-500/30 bg-amber-500/15 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"

            if (isCancelled) {
              statusLabel = "Cancelada"
              statusClass =
                "border-red-500/30 bg-red-500/15 text-red-800 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
            } else if (isPresent) {
              statusLabel = "Presente"
              statusClass =
                "border-blue-500/30 bg-blue-500/15 text-blue-800 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300"
            } else if (reg.paid || !retreat.has_payment) {
              statusLabel = "Confirmada"
              statusClass =
                "border-emerald-500/30 bg-emerald-500/15 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
            }

            const refundStatus = reg.refund_status as RefundStatus | null
            const refundMeta = refundStatus ? REFUND_STATUS_CONFIG[refundStatus] : null

            return (
              <Card
                key={reg.id}
                className={cn(
                  THEME_CLASSES.card,
                  "flex flex-col justify-between transition-colors hover:border-primary/30"
                )}
              >
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[11px] font-bold uppercase tracking-wider",
                        isRetreatOpen
                          ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                          : "border-border bg-muted text-muted-foreground"
                      )}
                    >
                      {isRetreatOpen ? "Evento Aberto" : "Encerrado"}
                    </Badge>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[11px] font-bold uppercase tracking-wider",
                          statusClass
                        )}
                      >
                        {statusLabel}
                      </Badge>
                      {reg.refund_requested && refundMeta && (
                        <Badge variant="outline" className={refundMeta.className}>
                          Reembolso: {refundMeta.label}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <CardTitle className="text-lg font-bold text-foreground leading-snug">
                      {retreat.title}
                    </CardTitle>
                    {retreat.description && (
                      <CardDescription className="line-clamp-2 text-xs leading-relaxed">
                        {retreat.description}
                      </CardDescription>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 pt-0 text-xs">
                  <div className="flex flex-col gap-1.5 text-muted-foreground">
                    {retreat.start_date && (
                      <div className="flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5 shrink-0 text-primary" />
                        <span>
                          {formatDateBR(retreat.start_date)}
                          {retreat.end_date ? ` até ${formatDateBR(retreat.end_date)}` : ""}
                        </span>
                      </div>
                    )}
                    {retreat.location_text && (
                      <div className="flex items-center gap-2">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" />
                        <span className="truncate">{retreat.location_text}</span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/25 px-3 py-2">
                      <Bed className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <div className="min-w-0">
                        <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
                          Alojamento
                        </span>
                        <span className="block truncate font-semibold text-foreground">
                          {reg.room_allocation || "Pendente de alocação"}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/25 px-3 py-2">
                      <HeartHandshake className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <div className="min-w-0">
                        <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
                          Serviço
                        </span>
                        {teamDef && TeamIcon ? (
                          <Badge
                            variant="outline"
                            className={cn("mt-0.5", getServiceTeamBadgeStyle(teamDef.id))}
                          >
                            <TeamIcon className="size-3" />
                            <span>{teamDef.shortLabel}</span>
                          </Badge>
                        ) : (
                          <span className="block truncate font-semibold text-foreground">
                            Participante
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>

                <CardFooter className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 border-t border-border/60 pt-4">
                  <Button
                    asChild
                    className="min-h-[44px] flex-1 font-semibold"
                  >
                    <Link to={`/eventos/inscricao/${reg.id}`}>
                      <ExternalLink data-icon="inline-start" />
                      Detalhes, Avisos e Mensagens
                    </Link>
                  </Button>

                  {!isCancelled && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setBadgeDialogRegistration(reg)}
                      className="min-h-[44px] px-3.5 font-semibold cursor-pointer shrink-0"
                    >
                      <QrCode className="mr-1.5 h-4 w-4" />
                      <span>Ver Crachá (QR)</span>
                    </Button>
                  )}
                </CardFooter>
              </Card>
            )
          })}
        </div>
      )}

      <ParticipantQrBadgeDialog
        isOpen={Boolean(badgeDialogRegistration)}
        onClose={() => setBadgeDialogRegistration(null)}
        registration={badgeDialogRegistration}
        participantName={participantDisplayName}
      />
    </div>
  )
}
