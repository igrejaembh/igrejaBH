import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Printer,
  QrCode,
  Search,
  Users,
  CheckSquare,
  Square,
  Bed,
  HeartHandshake,
  MapPin,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChurchSymbol } from "@/components/icons/ChurchLogo";
import { QrCodeSvg } from "@/components/events/QrCodeSvg";
import { formatDateBR } from "@/lib/utils";
import { getServiceTeam } from "@/constants/serviceTeams";
import {
  getParticipantName,
  getParticipantCityState,
  getParticipantRoom,
} from "@/lib/eventPrintUtils";
import type { RegistrationWithDetails } from "./RegistrationDetailDialog";

export interface EventBadgePrintDialogProps {
  isOpen: boolean;
  onClose: () => void;
  retreat: {
    id: string;
    title: string;
    start_date?: string | null;
    end_date?: string | null;
    location_text?: string | null;
  };
  registrations: RegistrationWithDetails[];
  homeGroupsMap?: Map<string, string>;
}

type BadgeFilterMode = "all" | "paid" | "specific";
type BadgeSortBy = "name" | "room" | "team";

const BADGES_PER_PAGE = 8;

function resolveHomeGroupLabel(
  reg: RegistrationWithDetails,
  homeGroupsMap?: Map<string, string>
): string | null {
  const nested = reg.profiles?.home_groups?.location_text?.trim();
  if (nested) return nested;
  const hgId = reg.profiles?.home_group_id;
  if (hgId && homeGroupsMap?.has(hgId)) {
    return homeGroupsMap.get(hgId) || null;
  }
  return null;
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages;
}

function PrintableBadgeCard({
  registration,
  retreatTitle,
  datesLabel,
  homeGroupsMap,
}: {
  registration: RegistrationWithDetails;
  retreatTitle: string;
  datesLabel: string;
  homeGroupsMap?: Map<string, string>;
}) {
  const name = getParticipantName(registration);
  const room = getParticipantRoom(registration);
  const cityState = getParticipantCityState(registration);
  const homeGroup = resolveHomeGroupLabel(registration, homeGroupsMap);
  const teamDef = getServiceTeam(registration.service_team);
  const qrToken = registration.qr_token || registration.id;

  return (
    <article
      className="print-avoid-break flex flex-col justify-between border border-dashed border-zinc-500 bg-white p-3 text-black"
      style={{ height: "63mm" }}
    >
      {/* Cabeçalho compacto do crachá */}
      <div className="flex items-center justify-between gap-2 border-b border-black pb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="flex h-5 w-7 shrink-0 items-center justify-center border border-black p-0.5 bg-white">
            <ChurchSymbol className="h-full w-full text-black" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[8px] font-black uppercase tracking-wider text-black leading-tight">
              Igreja em Belo Horizonte
            </p>
            <p className="truncate text-[8px] font-semibold text-zinc-700 leading-tight">
              {datesLabel}
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded border border-black px-1.5 py-0.5 text-[7px] font-black uppercase tracking-wider text-black">
          Crachá
        </span>
      </div>

      {/* Título do retiro */}
      <p className="mt-1 truncate text-[9px] font-bold uppercase tracking-wide text-zinc-800">
        {retreatTitle}
      </p>

      {/* Corpo: Dados do participante + QR Code */}
      <div className="my-auto flex items-center justify-between gap-2.5 py-1">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="line-clamp-2 text-sm font-black leading-tight text-black">
            {name}
          </h3>

          <div className="flex flex-col gap-0.5 text-[9px] text-zinc-800">
            <div className="flex items-center gap-1 truncate">
              <Bed className="size-2.5 shrink-0 text-black" />
              <span className="font-bold text-black">Quarto:</span>
              <span className="truncate font-semibold">
                {room === "Pendente" ? "Sem quarto" : room}
              </span>
            </div>

            {teamDef && (
              <div className="flex items-center gap-1 truncate">
                <HeartHandshake className="size-2.5 shrink-0 text-black" />
                <span className="font-bold text-black">Equipe:</span>
                <span className="truncate font-semibold">{teamDef.label}</span>
              </div>
            )}

            <div className="flex items-center gap-1 truncate">
              <MapPin className="size-2.5 shrink-0 text-black" />
              <span className="truncate">
                {homeGroup ? `${homeGroup} • ${cityState}` : cityState}
              </span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-0.5 border border-zinc-300 bg-white p-1">
          <QrCodeSvg
            value={qrToken}
            size={84}
            margin={1}
            title={`QR Code de ${name}`}
          />
          <span className="max-w-[84px] truncate font-mono text-[7px] font-bold tracking-tight text-zinc-700">
            {qrToken.slice(0, 10).toUpperCase()}
          </span>
        </div>
      </div>

      {/* Rodapé com guia de recorte */}
      <div className="flex items-center justify-between border-t border-zinc-300 pt-1 text-[7px] font-semibold uppercase tracking-wider text-zinc-600">
        <span>Apresentar na portaria / refeitório</span>
        <span className="font-mono">ID #{registration.id.slice(0, 6)}</span>
      </div>
    </article>
  );
}

function BadgeSheetsDocument({
  retreat,
  registrations,
  homeGroupsMap,
}: {
  retreat: EventBadgePrintDialogProps["retreat"];
  registrations: RegistrationWithDetails[];
  homeGroupsMap?: Map<string, string>;
}) {
  const datesLabel = retreat.start_date
    ? `${formatDateBR(retreat.start_date)}${
        retreat.end_date ? ` a ${formatDateBR(retreat.end_date)}` : ""
      }`
    : "Data a definir";

  const pages = useMemo(
    () => chunkItems(registrations, BADGES_PER_PAGE),
    [registrations]
  );

  if (registrations.length === 0) {
    return (
      <div className="bg-white p-10 text-center text-black">
        <p className="text-sm font-bold">
          Nenhum participante selecionado para emissão de crachás.
        </p>
        <p className="mt-1 text-xs text-zinc-600">
          Ajuste o filtro ou selecione ao menos um inscrito ativo.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white text-black">
      {pages.map((pageRegs, pageIndex) => (
        <section
          key={`badge-page-${pageIndex}`}
          className="print-page-break flex flex-col gap-2 bg-white"
        >
          <div className="flex items-center justify-between border-b border-zinc-300 pb-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-600">
            <span>
              Crachás — {retreat.title} ({registrations.length} no total)
            </span>
            <span>
              Folha {pageIndex + 1} de {pages.length} • Recorte nas linhas pontilhadas
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {pageRegs.map((reg) => (
              <PrintableBadgeCard
                key={reg.id}
                registration={reg}
                retreatTitle={retreat.title}
                datesLabel={datesLabel}
                homeGroupsMap={homeGroupsMap}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function EventBadgePrintDialog({
  isOpen,
  onClose,
  retreat,
  registrations,
  homeGroupsMap,
}: EventBadgePrintDialogProps) {
  const [filterMode, setFilterMode] = useState<BadgeFilterMode>("all");
  const [sortBy, setSortBy] = useState<BadgeSortBy>("name");
  const [specificSearch, setSpecificSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [zoomLevel, setZoomLevel] = useState<number>(95);

  const activeRegistrations = useMemo(
    () => registrations.filter((r) => (r.status || "confirmado") !== "cancelado"),
    [registrations]
  );

  const paidRegistrations = useMemo(
    () => activeRegistrations.filter((r) => Boolean(r.paid)),
    [activeRegistrations]
  );

  const specificCandidates = useMemo(() => {
    const q = specificSearch.trim().toLowerCase();
    const sorted = [...activeRegistrations].sort((a, b) =>
      getParticipantName(a).localeCompare(getParticipantName(b), "pt-BR")
    );
    if (!q) return sorted;
    return sorted.filter((reg) => {
      const name = getParticipantName(reg).toLowerCase();
      const room = getParticipantRoom(reg).toLowerCase();
      return name.includes(q) || room.includes(q);
    });
  }, [activeRegistrations, specificSearch]);

  const filteredBadges = useMemo(() => {
    let base = activeRegistrations;
    if (filterMode === "paid") {
      base = paidRegistrations;
    } else if (filterMode === "specific") {
      base = activeRegistrations.filter((r) => selectedIds.has(r.id));
    }

    const list = [...base];
    if (sortBy === "name") {
      list.sort((a, b) =>
        getParticipantName(a).localeCompare(getParticipantName(b), "pt-BR")
      );
    } else if (sortBy === "room") {
      list.sort((a, b) => {
        const ra = getParticipantRoom(a);
        const rb = getParticipantRoom(b);
        if (ra === rb) {
          return getParticipantName(a).localeCompare(getParticipantName(b), "pt-BR");
        }
        return ra.localeCompare(rb, "pt-BR");
      });
    } else if (sortBy === "team") {
      list.sort((a, b) => {
        const ta = getServiceTeam(a.service_team)?.label || "ZZZ";
        const tb = getServiceTeam(b.service_team)?.label || "ZZZ";
        if (ta === tb) {
          return getParticipantName(a).localeCompare(getParticipantName(b), "pt-BR");
        }
        return ta.localeCompare(tb, "pt-BR");
      });
    }
    return list;
  }, [activeRegistrations, paidRegistrations, filterMode, selectedIds, sortBy]);

  const toggleSpecificId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      specificCandidates.forEach((r) => next.add(r.id));
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleTriggerPrint = () => {
    const previousTitle = document.title;
    const sanitizedTitle = (retreat.title || "Evento")
      .replace(/[^a-zA-Z0-9À-ÿ\s_-]/g, "")
      .trim()
      .replace(/\s+/g, "_");
    document.title = `Crachas_${sanitizedTitle}`;

    try {
      window.print();
    } finally {
      document.title = previousTitle;
    }
  };

  const totalPages = Math.ceil(filteredBadges.length / BADGES_PER_PAGE);

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          size="2xl"
          className="no-print flex h-[92dvh] max-h-[94dvh] w-[96vw] flex-col gap-4 overflow-hidden p-4 sm:max-w-[95vw] sm:p-6 md:max-w-[92vw] lg:max-w-6xl xl:max-w-7xl"
        >
          <DialogHeader className="shrink-0 border-b border-border pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted">
                  <QrCode className="size-5 text-foreground" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <DialogTitle className="truncate">
                      Emissão de Crachás A4 com QR Code
                    </DialogTitle>
                    <Badge variant="outline">
                      {filteredBadges.length}{" "}
                      {filteredBadges.length === 1 ? "crachá" : "crachás"} •{" "}
                      {totalPages}{" "}
                      {totalPages === 1 ? "folha A4" : "folhas A4"}
                    </Badge>
                  </div>
                  <DialogDescription>
                    Folhas A4 prontas para impressão (8 crachás por página) com código QR individual para check-in ágil na portaria.
                  </DialogDescription>
                </div>
              </div>

              <Button
                type="button"
                onClick={handleTriggerPrint}
                disabled={filteredBadges.length === 0}
                className="min-h-[44px] shrink-0 px-5 text-xs font-bold cursor-pointer"
              >
                <Printer data-icon="inline-start" />
                <span>Imprimir Crachás / PDF</span>
              </Button>
            </div>

            {/* Filtros, Ordenação e Zoom */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="w-full sm:w-[230px]">
                  <Select
                    value={filterMode}
                    onValueChange={(val: BadgeFilterMode) => setFilterMode(val)}
                  >
                    <SelectTrigger className="min-h-[44px] w-full text-xs">
                      <SelectValue placeholder="Filtrar participantes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="all">
                          Todos ativos ({activeRegistrations.length})
                        </SelectItem>
                        <SelectItem value="paid">
                          Apenas pagos ({paidRegistrations.length})
                        </SelectItem>
                        <SelectItem value="specific">
                          Participantes específicos ({selectedIds.size})
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>

                <div className="w-full sm:w-[210px]">
                  <Select
                    value={sortBy}
                    onValueChange={(val: BadgeSortBy) => setSortBy(val)}
                  >
                    <SelectTrigger className="min-h-[44px] w-full text-xs">
                      <SelectValue placeholder="Ordenar por" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="name">Ordem Alfabética (A-Z)</SelectItem>
                        <SelectItem value="room">Agrupado por Quarto</SelectItem>
                        <SelectItem value="team">Por Equipe de Serviço</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Controle de Zoom */}
              <div className="flex items-center gap-1 rounded-xl border border-border bg-muted/50 p-1">
                <span className="px-2 text-[11px] font-semibold text-muted-foreground">
                  Zoom
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setZoomLevel((z) => Math.max(60, z - 15))}
                  aria-label="Diminuir zoom"
                  className="min-h-[44px] min-w-[44px] cursor-pointer font-bold"
                >
                  -
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setZoomLevel(95)}
                  className="min-h-[44px] px-2.5 cursor-pointer text-xs font-bold"
                >
                  {zoomLevel}%
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setZoomLevel((z) => Math.min(130, z + 15))}
                  aria-label="Aumentar zoom"
                  className="min-h-[44px] min-w-[44px] cursor-pointer font-bold"
                >
                  +
                </Button>
              </div>
            </div>
          </DialogHeader>

          {/* Painel de seleção específica quando filterMode === 'specific' */}
          {filterMode === "specific" && (
            <div className="shrink-0 rounded-xl border border-border bg-muted/20 p-3 flex flex-col gap-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={specificSearch}
                    onChange={(e) => setSpecificSearch(e.target.value)}
                    placeholder="Buscar irmão para selecionar..."
                    className="min-h-[44px] pl-9 text-xs"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={selectAllVisible}
                    className="min-h-[44px] px-3 text-xs cursor-pointer"
                  >
                    <CheckSquare data-icon="inline-start" />
                    <span>Selecionar todos</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={clearSelection}
                    className="min-h-[44px] px-3 text-xs cursor-pointer"
                  >
                    <Square data-icon="inline-start" />
                    <span>Limpar</span>
                  </Button>
                </div>
              </div>

              <div className="grid max-h-36 grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3 custom-scrollbar">
                {specificCandidates.map((reg) => {
                  const checked = selectedIds.has(reg.id);
                  const name = getParticipantName(reg);
                  const room = getParticipantRoom(reg);
                  return (
                    <label
                      key={reg.id}
                      className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted/40"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleSpecificId(reg.id)}
                      />
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                        {name}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {room}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Área de pré-visualização A4 */}
          <div className="flex-1 overflow-auto rounded-xl border border-border bg-muted/40 p-3 sm:p-6">
            {filteredBadges.length === 0 ? (
              <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center">
                <Users className="size-8 text-muted-foreground" />
                <p className="text-sm font-bold text-foreground">
                  Nenhum crachá para exibir
                </p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  {filterMode === "specific"
                    ? "Selecione um ou mais participantes na lista acima para gerar os crachás."
                    : "Não há inscrições ativas correspondentes a este filtro."}
                </p>
              </div>
            ) : (
              <div className="flex justify-center">
                <div
                  style={{
                    transform: `scale(${zoomLevel / 100})`,
                    transformOrigin: "top center",
                    transition: "transform 0.15s ease-out",
                  }}
                  className="w-full max-w-[210mm] rounded-sm border border-zinc-300 bg-white p-5 text-black shadow-xl sm:p-8"
                >
                  <BadgeSheetsDocument
                    retreat={retreat}
                    registrations={filteredBadges}
                    homeGroupsMap={homeGroupsMap}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Rodapé */}
          <div className="flex shrink-0 flex-col justify-between gap-3 border-t border-border pt-3 sm:flex-row sm:items-center">
            <p className="text-xs text-muted-foreground">
              Dica: na janela de impressão, escolha &quot;Salvar como PDF&quot; em formato A4 Retrato e desmarque cabeçalhos e rodapés do navegador.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="min-h-[44px] cursor-pointer"
              >
                Fechar
              </Button>
              <Button
                type="button"
                onClick={handleTriggerPrint}
                disabled={filteredBadges.length === 0}
                className="min-h-[44px] font-bold cursor-pointer"
              >
                <Printer data-icon="inline-start" />
                <span>Imprimir / Salvar PDF</span>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Portal A4 para impressão física/PDF */}
      {isOpen &&
        filteredBadges.length > 0 &&
        createPortal(
          <div id="event-print-container" className="event-print-portal">
            <BadgeSheetsDocument
              retreat={retreat}
              registrations={filteredBadges}
              homeGroupsMap={homeGroupsMap}
            />
          </div>,
          document.body
        )}
    </>
  );
}
