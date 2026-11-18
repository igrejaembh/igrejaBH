import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Search,
  X,
  UserCheck,
  Clock,
  Users,
  Bed,
  Phone,
  RotateCcw,
  CheckCircle2,
  Loader2,
  FileText,
  HeartHandshake,
  QrCode,
  Printer,
  ListChecks,
  Check,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import supabase from "@/lib/supabase";
import type { Json } from "@/lib/database.types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ChurchAvatar } from "@/components/ui/church-avatar";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatTimeBR } from "@/lib/utils";
import { getServiceTeam, getServiceTeamBadgeStyle } from "@/constants/serviceTeams";
import { CHECKIN_FLAG_CLASSES } from "@/constants/colors";
import {
  DEFAULT_CHECKIN_CHECKLIST,
  parseCheckinFlags,
  type CheckinChecklistItem,
  type CheckinFlagsMap,
} from "@/lib/checkinFlags";
import { CheckinChecklistConfigDialog } from "@/components/events/CheckinChecklistConfigEditor";
import { QrScannerDialog } from "@/components/events/QrScannerDialog";
import { EventBadgePrintDialog } from "@/components/events/EventBadgePrintDialog";
import type { RegistrationWithDetails } from "@/components/events/RegistrationDetailDialog";
import type { RetreatRoom } from "@/components/events/RoomManagementTab";

interface EventCheckInTabProps {
  retreatId?: string;
  retreatTitle: string;
  retreatStartDate?: string | null;
  retreatEndDate?: string | null;
  retreatLocation?: string | null;
  registrations: RegistrationWithDetails[];
  retreatRooms: RetreatRoom[];
  checklistConfig?: CheckinChecklistItem[];
  homeGroupsMap?: Map<string, string>;
  onUpdateRegistration: (updated: RegistrationWithDetails) => void;
  onRefreshRegistrations?: () => void;
  onViewDetails?: (registration: RegistrationWithDetails) => void;
  onChecklistConfigUpdated?: (nextConfig: CheckinChecklistItem[]) => void;
  onUpdateCheckinFlags?: (
    regId: string,
    flags: CheckinFlagsMap
  ) => Promise<void> | void;
}

type QuickFilter = "all" | "present" | "pending";

/**
 * Normaliza strings para busca insensível a maiúsculas e acentuação.
 */
function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Formata CPF para exibição limpa.
 */
function formatCpf(cpf?: string | null): string {
  if (!cpf) return "";
  const cleaned = cpf.replace(/\D/g, "");
  if (cleaned.length === 11) {
    return `${cleaned.slice(0, 3)}.${cleaned.slice(3, 6)}.${cleaned.slice(6, 9)}-${cleaned.slice(9)}`;
  }
  return cpf;
}

export function EventCheckInTab({
  retreatId,
  retreatTitle,
  retreatStartDate,
  retreatEndDate,
  retreatLocation,
  registrations,
  retreatRooms,
  checklistConfig,
  homeGroupsMap,
  onUpdateRegistration,
  onRefreshRegistrations,
  onViewDetails,
  onChecklistConfigUpdated,
  onUpdateCheckinFlags,
}: EventCheckInTabProps) {
  // Estado da busca com debounce
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Filtro rápido de status e filtro de flags
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [flagFilter, setFlagFilter] = useState<string>("all");

  // ID da inscrição atualmente sofrendo mutação de check-in ou flag
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [savingFlagId, setSavingFlagId] = useState<string | null>(null);

  // Destaque de participante recém-escaneado via QR Code
  const [highlightedRegId, setHighlightedRegId] = useState<string | null>(null);

  // Diálogos de Portaria (QR Scanner, Emissão de Crachás, Configuração de Checklist)
  const [isQrScannerOpen, setIsQrScannerOpen] = useState(false);
  const [isBadgePrintOpen, setIsBadgePrintOpen] = useState(false);
  const [isChecklistConfigOpen, setIsChecklistConfigOpen] = useState(false);

  // Perfil do operador de recepção logado
  const [operatorProfileId, setOperatorProfileId] = useState<string | null>(null);

  const effectiveChecklist = useMemo(
    () =>
      checklistConfig !== undefined
        ? checklistConfig
        : DEFAULT_CHECKIN_CHECKLIST,
    [checklistConfig]
  );

  // Carrega o perfil do operador logado para associar a checked_in_by
  useEffect(() => {
    async function loadOperator() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.user) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("id")
            .eq("user_id", session.user.id)
            .maybeSingle();
          if (profile) {
            setOperatorProfileId(profile.id);
          }
        }
      } catch (err) {
        console.warn("Não foi possível carregar o perfil do operador:", err);
      }
    }
    loadOperator();
  }, []);

  // Debounce do input de busca (250ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchInput);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Inscrições ativas para credenciamento (exclui cancelados)
  const activeRegistrations = useMemo(
    () => registrations.filter((r) => (r.status || "confirmado") !== "cancelado"),
    [registrations]
  );

  // Contadores e Métricas ao Vivo
  const totalCount = activeRegistrations.length;
  const presentCount = useMemo(
    () => activeRegistrations.filter((r) => Boolean(r.checked_in_at) || r.status === "presente").length,
    [activeRegistrations]
  );
  const pendingCount = totalCount - presentCount;
  const percentagePresent = totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0;

  // Contadores por item da checklist configurada
  const flagStats = useMemo(() => {
    return effectiveChecklist.map((item) => {
      const doneCount = activeRegistrations.filter((reg) => {
        const flags = parseCheckinFlags(reg.checkin_flags);
        return Boolean(flags[item.key]);
      }).length;
      return {
        ...item,
        doneCount,
        pendingCount: Math.max(0, totalCount - doneCount),
      };
    });
  }, [effectiveChecklist, activeRegistrations, totalCount]);

  // Filtragem reactiva com normalização de texto, CPF, telefone e flags
  const filteredRegistrations = useMemo(() => {
    const queryNormalized = normalizeText(debouncedQuery);
    const digitsOnlyQuery = debouncedQuery.replace(/\D/g, "");

    const matched = activeRegistrations.filter((reg) => {
      // 1. Filtro rápido de status
      const isPresent = Boolean(reg.checked_in_at) || reg.status === "presente";
      if (quickFilter === "present" && !isPresent) return false;
      if (quickFilter === "pending" && isPresent) return false;

      // 2. Filtro de item da checklist
      if (flagFilter !== "all") {
        const flags = parseCheckinFlags(reg.checkin_flags);
        if (flagFilter.startsWith("done:")) {
          const key = flagFilter.slice(5);
          if (!flags[key]) return false;
        } else if (flagFilter.startsWith("pending:")) {
          const key = flagFilter.slice(8);
          if (flags[key]) return false;
        }
      }

      // 3. Filtro de busca
      if (!queryNormalized) return true;

      const profileName = reg.profiles?.full_name || "";
      const guestName =
        (reg.guest_data as { full_name?: string } | null)?.full_name || "";
      const name = profileName || guestName;

      const profileCpf = reg.profiles?.cpf || "";
      const guestCpf =
        (reg.guest_data as { cpf?: string } | null)?.cpf || "";
      const cpfDigits = (profileCpf || guestCpf).replace(/\D/g, "");

      const profilePhone = reg.profiles?.phone || "";
      const guestPhone =
        (reg.guest_data as { phone?: string } | null)?.phone || "";
      const phoneDigits = (profilePhone || guestPhone).replace(/\D/g, "");

      const qrToken = (reg.qr_token || "").toLowerCase();

      // Combina critérios
      const matchesName = normalizeText(name).includes(queryNormalized);
      const matchesCpf =
        digitsOnlyQuery.length > 0 && cpfDigits.includes(digitsOnlyQuery);
      const matchesPhone =
        digitsOnlyQuery.length >= 3 && phoneDigits.includes(digitsOnlyQuery);
      const matchesToken =
        queryNormalized.length >= 4 && qrToken.includes(queryNormalized);

      return matchesName || matchesCpf || matchesPhone || matchesToken;
    });

    if (highlightedRegId) {
      const idx = matched.findIndex((r) => r.id === highlightedRegId);
      if (idx > 0) {
        const target = matched[idx];
        return [target, ...matched.slice(0, idx), ...matched.slice(idx + 1)];
      }
    }

    return matched;
  }, [
    activeRegistrations,
    quickFilter,
    flagFilter,
    debouncedQuery,
    highlightedRegId,
  ]);

  // Helper para obter nome do quarto alocado
  const getRoomName = useCallback(
    (reg: RegistrationWithDetails): string | null => {
      if (reg.retreat_rooms?.name) return reg.retreat_rooms.name;
      if (reg.room_allocation && reg.room_allocation !== "Não alocado") {
        return reg.room_allocation;
      }
      if (reg.room_id) {
        const found = retreatRooms.find((r) => r.id === reg.room_id);
        if (found) return found.name;
      }
      return null;
    },
    [retreatRooms]
  );

  // Helper para obter nome legível do irmão
  const getParticipantName = useCallback((reg: RegistrationWithDetails): string => {
    return (
      reg.profiles?.full_name ||
      (reg.guest_data as { full_name?: string } | null)?.full_name ||
      "Irmão(ã) não identificado(a)"
    );
  }, []);

  // Helper para obter telefone
  const getParticipantPhone = useCallback((reg: RegistrationWithDetails): string | null => {
    return (
      reg.profiles?.phone ||
      (reg.guest_data as { phone?: string } | null)?.phone ||
      null
    );
  }, []);

  // Helper para obter CPF
  const getParticipantCpf = useCallback((reg: RegistrationWithDetails): string | null => {
    return (
      reg.profiles?.cpf ||
      (reg.guest_data as { cpf?: string } | null)?.cpf ||
      null
    );
  }, []);

  // Ação 1: Confirmar Chegada / Check-in
  const handleCheckIn = async (reg: RegistrationWithDetails) => {
    if (processingId) return;
    setProcessingId(reg.id);

    const now = new Date().toISOString();
    const roomName = getRoomName(reg);
    const participantName = getParticipantName(reg);

    // Feedback sensorial háptico no celular (se suportado na portaria)
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate?.([60, 40, 60]);
      } catch {
        // Ignora caso dispositivo bloqueie
      }
    }

    try {
      const { error } = await supabase
        .from("registrations")
        .update({
          checked_in_at: now,
          checked_in_by: operatorProfileId,
          status: "presente",
        })
        .eq("id", reg.id);

      if (error) throw error;

      // Atualiza o estado local imediatamente
      const updatedReg: RegistrationWithDetails = {
        ...reg,
        checked_in_at: now,
        checked_in_by: operatorProfileId,
        status: "presente",
      };
      onUpdateRegistration(updatedReg);

      // Toast de confirmação imediato para orientar o recepcionista e o irmão
      if (roomName) {
        toast.success(`Irmão confirmado! Quarto: ${roomName}`, {
          description: `${participantName} credenciado(a) com sucesso.`,
          duration: 4500,
        });
      } else {
        toast.success("Irmão confirmado! Sem quarto alocado.", {
          description: `${participantName} credenciado(a) com sucesso.`,
          duration: 4500,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao registrar check-in";
      toast.error(`Falha no credenciamento: ${msg}`);
    } finally {
      setProcessingId(null);
    }
  };

  // Ação 2: Desfazer / Reverter Check-in (clique acidental)
  const handleRevertCheckIn = async (reg: RegistrationWithDetails) => {
    if (processingId) return;
    setProcessingId(reg.id);

    const participantName = getParticipantName(reg);

    try {
      const { error } = await supabase
        .from("registrations")
        .update({
          checked_in_at: null,
          checked_in_by: null,
          status: "confirmado",
        })
        .eq("id", reg.id);

      if (error) throw error;

      const updatedReg: RegistrationWithDetails = {
        ...reg,
        checked_in_at: null,
        checked_in_by: null,
        status: "confirmado",
      };
      onUpdateRegistration(updatedReg);

      toast.info(`Check-in de ${participantName} desfeito.`, {
        description: "Status revertido para pendente.",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao desfazer check-in";
      toast.error(`Não foi possível reverter: ${msg}`);
    } finally {
      setProcessingId(null);
    }
  };

  // Ação 3: Alternar flag de controle na portaria (com persistência imediata)
  const handleToggleFlag = async (
    reg: RegistrationWithDetails,
    flagKey: string
  ) => {
    const lockKey = `${reg.id}:${flagKey}`;
    if (savingFlagId) return;
    setSavingFlagId(lockKey);

    const currentFlags = parseCheckinFlags(reg.checkin_flags);
    const nextFlags: CheckinFlagsMap = {
      ...currentFlags,
      [flagKey]: !currentFlags[flagKey],
    };

    try {
      if (onUpdateCheckinFlags) {
        await onUpdateCheckinFlags(reg.id, nextFlags);
      } else {
        const { error } = await supabase
          .from("registrations")
          .update({ checkin_flags: nextFlags as unknown as Json })
          .eq("id", reg.id);

        if (error) throw error;

        onUpdateRegistration({
          ...reg,
          checkin_flags: nextFlags as unknown as Json,
        });
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Erro ao atualizar item da checklist";
      toast.error(`Falha ao atualizar controle: ${msg}`);
    } finally {
      setSavingFlagId(null);
    }
  };

  const focusHighlightedCard = useCallback((regId: string) => {
    setQuickFilter("all");
    setFlagFilter("all");
    setSearchInput("");
    setDebouncedQuery("");
    setHighlightedRegId(regId);

    window.setTimeout(() => {
      document
        .getElementById(`checkin-card-${regId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
  }, []);

  const handleQrCheckInSuccess = (payload: {
    registrationId: string;
    checkedInAt: string;
    checkedInBy: string | null;
    alreadyCheckedIn: boolean;
  }) => {
    const existing = registrations.find((r) => r.id === payload.registrationId);
    if (existing) {
      const updatedReg: RegistrationWithDetails = {
        ...existing,
        status: "presente",
        checked_in_at: existing.checked_in_at || payload.checkedInAt,
        checked_in_by: existing.checked_in_by || payload.checkedInBy,
      };
      onUpdateRegistration(updatedReg);

      const participantName = getParticipantName(updatedReg);
      const roomName = getRoomName(updatedReg);

      if (payload.alreadyCheckedIn) {
        toast.info(`${participantName} já estava credenciado(a).`, {
          description: roomName
            ? `Quarto: ${roomName}. Confira os itens de controle no card.`
            : "Confira os itens de controle no card destacado.",
        });
      } else {
        toast.success(
          roomName
            ? `Check-in QR confirmado! Quarto: ${roomName}`
            : "Check-in QR confirmado! Sem quarto alocado.",
          {
            description: `${participantName} — marque os itens de portaria no card.`,
          }
        );
      }
    } else {
      onRefreshRegistrations?.();
      toast.success("Check-in via QR Code confirmado!");
    }

    focusHighlightedCard(payload.registrationId);
  };

  const handleManualSelectFromScanner = async (reg: RegistrationWithDetails) => {
    const alreadyPresent =
      Boolean(reg.checked_in_at) || reg.status === "presente";
    if (!alreadyPresent) {
      await handleCheckIn(reg);
    }
    focusHighlightedCard(reg.id);
  };

  return (
    <div className="w-full max-w-full space-y-5 overflow-x-hidden">
      {/* 1. Placar ao Vivo (KPIs e Barra de Progresso) */}
      <Card className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex size-2 rounded-full bg-emerald-500 animate-pulse" />
              <h3 className="text-sm sm:text-base font-extrabold text-zinc-900 dark:text-zinc-50 tracking-tight">
                Placar ao Vivo — Recepção
              </h3>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Credenciamento e portaria de {retreatTitle}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {retreatId && (
              <Button
                type="button"
                onClick={() => setIsQrScannerOpen(true)}
                className="min-h-[44px] h-11 px-4 rounded-xl text-xs font-bold cursor-pointer"
              >
                <QrCode className="w-4 h-4 mr-1.5" />
                <span>Ler QR Code</span>
              </Button>
            )}

            <Button
              type="button"
              variant="outline"
              onClick={() => setIsBadgePrintOpen(true)}
              className="min-h-[44px] h-11 px-4 rounded-xl text-xs font-semibold cursor-pointer"
            >
              <Printer className="w-4 h-4 mr-1.5" />
              <span>Emitir Crachás</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => setIsChecklistConfigOpen(true)}
              className="min-h-[44px] h-11 px-3.5 rounded-xl text-xs font-semibold cursor-pointer"
            >
              <ListChecks className="w-4 h-4 mr-1.5" />
              <span>Configurar Checklist</span>
            </Button>

            <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 pl-1">
              <Users className="w-4 h-4 text-primary" />
              <span>Total:</span>
              <span className="font-extrabold text-zinc-900 dark:text-zinc-100 text-sm">
                {totalCount}
              </span>
            </div>
          </div>
        </div>

        {/* Cartões KPI: Presentes e Aguardando */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Card Presentes */}
          <div className="flex items-center justify-between p-3.5 sm:p-4 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/50">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                <UserCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                Presentes no Local
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-black text-emerald-900 dark:text-emerald-100">
                  {presentCount}
                </span>
                <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                  de {totalCount} ({percentagePresent}%)
                </span>
              </div>
            </div>
            <Badge
              variant="outline"
              className="bg-emerald-600 text-white border-transparent text-xs font-black px-2.5 py-1 rounded-lg shrink-0"
            >
              {percentagePresent}%
            </Badge>
          </div>

          {/* Card Aguardando */}
          <div className="flex items-center justify-between p-3.5 sm:p-4 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-800/40">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                Aguardando Chegada
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-black text-amber-900 dark:text-amber-100">
                  {pendingCount}
                </span>
                <span className="text-xs font-bold text-amber-700 dark:text-amber-300">
                  irmãos a caminho
                </span>
              </div>
            </div>
            <Badge
              variant="outline"
              className="bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-400/40 text-xs font-black px-2.5 py-1 rounded-lg shrink-0"
            >
              {totalCount > 0 ? 100 - percentagePresent : 0}%
            </Badge>
          </div>
        </div>

        {/* Barra de Progresso Visual Fluida */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <span>Progresso da Recepção</span>
            <span className="font-bold text-zinc-900 dark:text-zinc-100">
              {presentCount} de {totalCount} irmãos confirmados
            </span>
          </div>
          <Progress
            value={percentagePresent}
            className="h-3 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden"
          />
        </div>

        {/* Contadores dos itens da checklist de portaria */}
        {flagStats.length > 0 && (
          <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/80 space-y-2">
            <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span className="font-semibold flex items-center gap-1.5">
                <ListChecks className="w-3.5 h-3.5 text-primary" />
                <span>Resumo da Checklist de Portaria</span>
              </span>
              {flagFilter !== "all" && (
                <button
                  type="button"
                  onClick={() => setFlagFilter("all")}
                  className="min-h-[44px] px-2 text-xs font-semibold text-primary hover:underline cursor-pointer"
                >
                  Limpar filtro de item
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {flagStats.map((stat) => {
                const filterKey = `done:${stat.key}`;
                const isSelected = flagFilter === filterKey;
                return (
                  <button
                    key={stat.key}
                    type="button"
                    onClick={() =>
                      setFlagFilter(isSelected ? "all" : filterKey)
                    }
                    className={`min-h-[44px] px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer ${
                      isSelected
                        ? CHECKIN_FLAG_CLASSES.checked
                        : "bg-zinc-50 dark:bg-zinc-800/60 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <span>{stat.label}:</span>
                    <span className="font-black">
                      {stat.doneCount}/{totalCount}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {/* 2. Barra de Busca Instantânea Proeminente */}
      <div className="space-y-3">
        <div className="relative w-full">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400 pointer-events-none" />
          <Input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar irmão por nome ou CPF..."
            className="w-full h-12 min-h-[48px] pl-11 pr-11 text-sm sm:text-base rounded-xl border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 shadow-xs focus-visible:ring-2 focus-visible:ring-primary"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              aria-label="Limpar busca"
              className="absolute right-1 top-1/2 -translate-y-1/2 size-11 min-w-[44px] min-h-[44px] flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* 3. Filtros Rápidos em Pílulas */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          <button
            type="button"
            onClick={() => setQuickFilter("all")}
            className={`min-h-[44px] px-4 rounded-xl text-xs sm:text-sm font-bold transition-all shrink-0 cursor-pointer flex items-center gap-2 border ${
              quickFilter === "all"
                ? "bg-zinc-900 text-zinc-50 border-zinc-900 dark:bg-zinc-50 dark:text-zinc-900 dark:border-zinc-50 shadow-xs"
                : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-800 dark:hover:bg-zinc-800"
            }`}
          >
            <span>Todos</span>
            <span
              className={`px-1.5 py-0.2 rounded-md text-[11px] font-black ${
                quickFilter === "all"
                  ? "bg-white/20 text-white dark:bg-black/20 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              {totalCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setQuickFilter("present")}
            className={`min-h-[44px] px-4 rounded-xl text-xs sm:text-sm font-bold transition-all shrink-0 cursor-pointer flex items-center gap-2 border ${
              quickFilter === "present"
                ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                : "bg-white text-zinc-600 border-zinc-200 hover:bg-emerald-50 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-800 dark:hover:bg-emerald-950/30"
            }`}
          >
            <UserCheck className="w-4 h-4" />
            <span>Apenas Presentes</span>
            <span
              className={`px-1.5 py-0.2 rounded-md text-[11px] font-black ${
                quickFilter === "present"
                  ? "bg-white/20 text-white"
                  : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
              }`}
            >
              {presentCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setQuickFilter("pending")}
            className={`min-h-[44px] px-4 rounded-xl text-xs sm:text-sm font-bold transition-all shrink-0 cursor-pointer flex items-center gap-2 border ${
              quickFilter === "pending"
                ? "bg-amber-600 text-white border-amber-600 shadow-xs"
                : "bg-white text-zinc-600 border-zinc-200 hover:bg-amber-50 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-800 dark:hover:bg-amber-950/30"
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>Apenas Pendentes</span>
            <span
              className={`px-1.5 py-0.2 rounded-md text-[11px] font-black ${
                quickFilter === "pending"
                  ? "bg-white/20 text-white"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
              }`}
            >
              {pendingCount}
            </span>
          </button>

          {effectiveChecklist.length > 0 && (
            <div className="min-w-[210px] shrink-0">
              <Select value={flagFilter} onValueChange={setFlagFilter}>
                <SelectTrigger className="min-h-[44px] h-11 rounded-xl text-xs font-semibold bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                  <SelectValue placeholder="Filtrar por checklist" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">Checklist: Todos</SelectItem>
                    {effectiveChecklist.map((item) => (
                      <SelectItem key={`done-${item.key}`} value={`done:${item.key}`}>
                        Com: {item.label}
                      </SelectItem>
                    ))}
                    {effectiveChecklist.map((item) => (
                      <SelectItem key={`pending-${item.key}`} value={`pending:${item.key}`}>
                        Sem: {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>

      {/* 4. Lista e Cards de Participantes */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 px-1">
          <span>
            Exibindo{" "}
            <strong className="text-zinc-900 dark:text-zinc-100 font-bold">
              {filteredRegistrations.length}
            </strong>{" "}
            {filteredRegistrations.length === 1 ? "irmão" : "irmãos"}
            {debouncedQuery && ` para "${debouncedQuery}"`}
          </span>

          {onRefreshRegistrations && (
            <button
              type="button"
              onClick={onRefreshRegistrations}
              className="min-h-[44px] px-2 text-xs text-primary font-semibold hover:underline flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Atualizar lista</span>
            </button>
          )}
        </div>

        {/* Estado Vazio */}
        {filteredRegistrations.length === 0 && (
          <Card className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-8 sm:p-12 text-center space-y-3">
            <div className="size-12 mx-auto rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400">
              <Users className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm sm:text-base font-bold text-zinc-900 dark:text-zinc-100">
                {debouncedQuery
                  ? "Nenhum irmão encontrado"
                  : quickFilter === "present"
                  ? "Nenhum irmão credenciado ainda"
                  : quickFilter === "pending"
                  ? "Todos os irmãos já foram credenciados!"
                  : "Nenhuma inscrição registrada"}
              </h4>
              <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                {debouncedQuery
                  ? `Não encontramos registros para "${debouncedQuery}". Verifique a digitação ou busque apenas pelo CPF.`
                  : quickFilter === "present"
                  ? "Aguarde os primeiros irmãos chegarem na portaria e confirme a chegada no botão."
                  : quickFilter === "pending"
                  ? "Glória a Deus! 100% dos inscritos já deram entrada no evento."
                  : "As inscrições deste retiro aparecerão aqui para o credenciamento."}
              </p>
            </div>
            {debouncedQuery && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setSearchInput("")}
                className="min-h-[44px] text-xs font-semibold rounded-xl cursor-pointer"
              >
                Limpar busca
              </Button>
            )}
          </Card>
        )}

        {/* Grid de Cards dos Participantes */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filteredRegistrations.map((reg) => {
            const isPresent = Boolean(reg.checked_in_at) || reg.status === "presente";
            const isProcessing = processingId === reg.id;
            const isHighlighted = highlightedRegId === reg.id;
            const name = getParticipantName(reg);
            const phone = getParticipantPhone(reg);
            const cpf = getParticipantCpf(reg);
            const roomName = getRoomName(reg);
            const isPaid = Boolean(reg.paid);
            const regFlags = parseCheckinFlags(reg.checkin_flags);

            return (
              <Card
                id={`checkin-card-${reg.id}`}
                key={reg.id}
                className={`rounded-2xl p-4 transition-all duration-200 border shadow-xs flex flex-col justify-between gap-3.5 ${
                  isHighlighted
                    ? CHECKIN_FLAG_CLASSES.scannedHighlight
                    : isPresent
                    ? "bg-white dark:bg-zinc-900 border-emerald-500/40 dark:border-emerald-500/30 ring-1 ring-emerald-500/10"
                    : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
                }`}
              >
                {/* Faixa de destaque quando recém-lido via QR Code */}
                {isHighlighted && (
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary">
                    <span className="flex items-center gap-1.5 truncate">
                      <QrCode className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">
                        Selecionado na portaria — marque os controles abaixo
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setHighlightedRegId(null)}
                      aria-label="Limpar destaque"
                      className="min-h-[44px] min-w-[44px] -my-2 -mr-2 flex items-center justify-center rounded-lg hover:bg-primary/10 cursor-pointer shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* Topo do Card: Avatar, Nome e Status */}
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <ChurchAvatar
                        size="md"
                        shape="squircle"
                        variant={isPresent ? "glow" : "subtle"}
                        alt={name}
                      />
                      <div className="min-w-0">
                        <h4 className="text-sm sm:text-base font-extrabold text-zinc-900 dark:text-zinc-50 leading-tight truncate">
                          {name}
                        </h4>
                        {cpf && (
                          <span className="text-[11px] text-zinc-400 dark:text-zinc-500 block truncate">
                            CPF: {formatCpf(cpf)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Badges de Status e Equipe */}
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge
                        variant="outline"
                        className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md shrink-0 flex items-center gap-1 ${
                          isPresent
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700"
                        }`}
                      >
                        {isPresent ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                            <span>Presente</span>
                          </>
                        ) : (
                          <>
                            <Clock className="w-3 h-3 text-zinc-400" />
                            <span>Pendente</span>
                          </>
                        )}
                      </Badge>

                      {reg.service_team && (
                        <Badge
                          variant="outline"
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-1 ${getServiceTeamBadgeStyle(reg.service_team)}`}
                        >
                          <HeartHandshake className="w-2.5 h-2.5 shrink-0" />
                          <span className="truncate max-w-[110px]">
                            {getServiceTeam(reg.service_team)?.shortLabel || reg.service_team}
                          </span>
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Detalhes Críticos para a Portaria: Quarto e Telefone */}
                  <div className="space-y-2 pt-0.5">
                    {/* Alocação de Quarto (orientação ao irmão) */}
                    <div
                      className={`flex items-center justify-between p-2.5 rounded-xl border text-xs font-semibold ${
                        roomName
                          ? "bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200/60 dark:border-emerald-800/40 text-emerald-900 dark:text-emerald-200"
                          : "bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Bed
                          className={`w-4 h-4 shrink-0 ${
                            roomName
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-zinc-400"
                          }`}
                        />
                        <span className="truncate">
                          {roomName ? (
                            <>
                              Quarto:{" "}
                              <strong className="font-extrabold text-emerald-800 dark:text-emerald-300">
                                {roomName}
                              </strong>
                            </>
                          ) : (
                            "Sem quarto alocado"
                          )}
                        </span>
                      </div>
                      {roomName && (
                        <span className="text-[10px] font-black uppercase text-emerald-700 dark:text-emerald-400 bg-emerald-100/70 dark:bg-emerald-900/60 px-1.5 py-0.5 rounded-md shrink-0">
                          Alocado
                        </span>
                      )}
                    </div>

                    {/* Metadados: Telefone e Pagamento */}
                    <div className="flex items-center justify-between text-xs pt-0.5">
                      {/* Telefone com link para ligar */}
                      {phone ? (
                        <a
                          href={`tel:${phone.replace(/\D/g, "")}`}
                          className="min-h-[44px] -ml-1 px-2 text-zinc-600 dark:text-zinc-400 hover:text-primary dark:hover:text-primary flex items-center gap-1.5 font-medium transition-colors cursor-pointer"
                          title="Ligar para o irmão"
                        >
                          <Phone className="w-3.5 h-3.5 text-zinc-400" />
                          <span>{phone}</span>
                        </a>
                      ) : (
                        <span className="text-zinc-400 text-[11px] italic">
                          Sem telefone
                        </span>
                      )}

                      {/* Badge Informativo de Pagamento */}
                      <Badge
                        variant="outline"
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                          isPaid
                            ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700"
                            : "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
                        }`}
                      >
                        {isPaid ? "Pago" : "Pagamento Pendente"}
                      </Badge>
                    </div>

                    {/* Horário da confirmação (se presente) */}
                    {isPresent && reg.checked_in_at && (
                      <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                        <span>
                          Confirmado às {formatTimeBR(reg.checked_in_at)}
                        </span>
                      </p>
                    )}

                    {/* Flags interativas de controle na portaria */}
                    {effectiveChecklist.length > 0 && (
                      <div className="pt-1.5 flex flex-wrap gap-1.5">
                        {effectiveChecklist.map((item) => {
                          const isChecked = Boolean(regFlags[item.key]);
                          const isSavingThis =
                            savingFlagId === `${reg.id}:${item.key}`;
                          return (
                            <button
                              key={item.key}
                              type="button"
                              disabled={Boolean(savingFlagId)}
                              onClick={() => void handleToggleFlag(reg, item.key)}
                              aria-pressed={isChecked}
                              className={`min-h-[44px] px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60 ${
                                isChecked
                                  ? CHECKIN_FLAG_CLASSES.checked
                                  : CHECKIN_FLAG_CLASSES.unchecked
                              }`}
                            >
                              {isSavingThis ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                              ) : isChecked ? (
                                <Check className="w-3.5 h-3.5 shrink-0" />
                              ) : (
                                <Square className="w-3.5 h-3.5 shrink-0 opacity-65" />
                              )}
                              <span className="text-left leading-tight">
                                {item.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Rodapé do Card: Botões de Ação Rápida */}
                <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center gap-2">
                  {!isPresent ? (
                    // Botão Principal Grande de Check-in (Mínimo 44px)
                    <Button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => handleCheckIn(reg)}
                      className="w-full min-h-[48px] h-12 rounded-xl text-sm font-black bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white shadow-sm flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-[0.98]"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Confirmando...</span>
                        </>
                      ) : (
                        <>
                          <UserCheck className="w-4 h-4" />
                          <span>Confirmar Chegada</span>
                        </>
                      )}
                    </Button>
                  ) : (
                    // Botão para Desfazer / Reverter Check-in (Mínimo 44px)
                    <div className="w-full flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>Presença registrada</span>
                      </div>

                      <Button
                        type="button"
                        variant="outline"
                        disabled={isProcessing}
                        onClick={() => handleRevertCheckIn(reg)}
                        className="min-h-[44px] h-11 px-3 text-xs font-semibold rounded-xl text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50 border-zinc-200 dark:border-zinc-700 flex items-center gap-1.5 cursor-pointer shrink-0"
                        title="Desfazer check-in em caso de clique acidental"
                      >
                        {isProcessing ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="w-3.5 h-3.5 text-zinc-400" />
                        )}
                        <span>Desfazer</span>
                      </Button>
                    </div>
                  )}

                  {/* Botão de Ver Ficha Completa (se fornecido) */}
                  {onViewDetails && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onViewDetails(reg)}
                      className="min-h-[44px] size-11 p-0 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 shrink-0 cursor-pointer"
                      title="Ver ficha de inscrição completa"
                      aria-label="Ver ficha de inscrição"
                    >
                      <FileText className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Modal: Leitor de QR Code na Portaria */}
      {retreatId && (
        <QrScannerDialog
          isOpen={isQrScannerOpen}
          onClose={() => setIsQrScannerOpen(false)}
          retreatId={retreatId}
          retreatTitle={retreatTitle}
          registrations={registrations}
          onQrCheckInSuccess={handleQrCheckInSuccess}
          onManualSelectParticipant={handleManualSelectFromScanner}
        />
      )}

      {/* Modal: Emissão de Crachás A4 com QR Code */}
      <EventBadgePrintDialog
        isOpen={isBadgePrintOpen}
        onClose={() => setIsBadgePrintOpen(false)}
        retreat={{
          id: retreatId || "",
          title: retreatTitle,
          start_date: retreatStartDate,
          end_date: retreatEndDate,
          location_text: retreatLocation,
        }}
        registrations={registrations}
        homeGroupsMap={homeGroupsMap}
      />

      {/* Modal: Configuração Rápida da Checklist de Portaria */}
      <CheckinChecklistConfigDialog
        isOpen={isChecklistConfigOpen}
        onClose={() => setIsChecklistConfigOpen(false)}
        retreatId={retreatId}
        retreatTitle={retreatTitle}
        initialConfig={effectiveChecklist}
        onSaved={(nextConfig) => {
          onChecklistConfigUpdated?.(nextConfig);
        }}
      />
    </div>
  );
}
