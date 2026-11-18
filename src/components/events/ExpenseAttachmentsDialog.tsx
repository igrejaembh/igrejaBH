import { useEffect, useRef, useState } from "react";
import {
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import supabase from "@/lib/supabase";
import { THEME_CLASSES } from "@/constants/colors";
import {
  ALLOWED_EXPENSE_ATTACHMENT_ACCEPT,
  EXPENSE_ATTACHMENTS_BUCKET,
  deleteExpenseAttachment,
  formatAttachmentSize,
  isImageMimeType,
  isPdfMimeType,
  uploadExpenseAttachments,
  validateExpenseAttachmentFile,
  type RetreatExpenseAttachment,
} from "@/lib/expenseAttachments";
import type { Database } from "@/lib/database.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type RetreatExpense = Database["public"]["Tables"]["retreat_expenses"]["Row"];

interface ExpenseAttachmentsDialogProps {
  expense: RetreatExpense | null;
  attachments: RetreatExpenseAttachment[];
  isOpen: boolean;
  onClose: () => void;
  onAttachmentsChanged: () => Promise<void> | void;
  uploadedByProfileId: string | null;
}

export function ExpenseAttachmentsDialog({
  expense,
  attachments,
  isOpen,
  onClose,
  onAttachmentsChanged,
  uploadedByProfileId,
}: ExpenseAttachmentsDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedAttachment =
    attachments.find((item) => item.id === selectedId) ?? attachments[0] ?? null;

  // Sincroniza seleção inicial / após exclusão
  useEffect(() => {
    if (!isOpen) {
      setSignedUrl(null);
      setUrlError(null);
      setConfirmDeleteId(null);
      setImageLoadFailed(false);
      return;
    }

    if (attachments.length === 0) {
      setSelectedId(null);
      setSignedUrl(null);
      setUrlError(null);
      return;
    }

    if (!selectedId || !attachments.some((item) => item.id === selectedId)) {
      setSelectedId(attachments[0].id);
    }
  }, [isOpen, attachments, selectedId]);

  // Busca URL assinada (300s) para o anexo selecionado
  useEffect(() => {
    if (!isOpen || !selectedAttachment) return;

    let active = true;
    const targetPath = selectedAttachment.file_path;

    async function loadSignedUrl() {
      setLoadingUrl(true);
      setUrlError(null);
      setImageLoadFailed(false);
      try {
        const { data, error } = await supabase.storage
          .from(EXPENSE_ATTACHMENTS_BUCKET)
          .createSignedUrl(targetPath, 300);

        if (!active) return;

        if (error || !data?.signedUrl) {
          throw new Error(error?.message || "Não foi possível gerar o link do arquivo.");
        }

        setSignedUrl(data.signedUrl);
      } catch (err: unknown) {
        if (!active) return;
        const message =
          err instanceof Error ? err.message : "Erro ao carregar visualização.";
        setSignedUrl(null);
        setUrlError(message);
      } finally {
        if (active) {
          setLoadingUrl(false);
        }
      }
    }

    void loadSignedUrl();

    return () => {
      active = false;
    };
  }, [isOpen, selectedAttachment, reloadNonce]);

  const handleDownload = async (attachment: RetreatExpenseAttachment) => {
    setDownloadingId(attachment.id);
    try {
      const { data, error } = await supabase.storage
        .from(EXPENSE_ATTACHMENTS_BUCKET)
        .createSignedUrl(attachment.file_path, 300, {
          download: attachment.file_name,
        });

      if (error || !data?.signedUrl) {
        throw new Error(error?.message || "Erro ao gerar link para download.");
      }

      const link = document.createElement("a");
      link.href = data.signedUrl;
      link.download = attachment.file_name;
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Não foi possível baixar o arquivo.";
      toast.error(message);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleConfirmDelete = async (attachment: RetreatExpenseAttachment) => {
    setDeletingId(attachment.id);
    try {
      await deleteExpenseAttachment(attachment);
      toast.success(`Comprovante "${attachment.file_name}" removido.`);
      setConfirmDeleteId(null);
      await onAttachmentsChanged();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Erro ao excluir comprovante.";
      toast.error(message);
    } finally {
      setDeletingId(null);
    }
  };

  const handleFilesSelected = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!expense || selectedFiles.length === 0) return;

    const validFiles: File[] = [];
    for (const file of selectedFiles) {
      const check = validateExpenseAttachmentFile(file);
      if (!check.valid) {
        toast.error(check.error);
      } else {
        validFiles.push(file);
      }
    }

    if (validFiles.length === 0) return;

    setUploading(true);
    try {
      const result = await uploadExpenseAttachments({
        retreatId: expense.retreat_id,
        expenseId: expense.id,
        files: validFiles,
        uploadedByProfileId,
      });

      if (result.succeeded.length > 0) {
        toast.success(
          result.succeeded.length === 1
            ? "Comprovante anexado com sucesso."
            : `${result.succeeded.length} comprovantes anexados com sucesso.`
        );
        await onAttachmentsChanged();
        setSelectedId(result.succeeded[0].id);
      }

      if (result.failed.length > 0) {
        const failedNames = result.failed
          .map((item) => `${item.file.name} (${item.reason})`)
          .join("; ");
        toast.error(`Falha ao enviar: ${failedNames}`);
      }
    } finally {
      setUploading(false);
    }
  };

  const formattedAmount = expense
    ? Number(expense.amount || 0).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "0,00";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg" className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <DialogHeader className="pr-10">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg font-bold text-foreground">
            <Paperclip className="size-5 text-primary shrink-0" />
            <span className="truncate">Comprovantes da Despesa</span>
          </DialogTitle>
          {expense && (
            <DialogDescription className="text-xs text-muted-foreground break-words">
              {expense.description} • R$ {formattedAmount}
            </DialogDescription>
          )}
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ALLOWED_EXPENSE_ATTACHMENT_ACCEPT}
          onChange={handleFilesSelected}
          className="sr-only"
          aria-label="Selecionar arquivos de comprovante"
        />

        <div className="flex flex-col gap-4 min-w-0">
          {/* Barra superior de anexos */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {attachments.length === 0
                ? "Nenhum comprovante anexado"
                : `${attachments.length} ${
                    attachments.length === 1 ? "arquivo anexado" : "arquivos anexados"
                  }`}
            </span>

            <Button
              type="button"
              variant="outline"
              disabled={uploading || !expense}
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[44px] cursor-pointer"
            >
              {uploading ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Plus data-icon="inline-start" />
              )}
              <span>{uploading ? "Enviando..." : "Anexar Arquivo"}</span>
            </Button>
          </div>

          {attachments.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 p-6 sm:p-10 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Paperclip className="size-5" />
              </div>
              <div className="flex flex-col gap-1 max-w-sm">
                <p className="text-sm font-semibold text-foreground">
                  Nenhum comprovante vinculado
                </p>
                <p className="text-xs text-muted-foreground">
                  Adicione notas fiscais ou recibos em PDF, JPG, PNG ou WebP (até 10 MB por arquivo).
                </p>
              </div>
              <Button
                type="button"
                variant="default"
                disabled={uploading || !expense}
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[44px] cursor-pointer"
              >
                <Plus data-icon="inline-start" />
                <span>Selecionar Comprovante</span>
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4 min-w-0">
              {/* Lista selecionável de comprovantes */}
              <div className="flex flex-col gap-2 max-h-44 overflow-y-auto pr-1 custom-scrollbar">
                {attachments.map((att) => {
                  const isSelected = selectedAttachment?.id === att.id;
                  const isConfirming = confirmDeleteId === att.id;
                  const isDeleting = deletingId === att.id;
                  const isPdf = isPdfMimeType(att.mime_type);

                  return (
                    <div
                      key={att.id}
                      className={cn(
                        "flex flex-col gap-2 rounded-xl border p-2.5 transition-colors min-w-0",
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "border-border bg-background/60 hover:bg-muted/40"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmDeleteId(null);
                            setSelectedId(att.id);
                          }}
                          className="flex min-h-[44px] flex-1 items-center gap-2.5 text-left min-w-0 cursor-pointer rounded-lg px-1.5"
                        >
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                            {isPdf ? (
                              <FileText className="size-4" />
                            ) : (
                              <ImageIcon className="size-4" />
                            )}
                          </div>
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="truncate text-xs font-semibold text-foreground">
                              {att.file_name}
                            </span>
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                              <Badge variant="outline" className="text-[10px]">
                                {isPdf ? "PDF" : "Imagem"}
                              </Badge>
                              <span>{formatAttachmentSize(att.file_size)}</span>
                            </div>
                          </div>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={downloadingId === att.id}
                            onClick={() => handleDownload(att)}
                            aria-label={`Baixar ${att.file_name}`}
                            title="Baixar comprovante"
                            className="min-h-[44px] min-w-[44px] cursor-pointer"
                          >
                            {downloadingId === att.id ? (
                              <Spinner />
                            ) : (
                              <Download />
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={isDeleting}
                            onClick={() =>
                              setConfirmDeleteId(isConfirming ? null : att.id)
                            }
                            aria-label={`Excluir ${att.file_name}`}
                            title="Excluir comprovante"
                            className="min-h-[44px] min-w-[44px] text-destructive hover:bg-destructive/10 hover:text-destructive cursor-pointer"
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>

                      {isConfirming && (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
                          <span className="text-xs font-medium text-destructive">
                            Confirmar exclusão deste comprovante?
                          </span>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={isDeleting}
                              onClick={() => setConfirmDeleteId(null)}
                              className="min-h-[44px] px-3 cursor-pointer"
                            >
                              Cancelar
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              disabled={isDeleting}
                              onClick={() => handleConfirmDelete(att)}
                              className="min-h-[44px] px-3 cursor-pointer"
                            >
                              {isDeleting && <Spinner data-icon="inline-start" />}
                              <span>Excluir</span>
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <Separator />

              {/* Área de Pré-visualização */}
              {selectedAttachment && (
                <div className="flex flex-col gap-3 min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="truncate text-xs font-semibold text-foreground">
                        {selectedAttachment.file_name}
                      </span>
                      <span className={THEME_CLASSES.badgeNeutral}>
                        {formatAttachmentSize(selectedAttachment.file_size)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {signedUrl && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          asChild
                          className="min-h-[44px] px-3 cursor-pointer"
                        >
                          <a
                            href={signedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink data-icon="inline-start" />
                            <span>Abrir</span>
                          </a>
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        disabled={downloadingId === selectedAttachment.id}
                        onClick={() => handleDownload(selectedAttachment)}
                        className="min-h-[44px] px-3 cursor-pointer"
                      >
                        {downloadingId === selectedAttachment.id ? (
                          <Spinner data-icon="inline-start" />
                        ) : (
                          <Download data-icon="inline-start" />
                        )}
                        <span>Baixar</span>
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-muted/20 p-2 sm:p-3 min-w-0 overflow-hidden">
                    {loadingUrl ? (
                      <Skeleton className="h-[320px] w-full rounded-lg" />
                    ) : urlError ? (
                      <div className="flex flex-col items-center justify-center gap-3 py-10 px-4 text-center">
                        <p className="text-xs font-medium text-destructive">
                          {urlError}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setReloadNonce((n) => n + 1)}
                          className="min-h-[44px] cursor-pointer"
                        >
                          <RefreshCw data-icon="inline-start" />
                          <span>Tentar novamente</span>
                        </Button>
                      </div>
                    ) : !signedUrl ? null : isImageMimeType(
                        selectedAttachment.mime_type
                      ) ? (
                      imageLoadFailed ? (
                        <div className="flex flex-col items-center justify-center gap-3 py-10 px-4 text-center">
                          <p className="text-xs text-muted-foreground">
                            Não foi possível renderizar esta imagem inline. Use o botão Baixar ou Abrir.
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleDownload(selectedAttachment)}
                            className="min-h-[44px] cursor-pointer"
                          >
                            <Download data-icon="inline-start" />
                            <span>Baixar Imagem</span>
                          </Button>
                        </div>
                      ) : (
                        <img
                          src={signedUrl}
                          alt={selectedAttachment.file_name}
                          onError={() => setImageLoadFailed(true)}
                          className="max-h-[420px] w-full object-contain rounded-lg mx-auto"
                        />
                      )
                    ) : isPdfMimeType(selectedAttachment.mime_type) ? (
                      <div className="flex flex-col gap-2">
                        <iframe
                          src={signedUrl}
                          title={selectedAttachment.file_name}
                          className="w-full h-[340px] sm:h-[440px] rounded-lg border border-border bg-background"
                        />
                        <p className="text-[11px] text-muted-foreground text-center">
                          Caso seu navegador móvel não exiba o PDF embutido, utilize &ldquo;Abrir&rdquo; ou &ldquo;Baixar&rdquo;.
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-3 py-10 px-4 text-center">
                        <FileText className="size-8 text-muted-foreground" />
                        <p className="text-xs text-muted-foreground">
                          Pré-visualização indisponível para este formato.
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => handleDownload(selectedAttachment)}
                          className="min-h-[44px] cursor-pointer"
                        >
                          <Download data-icon="inline-start" />
                          <span>Baixar Arquivo</span>
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="pt-2">
          <Button
            type="button"
            variant="outline"
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
