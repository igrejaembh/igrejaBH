import { useState } from "react";
import {
  QrCode,
  Calendar,
  MapPin,
  Bed,
  HeartHandshake,
  Copy,
  Check,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { QrCodeSvg } from "@/components/events/QrCodeSvg";
import { QR_BADGE_COLORS, THEME_CLASSES } from "@/constants/colors";
import { getServiceTeam, getServiceTeamBadgeStyle } from "@/constants/serviceTeams";
import { formatDateBR } from "@/lib/utils";
import type { Database } from "@/lib/database.types";

type RetreatRow = Database["public"]["Tables"]["retreats"]["Row"];
type RegistrationRow = Database["public"]["Tables"]["registrations"]["Row"];

export interface ParticipantQrBadgeProps {
  registration: RegistrationRow & { retreats?: RetreatRow | null };
  participantName: string;
}

export function ParticipantQrBadge({
  registration,
  participantName,
}: ParticipantQrBadgeProps) {
  const [copied, setCopied] = useState(false);

  const retreat = registration.retreats;
  const qrToken = registration.qr_token || registration.id;
  const isPresent =
    registration.status === "presente" || Boolean(registration.checked_in_at);
  const teamDef = getServiceTeam(registration.service_team);
  const TeamIcon = teamDef?.icon;

  const datesLabel = retreat?.start_date
    ? `${formatDateBR(retreat.start_date)}${
        retreat.end_date ? ` até ${formatDateBR(retreat.end_date)}` : ""
      }`
    : "Data a definir";

  const handleCopyToken = async () => {
    try {
      await navigator.clipboard.writeText(qrToken);
      setCopied(true);
      toast.success("Código do crachá copiado!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar o código.");
    }
  };

  return (
    <Card className="w-full overflow-hidden border-border bg-card">
      <CardHeader className="border-b border-border/60 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex flex-col gap-1">
            <CardTitle className="text-base font-bold text-foreground">
              {retreat?.title || "Encontro / Retiro"}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="size-3.5 shrink-0" />
                <span>{datesLabel}</span>
              </span>
              {retreat?.location_text && (
                <span className="flex items-center gap-1 truncate">
                  <MapPin className="size-3.5 shrink-0" />
                  <span className="truncate">{retreat.location_text}</span>
                </span>
              )}
            </div>
          </div>

          <Badge
            variant="outline"
            className={
              isPresent
                ? THEME_CLASSES.badgeRegistrationPresent
                : THEME_CLASSES.badgeRegistrationConfirmed
            }
          >
            {isPresent ? (
              <>
                <CheckCircle2 className="mr-1 size-3" />
                <span>Presente</span>
              </>
            ) : (
              <>
                <Clock className="mr-1 size-3" />
                <span>Confirmado</span>
              </>
            )}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col items-center gap-4 p-5">
        <div className="w-full text-center flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            Participante
          </span>
          <p className="text-lg font-extrabold tracking-tight text-foreground break-words">
            {participantName}
          </p>
        </div>

        {/* Superfície clara dedicada para leitura óptica confiável em light/dark mode */}
        <div
          className="flex flex-col items-center gap-2 rounded-2xl border border-border p-4 shadow-xs"
          style={{
            backgroundColor: QR_BADGE_COLORS.surfaceLight,
            color: QR_BADGE_COLORS.qrDark,
          }}
        >
          <QrCodeSvg
            value={qrToken}
            size={184}
            margin={2}
            title={`QR Code de ${participantName}`}
          />
          <span className="font-mono text-xs font-bold tracking-wider select-all">
            {qrToken}
          </span>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCopyToken}
          className="min-h-[44px] px-4 text-xs font-semibold cursor-pointer"
        >
          {copied ? (
            <Check data-icon="inline-start" />
          ) : (
            <Copy data-icon="inline-start" />
          )}
          <span>{copied ? "Código copiado" : "Copiar código do crachá"}</span>
        </Button>

        <Separator />

        <div className="grid w-full grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
            <Bed className="size-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <span className="block text-[11px] text-muted-foreground">
                Alojamento
              </span>
              <span className="block truncate font-bold text-foreground">
                {registration.room_allocation || "Pendente de alocação"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
            <HeartHandshake className="size-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <span className="block text-[11px] text-muted-foreground">
                Serviço
              </span>
              {teamDef && TeamIcon ? (
                <Badge
                  variant="outline"
                  className={`mt-0.5 ${getServiceTeamBadgeStyle(teamDef.id)}`}
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
    </Card>
  );
}

interface ParticipantQrBadgeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  registration: (RegistrationRow & { retreats?: RetreatRow | null }) | null;
  participantName: string;
}

export function ParticipantQrBadgeDialog({
  isOpen,
  onClose,
  registration,
  participantName,
}: ParticipantQrBadgeDialogProps) {
  if (!registration) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm" className="p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="size-5 text-primary shrink-0" />
            <span>Crachá Digital (Check-in)</span>
          </DialogTitle>
          <DialogDescription>
            Apresente este QR Code na recepção do evento para confirmar sua chegada rapidamente.
          </DialogDescription>
        </DialogHeader>

        <ParticipantQrBadge
          registration={registration}
          participantName={participantName}
        />

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            className="min-h-[44px] w-full sm:w-auto cursor-pointer"
          >
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
