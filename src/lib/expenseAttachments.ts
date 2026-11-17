import supabase from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

export type RetreatExpenseAttachment =
  Database["public"]["Tables"]["retreat_expense_attachments"]["Row"];

export const EXPENSE_ATTACHMENTS_BUCKET = "retreat-expense-attachments";
export const MAX_EXPENSE_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_EXPENSE_ATTACHMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const ALLOWED_EXPENSE_ATTACHMENT_ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";

const EXTENSION_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const ALLOWED_MIME_SET = new Set<string>(ALLOWED_EXPENSE_ATTACHMENT_MIME_TYPES);

/**
 * Resolve o MIME type permitido para um arquivo de comprovante,
 * tratando variações comuns de navegador (ex: image/jpg) e extensão vazia.
 */
export function resolveAttachmentMimeType(file: File): string | null {
  const rawType = file.type.toLowerCase().trim();
  if (rawType === "image/jpg") {
    return "image/jpeg";
  }
  if (rawType) {
    return ALLOWED_MIME_SET.has(rawType) ? rawType : null;
  }

  const ext = file.name.split(".").pop()?.toLowerCase().trim() ?? "";
  return EXTENSION_TO_MIME[ext] ?? null;
}

/**
 * Valida tipo e tamanho (<= 10 MB) de um arquivo de comprovante antes do envio.
 */
export function validateExpenseAttachmentFile(
  file: File
): { valid: true; mimeType: string } | { valid: false; error: string } {
  const mimeType = resolveAttachmentMimeType(file);
  if (!mimeType) {
    return {
      valid: false,
      error: `Formato não permitido em "${file.name}". Envie apenas PDF, JPG, PNG ou WebP.`,
    };
  }

  if (file.size <= 0) {
    return {
      valid: false,
      error: `O arquivo "${file.name}" está vazio.`,
    };
  }

  if (file.size > MAX_EXPENSE_ATTACHMENT_SIZE_BYTES) {
    return {
      valid: false,
      error: `"${file.name}" excede o limite de 10 MB (${formatAttachmentSize(file.size)}).`,
    };
  }

  return { valid: true, mimeType };
}

/**
 * Sanitiza o nome do arquivo preservando a extensão para uso seguro no Supabase Storage.
 */
export function sanitizeAttachmentFileName(fileName: string): string {
  const normalized = fileName.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const lastDot = normalized.lastIndexOf(".");
  const rawBase = lastDot > 0 ? normalized.slice(0, lastDot) : normalized;
  const rawExt = lastDot > 0 ? normalized.slice(lastDot + 1) : "";

  const safeBase =
    rawBase
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64) || "comprovante";

  const safeExt = rawExt
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 10);

  return safeExt ? `${safeBase}.${safeExt}` : safeBase;
}

function generateAttachmentUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Monta o caminho canônico no bucket: `${retreatId}/${expenseId}/${uuid}-${safeFileName}`.
 */
export function buildExpenseAttachmentPath(
  retreatId: string,
  expenseId: string,
  fileName: string
): string {
  const safeFileName = sanitizeAttachmentFileName(fileName);
  const uuid = generateAttachmentUuid();
  return `${retreatId}/${expenseId}/${uuid}-${safeFileName}`;
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function isImageMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("image/");
}

export function isPdfMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase() === "application/pdf";
}

export interface AttachmentUploadFailure {
  file: File;
  reason: string;
}

export interface AttachmentUploadBatchResult {
  succeeded: RetreatExpenseAttachment[];
  failed: AttachmentUploadFailure[];
}

/**
 * Faz upload de múltiplos arquivos e vincula cada um em `retreat_expense_attachments`.
 * Se a gravação no banco falhar após o upload, remove o objeto do Storage para evitar órfãos.
 */
export async function uploadExpenseAttachments(params: {
  retreatId: string;
  expenseId: string;
  files: File[];
  uploadedByProfileId: string | null;
}): Promise<AttachmentUploadBatchResult> {
  const { retreatId, expenseId, files, uploadedByProfileId } = params;
  const succeeded: RetreatExpenseAttachment[] = [];
  const failed: AttachmentUploadFailure[] = [];

  for (const file of files) {
    const validation = validateExpenseAttachmentFile(file);
    if (!validation.valid) {
      failed.push({ file, reason: validation.error });
      continue;
    }

    const filePath = buildExpenseAttachmentPath(retreatId, expenseId, file.name);
    const { error: uploadError } = await supabase.storage
      .from(EXPENSE_ATTACHMENTS_BUCKET)
      .upload(filePath, file, {
        contentType: validation.mimeType,
        upsert: false,
      });

    if (uploadError) {
      failed.push({ file, reason: uploadError.message });
      continue;
    }

    const { data: insertedRow, error: insertError } = await supabase
      .from("retreat_expense_attachments")
      .insert({
        expense_id: expenseId,
        retreat_id: retreatId,
        file_name: file.name,
        file_path: filePath,
        mime_type: validation.mimeType,
        file_size: file.size,
        uploaded_by: uploadedByProfileId,
      })
      .select()
      .single();

    if (insertError || !insertedRow) {
      await supabase.storage
        .from(EXPENSE_ATTACHMENTS_BUCKET)
        .remove([filePath])
        .catch((cleanupErr) => {
          console.error("Erro ao limpar objeto órfão no Storage:", cleanupErr);
        });
      failed.push({
        file,
        reason: insertError?.message || "Falha ao registrar metadados do anexo.",
      });
      continue;
    }

    succeeded.push(insertedRow);
  }

  return { succeeded, failed };
}

function isStorageNotFoundError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("not found") || normalized.includes("no such");
}

/**
 * Remove um anexo do Storage e da tabela `retreat_expense_attachments`.
 */
export async function deleteExpenseAttachment(
  attachment: Pick<RetreatExpenseAttachment, "id" | "file_path">
): Promise<void> {
  const { error: storageError } = await supabase.storage
    .from(EXPENSE_ATTACHMENTS_BUCKET)
    .remove([attachment.file_path]);

  if (storageError && !isStorageNotFoundError(storageError.message)) {
    throw new Error(storageError.message);
  }

  const { error: dbError } = await supabase
    .from("retreat_expense_attachments")
    .delete()
    .eq("id", attachment.id);

  if (dbError) {
    throw new Error(dbError.message);
  }
}

/**
 * Limpa os objetos do Storage vinculados à despesa antes de excluí-la do banco.
 */
export async function deleteExpenseWithAttachments(
  expenseId: string
): Promise<void> {
  const { data: attachments, error: fetchError } = await supabase
    .from("retreat_expense_attachments")
    .select("id, file_path")
    .eq("expense_id", expenseId);

  if (fetchError) {
    throw new Error(fetchError.message);
  }

  const paths = (attachments ?? []).map((item) => item.file_path).filter(Boolean);
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from(EXPENSE_ATTACHMENTS_BUCKET)
      .remove(paths);

    if (storageError && !isStorageNotFoundError(storageError.message)) {
      throw new Error(storageError.message);
    }
  }

  const { error: deleteError } = await supabase
    .from("retreat_expenses")
    .delete()
    .eq("id", expenseId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }
}
