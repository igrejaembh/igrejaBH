import { useCallback, useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  ArrowLeft,
  Ban,
  Bed,
  Bell,
  Calendar,
  Check,
  CheckCircle2,
  ClipboardList,
  Copy,
  CreditCard,
  MapPin,
  MessageSquare,
  Send,
  AlertTriangle,
} from "lucide-react"
import { toast } from "sonner"
import supabase from "@/lib/supabase"
import { useCurrentUserProfile } from "@/hooks/useCurrentUserProfile"
import { formatDateBR, formatDateTimeBR, cn } from "@/lib/utils"
import { portalMessageSchema, type PortalMessageValue } from "@/lib/schemas"
import {
  formatRegistrationAnswer,
  getPortalPaymentLabel,
  isRefundEligible,
  parseFlightDetails,
  type ParticipantPortalData,
  type PortalMessage,
} from "@/lib/participantPortal"
import {
  PORTAL_MESSAGE_CLASSES,
  REFUND_STATUS_CONFIG,
  THEME_CLASSES,
} from "@/constants/colors"
import { getServiceTeam, getServiceTeamBadgeStyle } from "@/constants/serviceTeams"
import { Layout } from "@/components/layout/Layout"
import { ChurchLogo } from "@/components/icons/ChurchLogo"
import { ThemeToggle } from "@/components/ThemeToggle"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ParticipantPortalFlightForm } from "@/components/events/ParticipantPortalFlightForm"
import { ParticipantPortalCancelDialog } from "@/components/events/ParticipantPortalCancelDialog"
import { ParticipantQrBadge } from "@/components/events/ParticipantQrBadge"
import type { Database } from "@/lib/database.types"

const GUEST_FIELD_LABELS: Record<string, string> = {
  full_name: "Nome Completo",
  fullName: "Nome Completo",
  email: "E-mail",
  phone: "Telefone / Celular",
  cpf: "CPF",
  birthDate: "Data de Nascimento",
  birth_date: "Data de Nascimento",
  gender: "Sexo / Gênero",
  cityState: "Cidade / Estado",
  city_state: "Cidade / Estado",
}

function normalizePortalPayload(raw: unknown): ParticipantPortalData {
  const payload = raw as Record<string, unknown>
  const regRaw = (payload.registration || {}) as Record<string, unknown>
  const retreatRaw = (payload.retreat || null) as ParticipantPortalData["retreat"]
  const postsRaw = Array.isArray(payload.posts)
    ? (payload.posts as ParticipantPortalData["posts"])
    : []
  const messagesRaw = Array.isArray(payload.messages)
    ? (payload.messages as PortalMessage[])
    : []

  return {
    registration: {
      id: String(regRaw.id || ""),
      retreat_id: (regRaw.retreat_id as string | null) ?? null,
      profile_id: (regRaw.profile_id as string | null) ?? null,
      portal_token: String(regRaw.portal_token || ""),
      qr_token: (regRaw.qr_token as string | null) ?? null,
      status:
        (regRaw.status as "confirmado" | "presente" | "cancelado") ||
        "confirmado",
      paid: Boolean(regRaw.paid),
      payment_method: (regRaw.payment_method as string | null) ?? null,
      payment_reference: (regRaw.payment_reference as string | null) ?? null,
      room_allocation: (regRaw.room_allocation as string | null) ?? null,
      custom_responses:
        (regRaw.custom_responses as Record<string, unknown> | null) ?? null,
      guest_data: (regRaw.guest_data as Record<string, unknown> | null) ?? null,
      notes: (regRaw.notes as string | null) ?? null,
      service_team: (regRaw.service_team as string | null) ?? null,
      checked_in_at: (regRaw.checked_in_at as string | null) ?? null,
      cancellation_reason:
        (regRaw.cancellation_reason as string | null) ?? null,
      cancelled_at: (regRaw.cancelled_at as string | null) ?? null,
      refund_requested: Boolean(regRaw.refund_requested),
      refund_status:
        (regRaw.refund_status as ParticipantPortalData["registration"]["refund_status"]) ??
        null,
      refund_pix_key: (regRaw.refund_pix_key as string | null) ?? null,
      refund_notes: (regRaw.refund_notes as string | null) ?? null,
      refund_requested_at:
        (regRaw.refund_requested_at as string | null) ?? null,
      refund_resolved_at:
        (regRaw.refund_resolved_at as string | null) ?? null,
      flight_details: parseFlightDetails(
        regRaw.flight_details as Parameters<typeof parseFlightDetails>[0]
      ),
      created_at: (regRaw.created_at as string | null) ?? null,
      participant_name: String(regRaw.participant_name || "Participante"),
      participant_email: (regRaw.participant_email as string | null) ?? null,
      participant_phone: (regRaw.participant_phone as string | null) ?? null,
    },
    retreat: retreatRaw,
    posts: postsRaw,
    messages: messagesRaw,
  }
}

export default function ParticipantPortal() {
  const { token, registrationId } = useParams<{
    token?: string
    registrationId?: string
  }>()
  const { user } = useCurrentUserProfile()

  const isTokenRoute = Boolean(token)
  const [portalData, setPortalData] = useState<ParticipantPortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [copiedLink, setCopiedLink] = useState(false)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)

  const messageForm = useForm<PortalMessageValue>({
    resolver: zodResolver(portalMessageSchema),
    defaultValues: {
      message: "",
    },
  })

  const loadPortalData = useCallback(async () => {
    if (!token && !registrationId) {
      setLoadError("Link da área do inscrito inválido ou incompleto.")
      setLoading(false)
      return
    }

    setLoading(true)
    setLoadError(null)
    try {
      const { data, error } = await supabase.rpc("get_participant_portal_data", {
        p_portal_token: token ?? null,
        p_registration_id: token ? null : (registrationId ?? null),
      })

      if (error) throw error
      if (!data) {
        throw new Error("Inscrição não encontrada.")
      }

      setPortalData(normalizePortalPayload(data))
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Não foi possível carregar os dados desta inscrição."
      setLoadError(msg)
      setPortalData(null)
    } finally {
      setLoading(false)
    }
  }, [token, registrationId])

  useEffect(() => {
    loadPortalData()
  }, [loadPortalData])

  const handleCopyPortalLink = async () => {
    if (!portalData?.registration.portal_token) return
    const url = `${window.location.origin}/inscricao/${portalData.registration.portal_token}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedLink(true)
      toast.success("Link exclusivo copiado para a área de transferência!")
      setTimeout(() => setCopiedLink(false), 2500)
    } catch {
      toast.error("Não foi possível copiar o link automaticamente.")
    }
  }

  const handleSendMessage = async (values: PortalMessageValue) => {
    if (!portalData) return
    setSendingMessage(true)
    try {
      const { data, error } = await supabase.rpc(
        "send_participant_portal_message",
        {
          p_portal_token: token ?? portalData.registration.portal_token ?? null,
          p_registration_id:
            token || portalData.registration.portal_token
              ? null
              : (registrationId ?? null),
          p_message: values.message.trim(),
        }
      )

      if (error) throw error

      const result = data as { message?: PortalMessage } | null
      if (result?.message) {
        setPortalData((prev) =>
          prev
            ? {
                ...prev,
                messages: [...prev.messages, result.message!],
              }
            : prev
        )
      } else {
        await loadPortalData()
      }

      messageForm.reset({ message: "" })
      toast.success("Mensagem enviada para a equipe organizadora!")
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Erro ao enviar mensagem."
      toast.error(msg)
    } finally {
      setSendingMessage(false)
    }
  }

  const wrapPage = (content: React.ReactNode) => {
    if (isTokenRoute) {
      if (user) {
        return <Layout>{content}</Layout>
      }
      return (
        <div className={cn("min-h-screen flex flex-col overflow-x-hidden", THEME_CLASSES.background)}>
          <header className="sticky top-0 z-40 border-b border-border/60 bg-card/85 backdrop-blur-md">
            <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
              <Link
                to="/"
                className="flex min-h-[44px] items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChurchLogo size="sm" />
              </Link>
              <div className="flex items-center gap-2">
                <ThemeToggle />
                <Button asChild variant="outline" className="min-h-[44px] px-4">
                  <Link to="/entrar">Entrar</Link>
                </Button>
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
            {content}
          </main>
        </div>
      )
    }

    return content
  }

  if (loading) {
    return wrapPage(
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <Card className={THEME_CLASSES.card}>
          <CardHeader className="flex flex-col gap-3">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Skeleton className="h-6 w-28 rounded-full" />
            <Skeleton className="h-6 w-32 rounded-full" />
          </CardContent>
        </Card>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="flex flex-col gap-6 lg:col-span-7">
            <Skeleton className="h-64 w-full rounded-xl" />
            <Skeleton className="h-56 w-full rounded-xl" />
          </div>
          <div className="flex flex-col gap-6 lg:col-span-5">
            <Skeleton className="h-80 w-full rounded-xl" />
            <Skeleton className="h-44 w-full rounded-xl" />
          </div>
        </div>
      </div>
    )
  }

  if (loadError || !portalData) {
    return wrapPage(
      <div className="mx-auto max-w-lg py-12">
        <Card className={THEME_CLASSES.card}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg font-bold text-foreground">
              <AlertTriangle className="size-5 text-destructive shrink-0" />
              <span>Área do Inscrito Indisponível</span>
            </CardTitle>
            <CardDescription>
              {loadError || "Não foi possível localizar esta inscrição."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Confira se o endereço completo foi copiado corretamente. Caso tenha feito a
              inscrição com sua conta do portal, acesse pelo menu de Eventos.
            </p>
            <div className="flex flex-wrap gap-2">
              {user ? (
                <Button asChild className="min-h-[44px]">
                  <Link to="/eventos">
                    <ArrowLeft data-icon="inline-start" />
                    Ir para Eventos
                  </Link>
                </Button>
              ) : (
                <Button asChild variant="outline" className="min-h-[44px]">
                  <Link to="/">
                    <ArrowLeft data-icon="inline-start" />
                    Voltar ao Início
                  </Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const { registration, retreat, posts, messages } = portalData
  const isCancelled = registration.status === "cancelado"
  const isPresent = registration.status === "presente"
  const refundEligible = isRefundEligible(registration)
  const serviceTeamDef = getServiceTeam(registration.service_team)
  const refundStatusMeta = registration.refund_status
    ? REFUND_STATUS_CONFIG[registration.refund_status]
    : null

  const statusBadgeClass = isCancelled
    ? THEME_CLASSES.badgeRegistrationCancelled
    : isPresent
      ? THEME_CLASSES.badgeRegistrationPresent
      : THEME_CLASSES.badgeRegistrationConfirmed

  const statusLabel = isCancelled
    ? "Cancelada"
    : isPresent
      ? "Presente"
      : "Confirmada"

  const guestEntries = Object.entries(registration.guest_data || {}).filter(
    ([, val]) => val !== null && val !== undefined && String(val).trim() !== ""
  )
  const customEntries = Object.entries(
    registration.custom_responses || {}
  ).filter(
    ([, val]) =>
      val !== null &&
      val !== undefined &&
      (Array.isArray(val) ? val.length > 0 : String(val).trim() !== "")
  )

  const pageBody = (
    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6 pb-16">
      {user && (
        <div className="flex items-center justify-between gap-2">
          <Button asChild variant="ghost" className="min-h-[44px] -ml-2 px-3">
            <Link to="/eventos">
              <ArrowLeft data-icon="inline-start" />
              Voltar para Eventos
            </Link>
          </Button>
        </div>
      )}

      {/* Cabeçalho da Inscrição */}
      <Card className={THEME_CLASSES.card}>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 flex-1 flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={statusBadgeClass}>
                  {statusLabel}
                </Badge>
                <Badge
                  variant="outline"
                  className={
                    registration.paid
                      ? THEME_CLASSES.badgeSuccess
                      : THEME_CLASSES.badgeWarning
                  }
                >
                  {getPortalPaymentLabel(
                    registration.payment_method,
                    registration.paid
                  )}
                </Badge>
                {serviceTeamDef && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "font-semibold",
                      getServiceTeamBadgeStyle(serviceTeamDef.id)
                    )}
                  >
                    Equipe: {serviceTeamDef.shortLabel}
                  </Badge>
                )}
              </div>

              <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl break-words">
                {retreat?.title || "Área do Inscrito"}
              </h1>

              <p className="text-sm font-medium text-foreground break-words">
                Participante: {registration.participant_name}
              </p>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                {retreat?.start_date && (
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="size-3.5 shrink-0" />
                    <span>
                      {formatDateBR(retreat.start_date)}
                      {retreat.end_date
                        ? ` até ${formatDateBR(retreat.end_date)}`
                        : ""}
                    </span>
                  </span>
                )}
                {retreat?.location_text && (
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <MapPin className="size-3.5 shrink-0" />
                    <span className="break-words">{retreat.location_text}</span>
                  </span>
                )}
                {!isCancelled && registration.room_allocation && (
                  <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                    <Bed className="size-3.5 text-primary shrink-0" />
                    <span>Alojamento: {registration.room_allocation}</span>
                  </span>
                )}
              </div>
            </div>

            {registration.portal_token && (
              <Button
                type="button"
                variant="outline"
                onClick={handleCopyPortalLink}
                className="min-h-[44px] w-full md:w-auto shrink-0"
              >
                {copiedLink ? (
                  <Check data-icon="inline-start" />
                ) : (
                  <Copy data-icon="inline-start" />
                )}
                {copiedLink ? "Link Copiado" : "Copiar Link do Portal"}
              </Button>
            )}
          </div>
        </CardHeader>

        {/* Acompanhamento de Cancelamento e Reembolso */}
        {(isCancelled || registration.refund_requested) && (
          <CardContent className="border-t border-border/60 pt-4">
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-foreground flex items-center gap-1.5">
                  <Ban className="size-4 text-destructive shrink-0" />
                  <span>
                    {isCancelled
                      ? "Inscrição cancelada (vaga liberada)"
                      : "Solicitação de Reembolso"}
                  </span>
                </span>
                {refundStatusMeta && (
                  <Badge variant="outline" className={refundStatusMeta.className}>
                    Reembolso: {refundStatusMeta.label}
                  </Badge>
                )}
              </div>

              {registration.cancelled_at && (
                <p className="text-muted-foreground">
                  Cancelada em: {formatDateTimeBR(registration.cancelled_at)}
                </p>
              )}

              {registration.cancellation_reason && (
                <p className="text-foreground break-words">
                  <span className="font-semibold text-muted-foreground">
                    Motivo informado:{" "}
                  </span>
                  {registration.cancellation_reason}
                </p>
              )}

              {registration.refund_requested && (
                <div className="grid grid-cols-1 gap-2 border-t border-border/60 pt-3 sm:grid-cols-2">
                  <div>
                    <span className="block text-muted-foreground">
                      Chave PIX informada
                    </span>
                    <span className="font-mono font-semibold text-foreground break-all">
                      {registration.refund_pix_key || "—"}
                    </span>
                  </div>
                  <div>
                    <span className="block text-muted-foreground">
                      Solicitado em
                    </span>
                    <span className="font-medium text-foreground">
                      {registration.refund_requested_at
                        ? formatDateTimeBR(registration.refund_requested_at)
                        : "—"}
                    </span>
                  </div>
                  {registration.refund_resolved_at && (
                    <div>
                      <span className="block text-muted-foreground">
                        Atualizado em
                      </span>
                      <span className="font-medium text-foreground">
                        {formatDateTimeBR(registration.refund_resolved_at)}
                      </span>
                    </div>
                  )}
                  {registration.refund_notes && (
                    <div className="sm:col-span-2">
                      <span className="block text-muted-foreground">
                        Retorno da organização
                      </span>
                      <span className="font-medium text-foreground break-words">
                        {registration.refund_notes}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Grid Principal Mobile-First */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Coluna Principal */}
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-7">
          {/* 1. Confirmação & Respostas Enviadas */}
          <Card className={THEME_CLASSES.card}>
            <CardHeader className="border-b border-border/60">
              <div className="flex items-center gap-2">
                <ClipboardList className="size-4 text-primary shrink-0" />
                <CardTitle className="text-base font-bold text-foreground">
                  Confirmação e Respostas Enviadas
                </CardTitle>
              </div>
              <CardDescription>
                Confira todos os dados registrados na sua ficha de inscrição.
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-5">
              <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-muted/20 p-3.5 text-xs sm:grid-cols-2">
                <div className="min-w-0">
                  <span className="block text-muted-foreground">
                    Data da Inscrição
                  </span>
                  <span className="font-semibold text-foreground">
                    {registration.created_at
                      ? formatDateTimeBR(registration.created_at)
                      : "Confirmada"}
                  </span>
                </div>
                <div className="min-w-0">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <CreditCard className="size-3.5 shrink-0" />
                    <span>Situação Financeira</span>
                  </span>
                  <span className="font-semibold text-foreground">
                    {getPortalPaymentLabel(
                      registration.payment_method,
                      registration.paid
                    )}
                  </span>
                </div>
                {registration.payment_reference && (
                  <div className="min-w-0 sm:col-span-2">
                    <span className="block text-muted-foreground">
                      Referência / Comprovante
                    </span>
                    <span className="font-mono text-foreground break-all">
                      {registration.payment_reference}
                    </span>
                  </div>
                )}
              </div>

              {guestEntries.length > 0 && (
                <div className="flex flex-col gap-2.5">
                  <h3 className="text-xs font-bold text-foreground">
                    Dados de Identificação
                  </h3>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {guestEntries.map(([key, val]) => (
                      <div
                        key={key}
                        className="min-w-0 rounded-lg border border-border/60 bg-background/60 p-3 text-xs"
                      >
                        <span className="block text-muted-foreground">
                          {GUEST_FIELD_LABELS[key] || key}
                        </span>
                        <span className="font-semibold text-foreground break-words">
                          {formatRegistrationAnswer(val)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {customEntries.length > 0 && (
                <div className="flex flex-col gap-2.5">
                  <h3 className="text-xs font-bold text-foreground">
                    Respostas da Ficha Complementar
                  </h3>
                  <div className="flex flex-col divide-y divide-border/60 rounded-lg border border-border/60 bg-background/60">
                    {customEntries.map(([label, val]) => (
                      <div key={label} className="min-w-0 p-3 text-xs">
                        <span className="block text-muted-foreground break-words">
                          {label}
                        </span>
                        <span className="mt-0.5 block font-semibold text-foreground break-words">
                          {formatRegistrationAnswer(val)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {registration.notes && (
                <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs">
                  <span className="block font-semibold text-muted-foreground">
                    Observações enviadas na inscrição
                  </span>
                  <p className="mt-1 text-foreground whitespace-pre-line break-words">
                    {registration.notes}
                  </p>
                </div>
              )}

              {guestEntries.length === 0 &&
                customEntries.length === 0 &&
                !registration.notes && (
                  <p className="text-xs text-muted-foreground">
                    Sua participação está registrada para{" "}
                    <strong className="text-foreground">
                      {registration.participant_name}
                    </strong>
                    .
                  </p>
                )}
            </CardContent>
          </Card>

          {/* 2. Notícias do Evento */}
          <Card className={THEME_CLASSES.card}>
            <CardHeader className="border-b border-border/60">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Bell className="size-4 text-primary shrink-0" />
                  <CardTitle className="text-base font-bold text-foreground">
                    Notícias e Comunicados do Evento
                  </CardTitle>
                </div>
                {posts.length > 0 && (
                  <Badge variant="secondary">{posts.length}</Badge>
                )}
              </div>
              <CardDescription>
                Orientações, avisos de transporte e comunicados publicados pelos organizadores.
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-3">
              {posts.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-xs text-muted-foreground">
                  Nenhum comunicado publicado para este encontro até o momento.
                </div>
              ) : (
                posts.map((post) => (
                  <article
                    key={post.id}
                    className="flex flex-col gap-2 rounded-lg border border-border/70 bg-background/70 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {post.event_label ? (
                        <Badge variant="outline" className={THEME_CLASSES.badgePrimary}>
                          {post.event_label}
                        </Badge>
                      ) : (
                        <span className="text-xs font-medium text-muted-foreground">
                          Comunicado
                        </span>
                      )}
                      <time className="text-xs text-muted-foreground">
                        {formatDateTimeBR(post.created_at)}
                      </time>
                    </div>
                    <h3 className="text-sm font-bold text-foreground break-words">
                      {post.title}
                    </h3>
                    <p className="whitespace-pre-line text-xs leading-relaxed text-muted-foreground break-words">
                      {post.content}
                    </p>
                  </article>
                ))
              )}
            </CardContent>
          </Card>

          {/* 3. Dados do Voo */}
          <ParticipantPortalFlightForm
            portalToken={token ?? registration.portal_token}
            registrationId={registration.id}
            initialFlightDetails={registration.flight_details}
            isCancelled={isCancelled}
            onSaved={(saved) =>
              setPortalData((prev) =>
                prev
                  ? {
                      ...prev,
                      registration: {
                        ...prev.registration,
                        flight_details: saved,
                      },
                    }
                  : prev
              )
            }
          />
        </div>

        {/* Coluna Lateral / Crachá Digital, Mensagens e Cancelamento */}
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-5">
          {/* 3.5 Crachá Digital (QR Code) */}
          {!isCancelled && (
            <ParticipantQrBadge
              registration={{
                ...(registration as unknown as Database["public"]["Tables"]["registrations"]["Row"]),
                qr_token: registration.qr_token || registration.id,
                retreats: retreat
                  ? (retreat as unknown as Database["public"]["Tables"]["retreats"]["Row"])
                  : null,
              }}
              participantName={registration.participant_name}
            />
          )}

          {/* 4. Mensagens aos Organizadores */}
          <Card className={THEME_CLASSES.card}>
            <CardHeader className="border-b border-border/60">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <MessageSquare className="size-4 text-primary shrink-0" />
                  <CardTitle className="text-base font-bold text-foreground">
                    Mensagens aos Organizadores
                  </CardTitle>
                </div>
                {messages.length > 0 && (
                  <Badge variant="secondary">{messages.length}</Badge>
                )}
              </div>
              <CardDescription>
                Tire dúvidas sobre horários, alimentação, logística ou sua inscrição.
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-4">
              <div className="flex max-h-[380px] flex-col gap-3 overflow-y-auto pr-1 custom-scrollbar">
                {messages.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-xs text-muted-foreground">
                    Nenhuma mensagem enviada ainda. Escreva abaixo caso tenha alguma dúvida.
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isParticipantMsg = msg.sender_role === "participant"
                    return (
                      <div
                        key={msg.id}
                        className={cn(
                          "flex flex-col gap-1 rounded-lg p-3 text-xs",
                          isParticipantMsg
                            ? PORTAL_MESSAGE_CLASSES.participantBubble
                            : PORTAL_MESSAGE_CLASSES.organizerBubble
                        )}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-bold text-foreground">
                            {isParticipantMsg
                              ? `${msg.sender_name} (Você)`
                              : `${msg.sender_name} • Organização`}
                          </span>
                          <time className="text-[11px] text-muted-foreground">
                            {formatDateTimeBR(msg.created_at)}
                          </time>
                        </div>
                        <p className="whitespace-pre-line text-foreground leading-relaxed break-words">
                          {msg.message}
                        </p>
                      </div>
                    )
                  })
                )}
              </div>

              <Separator />

              <form
                onSubmit={messageForm.handleSubmit(handleSendMessage)}
                className="flex flex-col gap-3"
              >
                <FieldGroup>
                  <Field data-invalid={!!messageForm.formState.errors.message}>
                    <FieldLabel htmlFor="portalMessageInput">
                      Enviar dúvida ou mensagem
                    </FieldLabel>
                    <Textarea
                      id="portalMessageInput"
                      placeholder="Escreva sua mensagem para a equipe organizadora..."
                      className="min-h-[92px]"
                      disabled={sendingMessage}
                      aria-invalid={!!messageForm.formState.errors.message}
                      {...messageForm.register("message")}
                    />
                    <FieldError errors={[messageForm.formState.errors.message]} />
                  </Field>
                </FieldGroup>

                <Button
                  type="submit"
                  disabled={sendingMessage}
                  className="min-h-[44px] w-full font-semibold"
                >
                  {sendingMessage ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <Send data-icon="inline-start" />
                  )}
                  {sendingMessage ? "Enviando..." : "Enviar Mensagem"}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* 5. Cancelamento e Reembolso */}
          <Card className={THEME_CLASSES.card}>
            <CardHeader className="border-b border-border/60">
              <div className="flex items-center gap-2">
                <Ban className="size-4 text-destructive shrink-0" />
                <CardTitle className="text-base font-bold text-foreground">
                  Cancelamento e Reembolso
                </CardTitle>
              </div>
              <CardDescription>
                Caso não possa comparecer, cancele sua inscrição para liberar a vaga.
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-4 text-xs">
              {!isCancelled ? (
                <>
                  <p className="text-muted-foreground leading-relaxed">
                    Ao cancelar, sua vaga é liberada imediatamente no evento para que outro
                    irmão possa participar.{" "}
                    {refundEligible
                      ? "Como esta inscrição possui pagamento confirmado, você poderá informar uma chave PIX para solicitar o reembolso."
                      : "Seus dados permanecem preservados no histórico."}
                  </p>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => setCancelDialogOpen(true)}
                    className="min-h-[44px] w-full font-semibold"
                  >
                    <Ban data-icon="inline-start" />
                    {refundEligible
                      ? "Cancelar Inscrição e Solicitar Reembolso"
                      : "Cancelar Inscrição"}
                  </Button>
                </>
              ) : !registration.refund_requested && refundEligible ? (
                <>
                  <p className="text-muted-foreground leading-relaxed">
                    Sua inscrição já foi cancelada. Caso deseje solicitar o estorno do valor
                    pago, informe sua chave PIX abaixo.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCancelDialogOpen(true)}
                    className="min-h-[44px] w-full font-semibold"
                  >
                    Solicitar Reembolso via PIX
                  </Button>
                </>
              ) : (
                <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-muted-foreground">
                  <CheckCircle2 className="size-4 text-primary shrink-0 mt-0.5" />
                  <span>
                    {registration.refund_requested
                      ? "Solicitação de reembolso registrada. Acompanhe a atualização do status no cabeçalho acima."
                      : "Inscrição cancelada e vaga liberada no evento."}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ParticipantPortalCancelDialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        retreatTitle={retreat?.title || "Evento"}
        portalToken={token ?? registration.portal_token}
        registrationId={registration.id}
        refundEligible={refundEligible}
        alreadyCancelled={isCancelled}
        existingReason={registration.cancellation_reason}
        onSuccess={loadPortalData}
      />
    </div>
  )

  return wrapPage(pageBody)
}
