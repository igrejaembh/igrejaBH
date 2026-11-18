import { useCallback, useEffect, useMemo, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  ArrowLeft,
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  MessageSquare,
  Phone,
  Plane,
  Search,
  Send,
  User,
} from "lucide-react"
import { toast } from "sonner"
import supabase from "@/lib/supabase"
import { useCurrentUserProfile } from "@/hooks/useCurrentUserProfile"
import { formatDateTimeBR, cn } from "@/lib/utils"
import {
  manageRefundSchema,
  portalMessageSchema,
  type FlightDetailsValue,
  type ManageRefundValue,
  type PortalMessageValue,
} from "@/lib/schemas"
import {
  formatFlightDateTime,
  getPortalPaymentLabel,
  parseFlightDetails,
  type PortalMessage,
} from "@/lib/participantPortal"
import {
  PORTAL_MESSAGE_CLASSES,
  REFUND_STATUS_CONFIG,
  THEME_CLASSES,
  type RefundStatus,
} from "@/constants/colors"
import type { Database } from "@/lib/database.types"
import type { RegistrationWithDetails } from "@/components/events/RegistrationDetailDialog"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

type Retreat = Database["public"]["Tables"]["retreats"]["Row"]

interface EventParticipantPortalTabProps {
  retreat: Retreat
  registrations: RegistrationWithDetails[]
  onRefreshRegistrations: () => void
  onViewDetails?: (reg: RegistrationWithDetails) => void
  onAttentionCountChange?: (count: number) => void
}

function getRegistrationDisplayInfo(reg: RegistrationWithDetails) {
  const guest = reg.guest_data as Record<string, unknown> | null
  const name =
    reg.profiles?.full_name ||
    (typeof guest?.full_name === "string" ? guest.full_name : null) ||
    (typeof guest?.fullName === "string" ? guest.fullName : null) ||
    "Participante"
  const email =
    reg.profiles?.email ||
    (typeof guest?.email === "string" ? guest.email : null) ||
    null
  const phone =
    reg.profiles?.phone ||
    (typeof guest?.phone === "string" ? guest.phone : null) ||
    null

  return { name, email, phone }
}

export function EventParticipantPortalTab({
  retreat,
  registrations,
  onRefreshRegistrations,
  onViewDetails,
  onAttentionCountChange,
}: EventParticipantPortalTabProps) {
  const { profile } = useCurrentUserProfile()

  const [subTab, setSubTab] = useState<"messages" | "refunds" | "flights">("messages")
  const [messages, setMessages] = useState<PortalMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(true)

  // Mensagens states
  const [selectedRegId, setSelectedRegId] = useState<string | null>(null)
  const [messageFilter, setMessageFilter] = useState<"all" | "unread" | "awaiting">("all")
  const [messageSearch, setMessageSearch] = useState("")
  const [sendingReply, setSendingReply] = useState(false)
  const [startRegId, setStartRegId] = useState<string>("none")

  // Reembolso states
  const [refundFilter, setRefundFilter] = useState<"all" | RefundStatus>("all")
  const [refundSearch, setRefundSearch] = useState("")
  const [editingRefundReg, setEditingRefundReg] =
    useState<RegistrationWithDetails | null>(null)
  const [savingRefund, setSavingRefund] = useState(false)
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null)

  // Voos states
  const [flightSearch, setFlightSearch] = useState("")
  const [transferFilter, setTransferFilter] = useState<"all" | "needs_transfer" | "no_transfer">("all")

  const replyForm = useForm<PortalMessageValue>({
    resolver: zodResolver(portalMessageSchema),
    defaultValues: { message: "" },
  })

  const refundForm = useForm<ManageRefundValue>({
    resolver: zodResolver(manageRefundSchema),
    defaultValues: {
      refundStatus: "em_analise",
      refundNotes: "",
    },
  })

  const fetchMessages = useCallback(async () => {
    setLoadingMessages(true)
    try {
      const { data, error } = await supabase
        .from("retreat_participant_messages")
        .select("*")
        .eq("retreat_id", retreat.id)
        .order("created_at", { ascending: true })

      if (error) throw error
      setMessages(data || [])
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Erro ao carregar mensagens."
      toast.error(msg)
    } finally {
      setLoadingMessages(false)
    }
  }, [retreat.id])

  useEffect(() => {
    fetchMessages()
  }, [fetchMessages])

  const registrationsById = useMemo(() => {
    const map = new Map<string, RegistrationWithDetails>()
    registrations.forEach((r) => map.set(r.id, r))
    return map
  }, [registrations])

  // Agrupamento de conversas por inscrição
  const messageThreads = useMemo(() => {
    const grouped = new Map<string, PortalMessage[]>()
    messages.forEach((m) => {
      const list = grouped.get(m.registration_id) || []
      list.push(m)
      grouped.set(m.registration_id, list)
    })

    if (selectedRegId && !grouped.has(selectedRegId)) {
      grouped.set(selectedRegId, [])
    }

    return Array.from(grouped.entries())
      .map(([regId, threadMsgs]) => {
        const reg = registrationsById.get(regId)
        const info = reg
          ? getRegistrationDisplayInfo(reg)
          : {
              name: threadMsgs[0]?.sender_name || "Participante",
              email: null,
              phone: null,
            }
        const unreadCount = threadMsgs.filter(
          (m) => m.sender_role === "participant" && !m.read_at
        ).length
        const lastMessage =
          threadMsgs.length > 0 ? threadMsgs[threadMsgs.length - 1] : null
        const awaitingReply = lastMessage?.sender_role === "participant"

        return {
          regId,
          reg,
          info,
          messages: threadMsgs,
          unreadCount,
          lastMessage,
          awaitingReply,
        }
      })
      .sort((a, b) => {
        if (a.unreadCount !== b.unreadCount) return b.unreadCount - a.unreadCount
        const aTime = a.lastMessage?.created_at || ""
        const bTime = b.lastMessage?.created_at || ""
        return bTime.localeCompare(aTime)
      })
  }, [messages, registrationsById, selectedRegId])

  const filteredThreads = useMemo(() => {
    return messageThreads.filter((t) => {
      if (messageFilter === "unread" && t.unreadCount === 0) return false
      if (messageFilter === "awaiting" && !t.awaitingReply) return false
      if (messageSearch.trim()) {
        const q = messageSearch.toLowerCase()
        const matchName = t.info.name.toLowerCase().includes(q)
        const matchEmail = (t.info.email || "").toLowerCase().includes(q)
        const matchText = t.messages.some((m) =>
          m.message.toLowerCase().includes(q)
        )
        if (!matchName && !matchEmail && !matchText) return false
      }
      return true
    })
  }, [messageThreads, messageFilter, messageSearch])

  const unreadMessagesTotal = useMemo(
    () =>
      messages.filter((m) => m.sender_role === "participant" && !m.read_at)
        .length,
    [messages]
  )

  const refundRequests = useMemo(() => {
    return registrations
      .filter((r) => r.refund_requested)
      .sort((a, b) =>
        (b.refund_requested_at || b.created_at || "").localeCompare(
          a.refund_requested_at || a.created_at || ""
        )
      )
  }, [registrations])

  const pendingRefundsCount = useMemo(
    () =>
      refundRequests.filter(
        (r) => r.refund_status === "pendente" || r.refund_status === "em_analise"
      ).length,
    [refundRequests]
  )

  useEffect(() => {
    onAttentionCountChange?.(unreadMessagesTotal + pendingRefundsCount)
  }, [unreadMessagesTotal, pendingRefundsCount, onAttentionCountChange])

  const filteredRefunds = useMemo(() => {
    return refundRequests.filter((reg) => {
      if (refundFilter !== "all" && reg.refund_status !== refundFilter) {
        return false
      }
      if (refundSearch.trim()) {
        const q = refundSearch.toLowerCase()
        const info = getRegistrationDisplayInfo(reg)
        const matchName = info.name.toLowerCase().includes(q)
        const matchEmail = (info.email || "").toLowerCase().includes(q)
        const matchPix = (reg.refund_pix_key || "").toLowerCase().includes(q)
        if (!matchName && !matchEmail && !matchPix) return false
      }
      return true
    })
  }, [refundRequests, refundFilter, refundSearch])

  const flightRegistrations = useMemo(() => {
    return registrations
      .map((reg) => ({
        reg,
        info: getRegistrationDisplayInfo(reg),
        flight: parseFlightDetails(reg.flight_details),
      }))
      .filter(
        (
          item
        ): item is {
          reg: RegistrationWithDetails
          info: { name: string; email: string | null; phone: string | null }
          flight: FlightDetailsValue
        } => Boolean(item.flight) && (item.reg.status || "confirmado") !== "cancelado"
      )
      .sort((a, b) =>
        (a.flight.arrivalDateTime || "").localeCompare(
          b.flight.arrivalDateTime || ""
        )
      )
  }, [registrations])

  const filteredFlights = useMemo(() => {
    return flightRegistrations.filter((item) => {
      if (transferFilter === "needs_transfer" && !item.flight.needsAirportTransfer) {
        return false
      }
      if (transferFilter === "no_transfer" && item.flight.needsAirportTransfer) {
        return false
      }
      if (flightSearch.trim()) {
        const q = flightSearch.toLowerCase()
        const matchName = item.info.name.toLowerCase().includes(q)
        const matchAirline = item.flight.arrivalAirline.toLowerCase().includes(q)
        const matchFlightNo = item.flight.arrivalFlightNumber
          .toLowerCase()
          .includes(q)
        const matchAirport = item.flight.arrivalAirport.toLowerCase().includes(q)
        if (!matchName && !matchAirline && !matchFlightNo && !matchAirport) {
          return false
        }
      }
      return true
    })
  }, [flightRegistrations, transferFilter, flightSearch])

  const selectedThread = useMemo(
    () => messageThreads.find((t) => t.regId === selectedRegId) || null,
    [messageThreads, selectedRegId]
  )

  // Marcar mensagens de participante como lidas ao selecionar conversa
  const markThreadAsRead = useCallback(async (regId: string, threadMsgs: PortalMessage[]) => {
    const unreadIds = threadMsgs
      .filter((m) => m.sender_role === "participant" && !m.read_at)
      .map((m) => m.id)

    if (unreadIds.length === 0) return

    const nowIso = new Date().toISOString()
    const { error } = await supabase
      .from("retreat_participant_messages")
      .update({ read_at: nowIso })
      .eq("registration_id", regId)
      .in("id", unreadIds)

    if (!error) {
      setMessages((prev) =>
        prev.map((m) =>
          unreadIds.includes(m.id) ? { ...m, read_at: nowIso } : m
        )
      )
    }
  }, [])

  const handleSelectThread = (regId: string) => {
    setSelectedRegId(regId)
    const thread = messageThreads.find((t) => t.regId === regId)
    if (thread) {
      markThreadAsRead(regId, thread.messages)
    }
  }

  const handleSendReply = async (values: PortalMessageValue) => {
    if (!selectedRegId) return
    setSendingReply(true)
    try {
      const { data, error } = await supabase
        .from("retreat_participant_messages")
        .insert({
          retreat_id: retreat.id,
          registration_id: selectedRegId,
          sender_role: "organizer",
          sender_profile_id: profile?.id || null,
          sender_name: profile?.full_name || "Organização",
          message: values.message.trim(),
        })
        .select("*")
        .single()

      if (error) throw error

      if (data) {
        setMessages((prev) => [...prev, data])
      } else {
        await fetchMessages()
      }

      replyForm.reset({ message: "" })
      toast.success("Resposta enviada ao participante!")
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Erro ao enviar resposta."
      toast.error(msg)
    } finally {
      setSendingReply(false)
    }
  }

  const handleOpenRefundModal = (reg: RegistrationWithDetails) => {
    setEditingRefundReg(reg)
    refundForm.reset({
      refundStatus: reg.refund_status || "em_analise",
      refundNotes: reg.refund_notes || "",
    })
  }

  const handleSaveRefundUpdate = async (values: ManageRefundValue) => {
    if (!editingRefundReg) return
    setSavingRefund(true)
    try {
      const isResolved =
        values.refundStatus === "aprovado" ||
        values.refundStatus === "recusado" ||
        values.refundStatus === "reembolsado"

      const { error } = await supabase
        .from("registrations")
        .update({
          refund_status: values.refundStatus,
          refund_notes: values.refundNotes?.trim() || null,
          refund_resolved_at: isResolved ? new Date().toISOString() : null,
        })
        .eq("id", editingRefundReg.id)

      if (error) throw error

      toast.success("Solicitação de reembolso atualizada!")
      setEditingRefundReg(null)
      onRefreshRegistrations()
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Erro ao atualizar reembolso."
      toast.error(msg)
    } finally {
      setSavingRefund(false)
    }
  }

  const handleCopyText = async (keyId: string, text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKeyId(keyId)
      toast.success(`${label} copiado!`)
      setTimeout(() => setCopiedKeyId(null), 2000)
    } catch {
      toast.error("Não foi possível copiar automaticamente.")
    }
  }

  const registrationsWithoutThread = useMemo(() => {
    const existingIds = new Set(messages.map((m) => m.registration_id))
    return registrations.filter((r) => !existingIds.has(r.id))
  }, [registrations, messages])

  return (
    <div className="flex flex-col gap-6">
      {/* Resumo Superior */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card size="sm" className={THEME_CLASSES.card}>
          <CardHeader>
            <CardDescription>Mensagens Não Lidas</CardDescription>
            <CardTitle className="text-xl font-bold text-foreground">
              {unreadMessagesTotal}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm" className={THEME_CLASSES.card}>
          <CardHeader>
            <CardDescription>Reembolsos Pendentes / Em Análise</CardDescription>
            <CardTitle className="text-xl font-bold text-foreground">
              {pendingRefundsCount}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm" className={THEME_CLASSES.card}>
          <CardHeader>
            <CardDescription>Voos Registrados</CardDescription>
            <CardTitle className="text-xl font-bold text-foreground">
              {flightRegistrations.length}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Tabs
        value={subTab}
        onValueChange={(val) =>
          setSubTab(val as "messages" | "refunds" | "flights")
        }
        className="flex flex-col gap-4"
      >
        <TabsList className="w-full justify-start overflow-x-auto h-auto p-1">
          <TabsTrigger value="messages" className="min-h-[44px] px-4">
            <MessageSquare data-icon="inline-start" />
            <span>
              Mensagens {unreadMessagesTotal > 0 ? `(${unreadMessagesTotal})` : ""}
            </span>
          </TabsTrigger>
          <TabsTrigger value="refunds" className="min-h-[44px] px-4">
            <CreditCard data-icon="inline-start" />
            <span>
              Reembolsos {refundRequests.length > 0 ? `(${refundRequests.length})` : ""}
            </span>
          </TabsTrigger>
          <TabsTrigger value="flights" className="min-h-[44px] px-4">
            <Plane data-icon="inline-start" />
            <span>Voos ({flightRegistrations.length})</span>
          </TabsTrigger>
        </TabsList>

        {/* SUB-TAB 1: MENSAGENS */}
        <TabsContent value="messages" className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-1 flex-col gap-2 sm:flex-row">
              <div className="relative flex-1 max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={messageSearch}
                  onChange={(e) => setMessageSearch(e.target.value)}
                  placeholder="Buscar por participante ou mensagem..."
                  className="min-h-[44px] pl-9"
                />
              </div>

              <Select
                value={messageFilter}
                onValueChange={(val) =>
                  setMessageFilter(val as "all" | "unread" | "awaiting")
                }
              >
                <SelectTrigger className="min-h-[44px] w-full sm:w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">Todas as conversas</SelectItem>
                    <SelectItem value="unread">Não lidas</SelectItem>
                    <SelectItem value="awaiting">Aguardando resposta</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            {registrationsWithoutThread.length > 0 && (
              <div className="flex items-center gap-2">
                <Select
                  value={startRegId}
                  onValueChange={(val) => {
                    setStartRegId(val)
                    if (val !== "none") {
                      setSelectedRegId(val)
                    }
                  }}
                >
                  <SelectTrigger className="min-h-[44px] w-full sm:w-64">
                    <SelectValue placeholder="Iniciar conversa com inscrito..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="none">
                        Iniciar conversa com inscrito...
                      </SelectItem>
                      {registrationsWithoutThread.map((r) => {
                        const info = getRegistrationDisplayInfo(r)
                        return (
                          <SelectItem key={r.id} value={r.id}>
                            {info.name}
                          </SelectItem>
                        )
                      })}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {loadingMessages ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <Skeleton className="h-72 rounded-xl lg:col-span-5" />
              <Skeleton className="h-72 rounded-xl lg:col-span-7" />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              {/* Lista de Conversas */}
              <Card
                className={cn(
                  THEME_CLASSES.card,
                  "lg:col-span-5",
                  selectedThread ? "hidden lg:flex" : "flex"
                )}
              >
                <CardHeader className="border-b border-border/60">
                  <CardTitle className="text-sm font-bold">
                    Conversas ({filteredThreads.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex max-h-[460px] flex-col gap-2 overflow-y-auto custom-scrollbar">
                  {filteredThreads.length === 0 ? (
                    <p className="py-8 text-center text-xs text-muted-foreground">
                      Nenhuma conversa encontrada com os filtros atuais.
                    </p>
                  ) : (
                    filteredThreads.map((thread) => {
                      const isSelected = thread.regId === selectedRegId
                      return (
                        <button
                          key={thread.regId}
                          type="button"
                          onClick={() => handleSelectThread(thread.regId)}
                          className={cn(
                            "flex min-h-[44px] w-full flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors cursor-pointer",
                            isSelected
                              ? "border-primary bg-primary/5"
                              : "border-border/70 bg-background hover:bg-muted/40"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-xs text-foreground truncate">
                              {thread.info.name}
                            </span>
                            {thread.unreadCount > 0 && (
                              <Badge
                                variant="outline"
                                className={THEME_CLASSES.badgeWarning}
                              >
                                {thread.unreadCount} nova
                                {thread.unreadCount > 1 ? "s" : ""}
                              </Badge>
                            )}
                          </div>
                          {thread.lastMessage ? (
                            <>
                              <p className="line-clamp-2 text-xs text-muted-foreground break-words">
                                {thread.lastMessage.sender_role === "organizer"
                                  ? "Organização: "
                                  : ""}
                                {thread.lastMessage.message}
                              </p>
                              <span className="text-[11px] text-muted-foreground">
                                {formatDateTimeBR(thread.lastMessage.created_at)}
                              </span>
                            </>
                          ) : (
                            <span className="text-xs italic text-muted-foreground">
                              Nova conversa iniciada
                            </span>
                          )}
                        </button>
                      )
                    })
                  )}
                </CardContent>
              </Card>

              {/* Painel de Conversa */}
              <Card
                className={cn(
                  THEME_CLASSES.card,
                  "lg:col-span-7",
                  selectedThread ? "flex" : "hidden lg:flex"
                )}
              >
                {!selectedThread ? (
                  <CardContent className="flex min-h-[320px] items-center justify-center text-center text-xs text-muted-foreground">
                    Selecione uma conversa ao lado para visualizar o histórico e responder ao participante.
                  </CardContent>
                ) : (
                  <>
                    <CardHeader className="border-b border-border/60">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setSelectedRegId(null)}
                            className="min-h-[44px] min-w-[44px] lg:hidden"
                            aria-label="Voltar para lista de conversas"
                          >
                            <ArrowLeft />
                          </Button>
                          <div className="min-w-0">
                            <CardTitle className="text-sm font-bold text-foreground truncate">
                              {selectedThread.info.name}
                            </CardTitle>
                            <CardDescription className="truncate">
                              {selectedThread.info.email ||
                                selectedThread.info.phone ||
                                "Participante do evento"}
                            </CardDescription>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {selectedThread.reg?.portal_token && (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() =>
                                handleCopyText(
                                  `portal-${selectedThread.regId}`,
                                  `${window.location.origin}/inscricao/${selectedThread.reg!.portal_token}`,
                                  "Link do portal"
                                )
                              }
                              className="min-h-[44px] px-3"
                            >
                              {copiedKeyId === `portal-${selectedThread.regId}` ? (
                                <Check data-icon="inline-start" />
                              ) : (
                                <Copy data-icon="inline-start" />
                              )}
                              Link do Inscrito
                            </Button>
                          )}
                          {selectedThread.reg && onViewDetails && (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => onViewDetails(selectedThread.reg!)}
                              className="min-h-[44px] px-3"
                            >
                              <ExternalLink data-icon="inline-start" />
                              Ficha
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent className="flex flex-col gap-4">
                      <div className="flex max-h-[340px] flex-col gap-3 overflow-y-auto pr-1 custom-scrollbar">
                        {selectedThread.messages.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-xs text-muted-foreground">
                            Envie a primeira mensagem para este participante abaixo.
                          </div>
                        ) : (
                          selectedThread.messages.map((msg) => {
                            const isOrg = msg.sender_role === "organizer"
                            return (
                              <div
                                key={msg.id}
                                className={cn(
                                  "flex flex-col gap-1 rounded-lg p-3 text-xs",
                                  isOrg
                                    ? PORTAL_MESSAGE_CLASSES.participantBubble
                                    : PORTAL_MESSAGE_CLASSES.organizerBubble
                                )}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-bold text-foreground">
                                    {isOrg
                                      ? `${msg.sender_name} (Organização)`
                                      : `${msg.sender_name} (Inscrito)`}
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
                        onSubmit={replyForm.handleSubmit(handleSendReply)}
                        className="flex flex-col gap-3"
                      >
                        <FieldGroup>
                          <Field data-invalid={!!replyForm.formState.errors.message}>
                            <FieldLabel htmlFor="organizerReplyInput">
                              Responder participante
                            </FieldLabel>
                            <Textarea
                              id="organizerReplyInput"
                              placeholder="Digite sua resposta para o participante..."
                              className="min-h-[88px]"
                              disabled={sendingReply}
                              aria-invalid={!!replyForm.formState.errors.message}
                              {...replyForm.register("message")}
                            />
                            <FieldError
                              errors={[replyForm.formState.errors.message]}
                            />
                          </Field>
                        </FieldGroup>

                        <div className="flex justify-end">
                          <Button
                            type="submit"
                            disabled={sendingReply}
                            className="min-h-[44px] w-full sm:w-auto px-5 font-semibold"
                          >
                            {sendingReply ? (
                              <Spinner data-icon="inline-start" />
                            ) : (
                              <Send data-icon="inline-start" />
                            )}
                            {sendingReply ? "Enviando..." : "Enviar Resposta"}
                          </Button>
                        </div>
                      </form>
                    </CardContent>
                  </>
                )}
              </Card>
            </div>
          )}
        </TabsContent>

        {/* SUB-TAB 2: REEMBOLSOS */}
        <TabsContent value="refunds" className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={refundSearch}
                onChange={(e) => setRefundSearch(e.target.value)}
                placeholder="Buscar por nome, e-mail ou PIX..."
                className="min-h-[44px] pl-9"
              />
            </div>

            <Select
              value={refundFilter}
              onValueChange={(val) =>
                setRefundFilter(val as "all" | RefundStatus)
              }
            >
              <SelectTrigger className="min-h-[44px] w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">Todos os status</SelectItem>
                  <SelectItem value="pendente">Pendente</SelectItem>
                  <SelectItem value="em_analise">Em Análise</SelectItem>
                  <SelectItem value="aprovado">Aprovado</SelectItem>
                  <SelectItem value="recusado">Recusado</SelectItem>
                  <SelectItem value="reembolsado">Reembolsado</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {filteredRefunds.length === 0 ? (
            <Card className={THEME_CLASSES.card}>
              <CardContent className="py-10 text-center text-xs text-muted-foreground">
                Nenhuma solicitação de reembolso encontrada para este filtro.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {filteredRefunds.map((reg) => {
                const info = getRegistrationDisplayInfo(reg)
                const statusMeta = reg.refund_status
                  ? REFUND_STATUS_CONFIG[reg.refund_status]
                  : REFUND_STATUS_CONFIG.pendente

                return (
                  <Card key={reg.id} className={THEME_CLASSES.card}>
                    <CardHeader className="border-b border-border/60">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <CardTitle className="text-sm font-bold text-foreground break-words">
                            {info.name}
                          </CardTitle>
                          <CardDescription className="break-words">
                            {info.email || info.phone || "Sem contato"}
                          </CardDescription>
                        </div>
                        <Badge variant="outline" className={statusMeta.className}>
                          {statusMeta.label}
                        </Badge>
                      </div>
                    </CardHeader>

                    <CardContent className="flex flex-col gap-3 text-xs">
                      <div className="flex flex-col gap-1">
                        <span className="text-muted-foreground">Chave PIX</span>
                        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                          <span className="font-mono font-semibold text-foreground break-all">
                            {reg.refund_pix_key || "Não informada"}
                          </span>
                          {reg.refund_pix_key && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                handleCopyText(
                                  `pix-${reg.id}`,
                                  reg.refund_pix_key!,
                                  "Chave PIX"
                                )
                              }
                              className="min-h-[44px] min-w-[44px] shrink-0"
                              aria-label="Copiar chave PIX"
                            >
                              {copiedKeyId === `pix-${reg.id}` ? (
                                <Check />
                              ) : (
                                <Copy />
                              )}
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div>
                          <span className="block text-muted-foreground">
                            Pagamento
                          </span>
                          <span className="font-medium text-foreground">
                            {getPortalPaymentLabel(reg.payment_method, reg.paid)}
                          </span>
                        </div>
                        <div>
                          <span className="block text-muted-foreground">
                            Solicitado em
                          </span>
                          <span className="font-medium text-foreground">
                            {reg.refund_requested_at
                              ? formatDateTimeBR(reg.refund_requested_at)
                              : "—"}
                          </span>
                        </div>
                      </div>

                      {reg.cancellation_reason && (
                        <div>
                          <span className="block text-muted-foreground">
                            Motivo do cancelamento
                          </span>
                          <p className="mt-0.5 text-foreground break-words">
                            {reg.cancellation_reason}
                          </p>
                        </div>
                      )}

                      {reg.refund_notes && (
                        <div className="rounded-md border border-border bg-muted/20 p-2.5">
                          <span className="block text-muted-foreground">
                            Observações da organização
                          </span>
                          <p className="mt-0.5 text-foreground break-words">
                            {reg.refund_notes}
                          </p>
                        </div>
                      )}

                      <div className="flex flex-wrap justify-end gap-2 pt-1">
                        {onViewDetails && (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => onViewDetails(reg)}
                            className="min-h-[44px] flex-1 sm:flex-none"
                          >
                            Ver Ficha
                          </Button>
                        )}
                        <Button
                          type="button"
                          onClick={() => handleOpenRefundModal(reg)}
                          className="min-h-[44px] flex-1 sm:flex-none font-semibold"
                        >
                          Gerenciar Reembolso
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </TabsContent>

        {/* SUB-TAB 3: VOOS */}
        <TabsContent value="flights" className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={flightSearch}
                onChange={(e) => setFlightSearch(e.target.value)}
                placeholder="Buscar por participante, companhia, voo ou aeroporto..."
                className="min-h-[44px] pl-9"
              />
            </div>

            <Select
              value={transferFilter}
              onValueChange={(val) =>
                setTransferFilter(
                  val as "all" | "needs_transfer" | "no_transfer"
                )
              }
            >
              <SelectTrigger className="min-h-[44px] w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">Todos os voos</SelectItem>
                  <SelectItem value="needs_transfer">
                    Precisa de traslado
                  </SelectItem>
                  <SelectItem value="no_transfer">Sem traslado</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {filteredFlights.length === 0 ? (
            <Card className={THEME_CLASSES.card}>
              <CardContent className="py-10 text-center text-xs text-muted-foreground">
                Nenhum dado de voo cadastrado pelos participantes até o momento.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {filteredFlights.map(({ reg, info, flight }) => (
                <Card key={reg.id} className={THEME_CLASSES.card}>
                  <CardHeader className="border-b border-border/60">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="flex items-center gap-1.5 text-sm font-bold text-foreground break-words">
                          <User className="size-3.5 text-primary shrink-0" />
                          <span>{info.name}</span>
                        </CardTitle>
                        {info.phone && (
                          <CardDescription className="flex items-center gap-1 mt-0.5">
                            <Phone className="size-3 shrink-0" />
                            <span>{info.phone}</span>
                          </CardDescription>
                        )}
                      </div>

                      {flight.needsAirportTransfer ? (
                        <Badge variant="outline" className={THEME_CLASSES.badgeInfo}>
                          Precisa de Traslado
                        </Badge>
                      ) : (
                        <Badge variant="outline" className={THEME_CLASSES.badgeNeutral}>
                          Sem Traslado
                        </Badge>
                      )}
                    </div>
                  </CardHeader>

                  <CardContent className="flex flex-col gap-3 text-xs">
                    <div className="rounded-lg border border-border bg-muted/20 p-3 flex flex-col gap-1">
                      <span className="font-bold text-foreground">
                        Chegada: {flight.arrivalAirline} {flight.arrivalFlightNumber} ({flight.arrivalAirport})
                      </span>
                      <span className="text-muted-foreground">
                        {formatFlightDateTime(flight.arrivalDateTime)}
                      </span>
                    </div>

                    {(flight.departureAirline ||
                      flight.departureFlightNumber ||
                      flight.departureDateTime) && (
                      <div className="rounded-lg border border-border/70 bg-background p-3 flex flex-col gap-1">
                        <span className="font-semibold text-foreground">
                          Retorno:{" "}
                          {[flight.departureAirline, flight.departureFlightNumber]
                            .filter(Boolean)
                            .join(" ") || "Não informado"}
                        </span>
                        {flight.departureDateTime && (
                          <span className="text-muted-foreground">
                            {formatFlightDateTime(flight.departureDateTime)}
                          </span>
                        )}
                      </div>
                    )}

                    {flight.notes && (
                      <p className="text-muted-foreground break-words">
                        <span className="font-semibold text-foreground">Obs: </span>
                        {flight.notes}
                      </p>
                    )}

                    {onViewDetails && (
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => onViewDetails(reg)}
                          className="min-h-[44px] w-full sm:w-auto"
                        >
                          Ver Ficha Completa
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Modal de Gestão de Reembolso */}
      <Dialog
        open={!!editingRefundReg}
        onOpenChange={(open) => !open && setEditingRefundReg(null)}
      >
        <DialogContent size="md" className="p-5 sm:p-6">
          <DialogHeader>
            <DialogTitle>Gerenciar Solicitação de Reembolso</DialogTitle>
            <DialogDescription>
              {editingRefundReg
                ? `Participante: ${getRegistrationDisplayInfo(editingRefundReg).name}`
                : ""}
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={refundForm.handleSubmit(handleSaveRefundUpdate)}
            className="flex flex-col gap-4"
          >
            {editingRefundReg?.refund_pix_key && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
                <span className="block text-muted-foreground">Chave PIX</span>
                <span className="font-mono font-bold text-foreground break-all">
                  {editingRefundReg.refund_pix_key}
                </span>
              </div>
            )}

            <FieldGroup>
              <Field data-invalid={!!refundForm.formState.errors.refundStatus}>
                <FieldLabel htmlFor="refundStatusSelect">
                  Situação do Reembolso
                </FieldLabel>
                <Controller
                  control={refundForm.control}
                  name="refundStatus"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger
                        id="refundStatusSelect"
                        className="min-h-[44px] w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="pendente">Pendente</SelectItem>
                          <SelectItem value="em_analise">Em Análise</SelectItem>
                          <SelectItem value="aprovado">Aprovado</SelectItem>
                          <SelectItem value="recusado">Recusado</SelectItem>
                          <SelectItem value="reembolsado">Reembolsado</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError errors={[refundForm.formState.errors.refundStatus]} />
              </Field>

              <Field data-invalid={!!refundForm.formState.errors.refundNotes}>
                <FieldLabel htmlFor="refundNotesInput">
                  Observações para o participante (opcional)
                </FieldLabel>
                <Textarea
                  id="refundNotesInput"
                  placeholder="Ex: Transferência PIX realizada em 16/11, comprovante #1234..."
                  className="min-h-[96px]"
                  disabled={savingRefund}
                  aria-invalid={!!refundForm.formState.errors.refundNotes}
                  {...refundForm.register("refundNotes")}
                />
                <FieldError errors={[refundForm.formState.errors.refundNotes]} />
              </Field>
            </FieldGroup>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingRefundReg(null)}
                disabled={savingRefund}
                className="min-h-[44px]"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={savingRefund}
                className="min-h-[44px] font-semibold"
              >
                {savingRefund && <Spinner data-icon="inline-start" />}
                {savingRefund ? "Salvando..." : "Salvar Atualização"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
