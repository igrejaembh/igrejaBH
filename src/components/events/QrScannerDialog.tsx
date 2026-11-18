import { useEffect, useRef, useState, useMemo, useCallback, useId } from "react";
import {
  Html5Qrcode,
  Html5QrcodeScannerState,
  Html5QrcodeSupportedFormats,
  type CameraDevice,
} from "html5-qrcode";
import {
  Camera,
  CameraOff,
  QrCode,
  Search,
  RefreshCw,
  AlertCircle,
  Loader2,
  UserCheck,
  CheckCircle2,
  Bed,
} from "lucide-react";
import { toast } from "sonner";
import supabase from "@/lib/supabase";
import { extractQrToken } from "@/lib/checkinFlags";
import { getParticipantName, getParticipantRoom } from "@/lib/eventPrintUtils";
import type { RegistrationWithDetails } from "./RegistrationDetailDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

interface QrCheckinRpcResult {
  success: boolean;
  id?: string;
  retreat_id?: string;
  status?: "confirmado" | "presente" | "cancelado";
  checked_in_at?: string | null;
  checked_in_by?: string | null;
  already_checked_in?: boolean;
  qr_token?: string;
  error?: string;
  message?: string;
}

export interface QrScannerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  retreatId: string;
  retreatTitle: string;
  registrations: RegistrationWithDetails[];
  onQrCheckInSuccess: (payload: {
    registrationId: string;
    checkedInAt: string;
    checkedInBy: string | null;
    alreadyCheckedIn: boolean;
  }) => void;
  onManualSelectParticipant: (registration: RegistrationWithDetails) => Promise<void> | void;
}

function mapCameraError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err || "");
  const lower = msg.toLowerCase();
  if (lower.includes("notallowed") || lower.includes("permission")) {
    return "Permissão de câmera negada. Libere o acesso nas configurações do navegador ou utilize o código/busca manual abaixo.";
  }
  if (
    lower.includes("notfound") ||
    lower.includes("no camera") ||
    lower.includes("requested device not found")
  ) {
    return "Nenhuma câmera encontrada neste dispositivo. Utilize o código QR manual ou a busca de participantes abaixo.";
  }
  if (lower.includes("notreadable") || lower.includes("in use")) {
    return "A câmera está em uso por outro aplicativo. Feche o outro aplicativo ou use a entrada manual abaixo.";
  }
  if (lower.includes("insecure") || lower.includes("https")) {
    return "O navegador bloqueou a câmera em conexão sem HTTPS. Use a entrada manual de código QR ou busca abaixo.";
  }
  return "Não foi possível iniciar a câmera neste dispositivo. Utilize o código QR manual ou a busca abaixo.";
}

export function QrScannerDialog({
  isOpen,
  onClose,
  retreatId,
  retreatTitle,
  registrations,
  onQrCheckInSuccess,
  onManualSelectParticipant,
}: QrScannerDialogProps) {
  const rawId = useId();
  const scannerElementId = `qr-scanner-region-${rawId.replace(/:/g, "")}`;

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scanLockRef = useRef<boolean>(false);
  const cooldownTimerRef = useRef<number | null>(null);

  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [manualToken, setManualToken] = useState("");
  const [submittingToken, setSubmittingToken] = useState(false);
  const [scanErrorAlert, setScanErrorAlert] = useState<string | null>(null);

  const [manualSearch, setManualSearch] = useState("");
  const [processingManualId, setProcessingManualId] = useState<string | null>(null);

  const stopScannerSafely = useCallback(async () => {
    const instance = scannerRef.current;
    if (!instance) return;
    scannerRef.current = null;
    try {
      const state = instance.getState();
      if (
        state === Html5QrcodeScannerState.SCANNING ||
        state === Html5QrcodeScannerState.PAUSED
      ) {
        await instance.stop();
      }
    } catch {
      // Ignora erro caso scanner já tenha parado
    }
    try {
      instance.clear();
    } catch {
      // Ignora erro de limpeza DOM após desmontagem
    }
    setCameraActive(false);
  }, []);

  const processQrToken = useCallback(
    async (rawDecodedText: string) => {
      if (scanLockRef.current) return;
      const cleanToken = extractQrToken(rawDecodedText);
      if (!cleanToken) {
        setScanErrorAlert("Código QR vazio ou inválido.");
        return;
      }

      scanLockRef.current = true;
      setSubmittingToken(true);
      setScanErrorAlert(null);

      try {
        const { data, error } = await supabase.rpc("checkin_registration_by_qr", {
          p_retreat_id: retreatId,
          p_qr_token: cleanToken,
        });

        if (error) throw error;

        const res = data as unknown as QrCheckinRpcResult | null;
        if (!res || !res.success || !res.id) {
          const errMsg =
            res?.message || "Não foi possível confirmar a inscrição com este QR Code.";
          setScanErrorAlert(errMsg);
          toast.error(errMsg);
          if (cooldownTimerRef.current) {
            window.clearTimeout(cooldownTimerRef.current);
          }
          cooldownTimerRef.current = window.setTimeout(() => {
            scanLockRef.current = false;
          }, 1500);
          return;
        }

        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          try {
            navigator.vibrate?.([60, 40, 60]);
          } catch {
            // Ignora caso navegador bloqueie vibração
          }
        }

        await stopScannerSafely();
        setManualToken("");
        onQrCheckInSuccess({
          registrationId: res.id,
          checkedInAt: res.checked_in_at || new Date().toISOString(),
          checkedInBy: res.checked_in_by || null,
          alreadyCheckedIn: Boolean(res.already_checked_in),
        });
        onClose();
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : "Erro ao validar QR Code no servidor.";
        setScanErrorAlert(msg);
        toast.error(msg);
        if (cooldownTimerRef.current) {
          window.clearTimeout(cooldownTimerRef.current);
        }
        cooldownTimerRef.current = window.setTimeout(() => {
          scanLockRef.current = false;
        }, 1500);
      } finally {
        setSubmittingToken(false);
      }
    },
    [retreatId, onQrCheckInSuccess, onClose, stopScannerSafely]
  );

  const startScanner = useCallback(
    async (explicitCameraId?: string) => {
      await stopScannerSafely();

      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== "function"
      ) {
        setCameraError(
          "Câmera indisponível neste navegador ou ambiente. Utilize o código QR manual ou a busca abaixo."
        );
        return;
      }

      const targetEl = document.getElementById(scannerElementId);
      if (!targetEl) return;

      setCameraStarting(true);
      setCameraError(null);

      try {
        const detectedCameras = await Html5Qrcode.getCameras();
        setCameras(detectedCameras);

        if (!detectedCameras || detectedCameras.length === 0) {
          setCameraError(
            "Nenhuma câmera foi detectada neste dispositivo. Utilize o código QR manual ou a busca abaixo."
          );
          setCameraStarting(false);
          return;
        }

        let cameraIdToUse = explicitCameraId || selectedCameraId;
        if (
          !cameraIdToUse ||
          !detectedCameras.some((c) => c.id === cameraIdToUse)
        ) {
          const backCamera = detectedCameras.find((c) =>
            /back|rear|traseira|environment/i.test(c.label)
          );
          cameraIdToUse = backCamera ? backCamera.id : detectedCameras[0].id;
          setSelectedCameraId(cameraIdToUse);
        }

        const scanner = new Html5Qrcode(scannerElementId, {
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
          verbose: false,
        });
        scannerRef.current = scanner;

        await scanner.start(
          cameraIdToUse,
          {
            fps: 10,
            qrbox: { width: 220, height: 220 },
            aspectRatio: 1.0,
          },
          (decodedText) => {
            void processQrToken(decodedText);
          },
          () => {
            // Frame sem QR code detectado (comportamento normal)
          }
        );

        setCameraActive(true);
      } catch (err: unknown) {
        setCameraError(mapCameraError(err));
        await stopScannerSafely();
      } finally {
        setCameraStarting(false);
      }
    },
    [scannerElementId, selectedCameraId, stopScannerSafely, processQrToken]
  );

  useEffect(() => {
    if (!isOpen) {
      scanLockRef.current = false;
      setScanErrorAlert(null);
      setManualToken("");
      setManualSearch("");
      if (cooldownTimerRef.current) {
        window.clearTimeout(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
      void stopScannerSafely();
      return;
    }

    scanLockRef.current = false;
    setScanErrorAlert(null);
    const frameId = window.requestAnimationFrame(() => {
      void startScanner();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (cooldownTimerRef.current) {
        window.clearTimeout(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
      void stopScannerSafely();
    };
  }, [isOpen, startScanner, stopScannerSafely]);

  const handleManualTokenSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualToken.trim()) return;
    scanLockRef.current = false;
    void processQrToken(manualToken);
  };

  const activeCandidates = useMemo(() => {
    const active = registrations.filter(
      (r) => (r.status || "confirmado") !== "cancelado"
    );
    const q = manualSearch.trim().toLowerCase();
    if (!q) return active.slice(0, 6);

    const digits = q.replace(/\D/g, "");
    return active
      .filter((reg) => {
        const name = getParticipantName(reg).toLowerCase();
        const cpf = (
          reg.profiles?.cpf ||
          (reg.guest_data as { cpf?: string } | null)?.cpf ||
          ""
        ).replace(/\D/g, "");
        const email = (
          reg.profiles?.email ||
          (reg.guest_data as { email?: string } | null)?.email ||
          ""
        ).toLowerCase();
        const token = (reg.qr_token || "").toLowerCase();

        return (
          name.includes(q) ||
          email.includes(q) ||
          token.includes(q) ||
          (digits.length > 0 && cpf.includes(digits))
        );
      })
      .slice(0, 8);
  }, [registrations, manualSearch]);

  const handleManualParticipantAction = async (reg: RegistrationWithDetails) => {
    if (processingManualId) return;
    setProcessingManualId(reg.id);
    try {
      await stopScannerSafely();
      await onManualSelectParticipant(reg);
      onClose();
    } finally {
      setProcessingManualId(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg" className="p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="size-5 text-primary shrink-0" />
            <span>Ler QR Code na Portaria</span>
          </DialogTitle>
          <DialogDescription>
            Aponte a câmera para o crachá do irmão em{" "}
            <strong>{retreatTitle}</strong> ou informe o código manualmente.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {scanErrorAlert && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Não foi possível validar o crachá</AlertTitle>
              <AlertDescription>{scanErrorAlert}</AlertDescription>
            </Alert>
          )}

          {/* Seção da Câmera */}
          <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                {cameraActive ? (
                  <Camera className="size-4 text-primary" />
                ) : (
                  <CameraOff className="size-4 text-muted-foreground" />
                )}
                <span>
                  {cameraStarting
                    ? "Iniciando câmera..."
                    : cameraActive
                    ? "Câmera ativa — posicione o QR Code no quadro"
                    : "Leitor por câmera"}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {cameras.length > 1 && (
                  <Select
                    value={selectedCameraId}
                    onValueChange={(val) => {
                      setSelectedCameraId(val);
                      void startScanner(val);
                    }}
                  >
                    <SelectTrigger className="min-h-[44px] w-[180px] text-xs">
                      <SelectValue placeholder="Trocar câmera" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {cameras.map((cam, index) => (
                          <SelectItem key={cam.id} value={cam.id}>
                            {cam.label || `Câmera ${index + 1}`}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={cameraStarting}
                  onClick={() => void startScanner()}
                  className="min-h-[44px] px-3 text-xs cursor-pointer"
                >
                  {cameraStarting ? (
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <RefreshCw data-icon="inline-start" />
                  )}
                  <span>{cameraActive ? "Reiniciar câmera" : "Tentar câmera"}</span>
                </Button>
              </div>
            </div>

            {cameraError ? (
              <Alert>
                <CameraOff />
                <AlertTitle>Câmera indisponível</AlertTitle>
                <AlertDescription>{cameraError}</AlertDescription>
              </Alert>
            ) : null}

            <div
              id={scannerElementId}
              className={
                cameraError
                  ? "hidden"
                  : "mx-auto w-full max-w-[340px] overflow-hidden rounded-xl border border-border bg-background min-h-[220px]"
              }
            />
          </div>

          {/* Entrada Manual de Token QR */}
          <form
            onSubmit={handleManualTokenSubmit}
            className="flex flex-col gap-2"
          >
            <Field>
              <FieldLabel htmlFor="manual-qr-token" className="text-xs font-semibold">
                Código do crachá (entrada manual ou leitor USB)
              </FieldLabel>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <Input
                  id="manual-qr-token"
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  placeholder="Cole ou digite o código do QR Code..."
                  className="min-h-[44px] font-mono text-xs flex-1"
                  autoComplete="off"
                />
                <Button
                  type="submit"
                  disabled={submittingToken || !manualToken.trim()}
                  className="min-h-[44px] px-4 text-xs font-bold cursor-pointer shrink-0"
                >
                  {submittingToken ? (
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <UserCheck data-icon="inline-start" />
                  )}
                  <span>Validar Código</span>
                </Button>
              </div>
            </Field>
          </form>

          <Separator />

          {/* Busca Manual por Participante */}
          <div className="flex flex-col gap-2.5">
            <Field>
              <FieldLabel htmlFor="manual-participant-search" className="text-xs font-semibold">
                Ou buscar participante manualmente (nome ou CPF)
              </FieldLabel>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="manual-participant-search"
                  value={manualSearch}
                  onChange={(e) => setManualSearch(e.target.value)}
                  placeholder="Digite o nome, CPF ou código do irmão..."
                  className="min-h-[44px] pl-9 text-xs"
                  autoComplete="off"
                />
              </div>
            </Field>

            <div className="flex max-h-48 flex-col gap-2 overflow-y-auto pr-1 custom-scrollbar">
              {activeCandidates.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  Nenhum participante ativo encontrado para essa busca.
                </p>
              ) : (
                activeCandidates.map((reg) => {
                  const name = getParticipantName(reg);
                  const room = getParticipantRoom(reg);
                  const isPresent =
                    reg.status === "presente" || Boolean(reg.checked_in_at);
                  const busy = processingManualId === reg.id;

                  return (
                    <div
                      key={reg.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-border bg-card p-2.5"
                    >
                      <div className="min-w-0 flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-xs sm:text-sm font-bold text-foreground">
                            {name}
                          </span>
                          {isPresent && (
                            <Badge variant="secondary" className="shrink-0">
                              <CheckCircle2 className="mr-1 size-3" />
                              <span>Presente</span>
                            </Badge>
                          )}
                        </div>
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground truncate">
                          <Bed className="size-3 shrink-0" />
                          <span className="truncate">
                            {room === "Pendente" ? "Sem quarto alocado" : room}
                          </span>
                        </span>
                      </div>

                      <Button
                        type="button"
                        variant={isPresent ? "outline" : "default"}
                        size="sm"
                        disabled={busy}
                        onClick={() => void handleManualParticipantAction(reg)}
                        className="min-h-[44px] shrink-0 px-3 text-xs font-semibold cursor-pointer"
                      >
                        {busy ? (
                          <Loader2 className="animate-spin" data-icon="inline-start" />
                        ) : (
                          <UserCheck data-icon="inline-start" />
                        )}
                        <span>
                          {isPresent ? "Abrir card" : "Confirmar e abrir"}
                        </span>
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="min-h-[44px] cursor-pointer"
          >
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
