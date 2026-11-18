import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  DollarSign,
  Edit,
  Eye,
  FileText,
  Image as ImageIcon,
  Paperclip,
  PieChart,
  Plus,
  Receipt,
  Trash2,
  TrendingDown,
  TrendingUp,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import supabase from "@/lib/supabase";
import { THEME_CLASSES } from "@/constants/colors";
import {
  ALLOWED_EXPENSE_ATTACHMENT_ACCEPT,
  deleteExpenseAttachment,
  deleteExpenseWithAttachments,
  formatAttachmentSize,
  isPdfMimeType,
  uploadExpenseAttachments,
  validateExpenseAttachmentFile,
  type RetreatExpenseAttachment,
} from "@/lib/expenseAttachments";
import type { Database } from "@/lib/database.types";
import { cn } from "@/lib/utils";
import { ExpenseAttachmentsDialog } from "@/components/events/ExpenseAttachmentsDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type RetreatExpense =
  Database["public"]["Tables"]["retreat_expenses"]["Row"];

interface EventFinanceTabProps {
  retreatId: string;
  totalIncome: number;
  pendingIncome: number;
}

interface PendingAttachmentItem {
  id: string;
  file: File;
  error?: string;
}

const SELECTABLE_CATEGORIES: Record<string, string> = {
  local: "Aluguel de Local / Sítio",
  alimentacao: "Alimentação / Cozinha",
  transporte: "Transporte / Ônibus",
  material: "Material & Impressões",
  som_multimidia: "Som & Multimídia",
  outros: "Outras Despesas",
};

const CATEGORIES_DISPLAY_MAP: Record<string, string> = {
  ...SELECTABLE_CATEGORIES,
  aluguel: "Aluguel / Locação",
  som: "Som & Áudio",
};

const expenseFormSchema = z.object({
  description: z
    .string()
    .trim()
    .min(2, { message: "Informe uma descrição para a despesa." }),
  amount: z.coerce
    .number({ message: "Informe um valor numérico válido." })
    .positive({ message: "O valor da despesa deve ser maior que zero." }),
  expense_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Informe uma data válida." }),
  category: z.string().min(1, { message: "Selecione uma categoria." }),
  notes: z.string().default(""),
});

type ExpenseFormValues = z.infer<typeof expenseFormSchema>;

function formatCurrencyBRL(value: number): string {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getTodayIsoDate(): string {
  return new Date().toISOString().split("T")[0];
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return fallback;
}

export function EventFinanceTab({
  retreatId,
  totalIncome,
  pendingIncome,
}: EventFinanceTabProps) {
  const [expenses, setExpenses] = useState<RetreatExpense[]>([]);
  const [attachments, setAttachments] = useState<RetreatExpenseAttachment[]>([]);
  const [loadingExpenses, setLoadingExpenses] = useState(true);
  const [currentProfileId, setCurrentProfileId] = useState<string | null>(null);

  // Create / Edit Expense Dialog State
  const [isExpenseDialogOpen, setIsExpenseDialogOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<RetreatExpense | null>(
    null
  );
  const [pendingFiles, setPendingFiles] = useState<PendingAttachmentItem[]>([]);
  const [uploadNoticeError, setUploadNoticeError] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [confirmDeleteAttId, setConfirmDeleteAttId] = useState<string | null>(
    null
  );
  const [deletingAttId, setDeletingAttId] = useState<string | null>(null);
  const [submittingExpense, setSubmittingExpense] = useState(false);

  // Viewer Dialog State
  const [viewerExpenseId, setViewerExpenseId] = useState<string | null>(null);

  // Delete Expense Confirmation Dialog State
  const [expenseToDelete, setExpenseToDelete] = useState<RetreatExpense | null>(
    null
  );
  const [deletingExpense, setDeletingExpense] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { control, handleSubmit, reset } = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema) as Resolver<ExpenseFormValues>,
    defaultValues: {
      description: "",
      amount: 0,
      expense_date: getTodayIsoDate(),
      category: "outros",
      notes: "",
    },
  });

  useEffect(() => {
    let active = true;
    async function loadProfile() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.user || !active) return;

        const { data: profile } = await supabase
          .from("profiles")
          .select("id")
          .eq("user_id", session.user.id)
          .maybeSingle();

        if (active && profile?.id) {
          setCurrentProfileId(profile.id);
        }
      } catch (err) {
        console.warn("Não foi possível identificar o perfil do usuário:", err);
      }
    }
    void loadProfile();
    return () => {
      active = false;
    };
  }, []);

  const fetchExpenses = useCallback(async () => {
    if (!retreatId) return;
    setLoadingExpenses(true);
    try {
      const [expensesRes, attachmentsRes] = await Promise.all([
        supabase
          .from("retreat_expenses")
          .select("*")
          .eq("retreat_id", retreatId)
          .order("expense_date", { ascending: false }),
        supabase
          .from("retreat_expense_attachments")
          .select("*")
          .eq("retreat_id", retreatId)
          .order("created_at", { ascending: true }),
      ]);

      if (expensesRes.error) throw expensesRes.error;
      if (attachmentsRes.error) throw attachmentsRes.error;

      setExpenses(expensesRes.data ?? []);
      setAttachments(attachmentsRes.data ?? []);
    } catch (err: unknown) {
      console.error("Erro ao buscar despesas:", err);
      toast.error(
        getErrorMessage(err, "Erro ao carregar lançamentos de despesas.")
      );
    } finally {
      setLoadingExpenses(false);
    }
  }, [retreatId]);

  useEffect(() => {
    void fetchExpenses();
  }, [fetchExpenses]);

  const attachmentsByExpenseId = useMemo(() => {
    const grouped: Record<string, RetreatExpenseAttachment[]> = {};
    for (const item of attachments) {
      if (!grouped[item.expense_id]) {
        grouped[item.expense_id] = [];
      }
      grouped[item.expense_id].push(item);
    }
    return grouped;
  }, [attachments]);

  const editingExpenseAttachments = useMemo(() => {
    if (!editingExpense) return [];
    return attachmentsByExpenseId[editingExpense.id] ?? [];
  }, [attachmentsByExpenseId, editingExpense]);

  const viewerExpense = useMemo(() => {
    if (!viewerExpenseId) return null;
    return expenses.find((item) => item.id === viewerExpenseId) ?? null;
  }, [expenses, viewerExpenseId]);

  const viewerAttachments = useMemo(() => {
    if (!viewerExpenseId) return [];
    return attachmentsByExpenseId[viewerExpenseId] ?? [];
  }, [attachmentsByExpenseId, viewerExpenseId]);

  const handleOpenCreateExpense = () => {
    setEditingExpense(null);
    setPendingFiles([]);
    setUploadNoticeError(null);
    setConfirmDeleteAttId(null);
    reset({
      description: "",
      amount: "" as unknown as number,
      expense_date: getTodayIsoDate(),
      category: "outros",
      notes: "",
    });
    setIsExpenseDialogOpen(true);
  };

  const handleOpenEditExpense = (exp: RetreatExpense) => {
    setEditingExpense(exp);
    setPendingFiles([]);
    setUploadNoticeError(null);
    setConfirmDeleteAttId(null);
    reset({
      description: exp.description,
      amount: Number(exp.amount),
      expense_date: exp.expense_date || getTodayIsoDate(),
      category: exp.category || "outros",
      notes: exp.notes || "",
    });
    setIsExpenseDialogOpen(true);
  };

  const enqueueFiles = (incomingFiles: File[]) => {
    if (incomingFiles.length === 0) return;

    const validationErrors: string[] = [];
    const accepted: PendingAttachmentItem[] = [];

    for (const file of incomingFiles) {
      const check = validateExpenseAttachmentFile(file);
      if (!check.valid) {
        validationErrors.push(check.error);
        continue;
      }

      const duplicate = pendingFiles.some(
        (existing) =>
          existing.file.name === file.name &&
          existing.file.size === file.size &&
          existing.file.lastModified === file.lastModified
      );
      if (duplicate) continue;

      accepted.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        file,
      });
    }

    if (validationErrors.length > 0) {
      const msg = validationErrors[0];
      setUploadNoticeError(validationErrors.join(" "));
      toast.error(msg);
    } else {
      setUploadNoticeError(null);
    }

    if (accepted.length > 0) {
      setPendingFiles((prev) => [...prev, ...accepted]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    enqueueFiles(files);
  };

  const handleDropFiles = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    enqueueFiles(files);
  };

  const handleRemovePendingFile = (pendingId: string) => {
    setPendingFiles((prev) => prev.filter((item) => item.id !== pendingId));
  };

  const handleDeleteExistingAttachmentInForm = async (
    att: RetreatExpenseAttachment
  ) => {
    setDeletingAttId(att.id);
    try {
      await deleteExpenseAttachment(att);
      setConfirmDeleteAttId(null);
      toast.success(`Comprovante "${att.file_name}" excluído.`);
      await fetchExpenses();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Erro ao excluir comprovante."));
    } finally {
      setDeletingAttId(null);
    }
  };

  const handleSaveExpense = async (values: ExpenseFormValues) => {
    setSubmittingExpense(true);
    setUploadNoticeError(null);

    try {
      let savedExpense: RetreatExpense;

      if (editingExpense) {
        const { data, error } = await supabase
          .from("retreat_expenses")
          .update({
            description: values.description.trim(),
            category: values.category,
            amount: Number(values.amount),
            expense_date: values.expense_date,
            notes: values.notes.trim() || null,
          })
          .eq("id", editingExpense.id)
          .select()
          .single();

        if (error || !data) {
          throw error ?? new Error("Falha ao atualizar despesa.");
        }
        savedExpense = data;
      } else {
        const { data, error } = await supabase
          .from("retreat_expenses")
          .insert({
            retreat_id: retreatId,
            description: values.description.trim(),
            category: values.category,
            amount: Number(values.amount),
            expense_date: values.expense_date,
            notes: values.notes.trim() || null,
            created_by: currentProfileId,
          })
          .select()
          .single();

        if (error || !data) {
          throw error ?? new Error("Falha ao lançar despesa.");
        }
        savedExpense = data;
      }

      if (pendingFiles.length > 0) {
        const uploadResult = await uploadExpenseAttachments({
          retreatId,
          expenseId: savedExpense.id,
          files: pendingFiles.map((item) => item.file),
          uploadedByProfileId: currentProfileId,
        });

        await fetchExpenses();

        if (uploadResult.failed.length > 0) {
          // Mantém a despesa em modo de edição para evitar duplicação caso o usuário tente reenviar
          setEditingExpense(savedExpense);

          const failedMap = new Map(
            uploadResult.failed.map((item) => [item.file, item.reason])
          );
          setPendingFiles((prev) =>
            prev
              .filter((item) => failedMap.has(item.file))
              .map((item) => ({
                ...item,
                error: failedMap.get(item.file),
              }))
          );

          const summary =
            uploadResult.succeeded.length > 0
              ? `Despesa salva com ${uploadResult.succeeded.length} comprovante(s), mas ${uploadResult.failed.length} arquivo(s) falharam. Reenvie os pendentes abaixo.`
              : `Despesa salva, porém não foi possível enviar ${uploadResult.failed.length} comprovante(s). Tente novamente abaixo.`;

          setUploadNoticeError(summary);
          toast.error(summary);
          return;
        }
      } else {
        await fetchExpenses();
      }

      toast.success(
        editingExpense
          ? "Despesa atualizada com sucesso!"
          : "Despesa lançada com sucesso!"
      );
      setPendingFiles([]);
      setIsExpenseDialogOpen(false);
    } catch (err: unknown) {
      toast.error(
        `Erro ao salvar despesa: ${getErrorMessage(err, "Erro desconhecido.")}`
      );
    } finally {
      setSubmittingExpense(false);
    }
  };

  const handleConfirmDeleteExpense = async () => {
    if (!expenseToDelete) return;
    setDeletingExpense(true);
    try {
      await deleteExpenseWithAttachments(expenseToDelete.id);
      toast.success("Despesa e comprovantes vinculados excluídos.");
      setExpenseToDelete(null);
      await fetchExpenses();
    } catch (err: unknown) {
      toast.error(
        `Erro ao excluir despesa: ${getErrorMessage(err, "Erro desconhecido.")}`
      );
    } finally {
      setDeletingExpense(false);
    }
  };

  // Calculations
  const totalExpenses = expenses.reduce(
    (acc, curr) => acc + Number(curr.amount || 0),
    0
  );
  const netBalance = totalIncome - totalExpenses;
  const isPositiveBalance = netBalance >= 0;

  const categoryTotals: Record<string, number> = {};
  expenses.forEach((exp) => {
    const cat = exp.category || "outros";
    categoryTotals[cat] = (categoryTotals[cat] || 0) + Number(exp.amount || 0);
  });

  const currentDialogCategoryOptions = useMemo(() => {
    const entries = Object.entries(SELECTABLE_CATEGORIES);
    const currentCat = editingExpense?.category;
    if (
      currentCat &&
      !Object.prototype.hasOwnProperty.call(SELECTABLE_CATEGORIES, currentCat)
    ) {
      entries.unshift([
        currentCat,
        CATEGORIES_DISPLAY_MAP[currentCat] ?? currentCat,
      ]);
    }
    return entries;
  }, [editingExpense]);

  return (
    <div className="flex flex-col gap-6 min-w-0">
      {/* KPI Cards Header */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className={cn(THEME_CLASSES.card, "py-0")}>
          <CardContent className="p-5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground block">
                Total Arrecadado (Bruto)
              </span>
              <span className="text-xl sm:text-2xl font-black text-foreground mt-1 block">
                R$ {formatCurrencyBRL(totalIncome)}
              </span>
              <span className="text-[11px] text-muted-foreground mt-0.5 block">
                Confirmado em conta
              </span>
            </div>
            <div className="size-11 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <TrendingUp className="size-5" />
            </div>
          </CardContent>
        </Card>

        <Card className={cn(THEME_CLASSES.card, "py-0")}>
          <CardContent className="p-5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground block">
                Total de Gastos / Despesas
              </span>
              <span className="text-xl sm:text-2xl font-black text-destructive mt-1 block">
                R$ {formatCurrencyBRL(totalExpenses)}
              </span>
              <span className="text-[11px] text-muted-foreground mt-0.5 block">
                {expenses.length} lançamento(s)
              </span>
            </div>
            <div className="size-11 rounded-full bg-destructive/15 text-destructive flex items-center justify-center shrink-0">
              <TrendingDown className="size-5" />
            </div>
          </CardContent>
        </Card>

        <Card className={cn(THEME_CLASSES.card, "py-0")}>
          <CardContent className="p-5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground block">
                Resultado Líquido do Evento
              </span>
              <span
                className={cn(
                  "text-xl sm:text-2xl font-black mt-1 block",
                  isPositiveBalance
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-amber-700 dark:text-amber-400"
                )}
              >
                R$ {formatCurrencyBRL(netBalance)}
              </span>
              <span className="text-[11px] font-semibold text-muted-foreground mt-0.5 block">
                {isPositiveBalance ? "Superávit (Sobra)" : "Déficit (A pagar)"}
              </span>
            </div>
            <div
              className={cn(
                "size-11 rounded-full flex items-center justify-center shrink-0",
                isPositiveBalance
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                  : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
              )}
            >
              <DollarSign className="size-5" />
            </div>
          </CardContent>
        </Card>

        <Card className={cn(THEME_CLASSES.card, "py-0")}>
          <CardContent className="p-5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground block">
                Valor Pendente
              </span>
              <span className="text-xl sm:text-2xl font-black text-foreground mt-1 block">
                R$ {formatCurrencyBRL(pendingIncome)}
              </span>
              <span className="text-[11px] text-muted-foreground mt-0.5 block">
                Aguardando pagamento
              </span>
            </div>
            <div className="size-11 rounded-full bg-muted text-muted-foreground flex items-center justify-center shrink-0">
              <Receipt className="size-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Expenses Section */}
      <Card className={cn(THEME_CLASSES.card, "py-0 rounded-2xl")}>
        <CardHeader className="p-4 sm:p-6 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="text-base sm:text-lg font-bold text-foreground flex items-center gap-2">
              <Receipt className="size-5 text-primary shrink-0" />
              <span>Lançamento e Controle de Gastos</span>
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-0.5">
              Registre despesas do encontro e anexe notas fiscais ou comprovantes.
            </CardDescription>
          </div>
          <Button
            type="button"
            onClick={handleOpenCreateExpense}
            className="min-h-[44px] px-4 rounded-xl cursor-pointer self-start sm:self-auto shrink-0"
          >
            <Plus data-icon="inline-start" />
            <span>Lançar Nova Despesa</span>
          </Button>
        </CardHeader>

        <CardContent className="p-0">
          {loadingExpenses ? (
            <div className="p-4 sm:p-6 flex flex-col gap-3">
              {[1, 2, 3].map((item) => (
                <Skeleton key={item} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : expenses.length === 0 ? (
            <div className="p-8 sm:p-12 text-center flex flex-col items-center gap-3">
              <Receipt className="size-11 text-muted-foreground" />
              <h4 className="font-bold text-foreground text-sm">
                Nenhum gasto ou despesa lançada
              </h4>
              <p className="text-xs text-muted-foreground max-w-sm">
                Use o botão &ldquo;Lançar Nova Despesa&rdquo; acima para registrar
                despesas e anexar comprovantes da prestação de contas.
              </p>
            </div>
          ) : (
            <>
              {/* Visão Mobile-First (< md / 320px+) */}
              <div className="md:hidden flex flex-col gap-3 p-4">
                {expenses.map((exp) => {
                  const expAttachments = attachmentsByExpenseId[exp.id] ?? [];
                  const attachmentCount = expAttachments.length;

                  return (
                    <div
                      key={exp.id}
                      className="flex flex-col gap-3 rounded-xl border border-border bg-background/60 p-4 min-w-0"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          {exp.expense_date
                            ? new Date(
                                `${exp.expense_date}T00:00:00`
                              ).toLocaleDateString("pt-BR")
                            : "S/D"}
                        </span>
                        <Badge
                          variant="outline"
                          className="text-[10px] font-semibold uppercase"
                        >
                          {CATEGORIES_DISPLAY_MAP[exp.category || "outros"] ||
                            exp.category}
                        </Badge>
                      </div>

                      <div className="flex flex-col gap-1 min-w-0">
                        <span className="text-sm font-semibold text-foreground break-words">
                          {exp.description}
                        </span>
                        {exp.notes && (
                          <span className="text-xs text-muted-foreground break-words">
                            {exp.notes}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">
                          Valor lançado
                        </span>
                        <span className="text-sm font-bold text-destructive">
                          - R$ {formatCurrencyBRL(Number(exp.amount))}
                        </span>
                      </div>

                      <Separator />

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Button
                          type="button"
                          variant={attachmentCount > 0 ? "secondary" : "outline"}
                          onClick={() => setViewerExpenseId(exp.id)}
                          className="min-h-[44px] flex-1 cursor-pointer"
                        >
                          <Paperclip data-icon="inline-start" />
                          <span>Comprovantes ({attachmentCount})</span>
                        </Button>

                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => handleOpenEditExpense(exp)}
                            aria-label={`Editar ${exp.description}`}
                            className="min-h-[44px] min-w-[44px] cursor-pointer"
                          >
                            <Edit />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => setExpenseToDelete(exp)}
                            aria-label={`Excluir ${exp.description}`}
                            className="min-h-[44px] min-w-[44px] text-destructive hover:bg-destructive/10 hover:text-destructive cursor-pointer"
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Visão Desktop (md+) */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b border-border hover:bg-transparent">
                      <TableHead className="w-[110px] px-4">Data</TableHead>
                      <TableHead>Descrição do Gasto</TableHead>
                      <TableHead className="w-[180px]">Categoria</TableHead>
                      <TableHead className="w-[175px]">Comprovantes</TableHead>
                      <TableHead className="text-right w-[135px]">
                        Valor (R$)
                      </TableHead>
                      <TableHead className="text-right w-[112px] px-4">
                        Ações
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expenses.map((exp) => {
                      const expAttachments =
                        attachmentsByExpenseId[exp.id] ?? [];
                      const attachmentCount = expAttachments.length;

                      return (
                        <TableRow
                          key={exp.id}
                          className="border-b border-border/60"
                        >
                          <TableCell className="px-4 text-xs font-medium text-muted-foreground">
                            {exp.expense_date
                              ? new Date(
                                  `${exp.expense_date}T00:00:00`
                                ).toLocaleDateString("pt-BR")
                              : "S/D"}
                          </TableCell>
                          <TableCell className="font-semibold text-xs text-foreground whitespace-normal">
                            {exp.description}
                            {exp.notes && (
                              <span className="block text-[11px] font-normal text-muted-foreground mt-0.5">
                                {exp.notes}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className="text-[10px] font-bold uppercase"
                            >
                              {CATEGORIES_DISPLAY_MAP[
                                exp.category || "outros"
                              ] || exp.category}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              variant={
                                attachmentCount > 0 ? "secondary" : "outline"
                              }
                              onClick={() => setViewerExpenseId(exp.id)}
                              className="min-h-[44px] px-3 cursor-pointer"
                            >
                              <Paperclip data-icon="inline-start" />
                              <span>Comprovantes ({attachmentCount})</span>
                            </Button>
                          </TableCell>
                          <TableCell className="text-right font-bold text-xs text-destructive">
                            - R$ {formatCurrencyBRL(Number(exp.amount))}
                          </TableCell>
                          <TableCell className="text-right px-4">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => handleOpenEditExpense(exp)}
                                aria-label={`Editar ${exp.description}`}
                                title="Editar despesa"
                                className="min-h-[44px] min-w-[44px] cursor-pointer text-muted-foreground hover:text-foreground"
                              >
                                <Edit />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => setExpenseToDelete(exp)}
                                aria-label={`Excluir ${exp.description}`}
                                title="Excluir despesa"
                                className="min-h-[44px] min-w-[44px] cursor-pointer text-destructive hover:bg-destructive/10 hover:text-destructive"
                              >
                                <Trash2 />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Expense Category Breakdown */}
      {expenses.length > 0 && (
        <Card className={cn(THEME_CLASSES.card, "p-4 sm:p-6 rounded-2xl")}>
          <div className="flex flex-col gap-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <PieChart className="size-4 text-primary shrink-0" />
              <span>Distribuição de Despesas por Categoria</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {Object.entries(categoryTotals).map(([catKey, total]) => {
                const pct =
                  totalExpenses > 0 ? (total / totalExpenses) * 100 : 0;
                return (
                  <div
                    key={catKey}
                    className="bg-muted/30 border border-border p-3.5 rounded-xl flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-foreground truncate">
                        {CATEGORIES_DISPLAY_MAP[catKey] || catKey}
                      </span>
                      <span className="font-extrabold text-destructive shrink-0">
                        R$ {formatCurrencyBRL(total)}
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-destructive rounded-full transition-all duration-300 motion-reduce:transition-none"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground block text-right font-semibold">
                      {pct.toFixed(1)}% do total de gastos
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {/* Dialog: Lançar / Editar Despesa + Upload Múltiplo de Comprovantes */}
      <Dialog
        open={isExpenseDialogOpen}
        onOpenChange={(open) => {
          if (!submittingExpense) {
            setIsExpenseDialogOpen(open);
          }
        }}
      >
        <DialogContent
          size="md"
          className="rounded-2xl border border-border bg-card p-5 sm:p-6"
        >
          <DialogHeader className="pr-10">
            <DialogTitle className="text-base sm:text-lg font-bold text-foreground">
              {editingExpense
                ? "Editar Lançamento de Gasto"
                : "Lançar Nova Despesa"}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Informe os dados da despesa e anexe notas fiscais ou comprovantes.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={handleSubmit(handleSaveExpense)}
            className="flex flex-col gap-4 py-1"
          >
            <FieldGroup>
              <Controller
                name="description"
                control={control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="expense-description">
                      Descrição da Despesa / Fornecedor *
                    </FieldLabel>
                    <Input
                      {...field}
                      id="expense-description"
                      aria-invalid={fieldState.invalid}
                      placeholder="Ex: Aluguel do Sítio Ebenezer, Açougue da Serra"
                      className="min-h-[44px]"
                    />
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Controller
                  name="amount"
                  control={control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="expense-amount">
                        Valor (R$) *
                      </FieldLabel>
                      <Input
                        {...field}
                        id="expense-amount"
                        type="number"
                        step="0.01"
                        min="0.01"
                        aria-invalid={fieldState.invalid}
                        value={field.value ?? ""}
                        placeholder="0,00"
                        className="min-h-[44px]"
                      />
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />

                <Controller
                  name="expense_date"
                  control={control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="expense-date">
                        Data do Gasto
                      </FieldLabel>
                      <Input
                        {...field}
                        id="expense-date"
                        type="date"
                        aria-invalid={fieldState.invalid}
                        className="min-h-[44px]"
                      />
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />
              </div>

              <Controller
                name="category"
                control={control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="expense-category">
                      Categoria da Despesa
                    </FieldLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger
                        id="expense-category"
                        aria-invalid={fieldState.invalid}
                        className="w-full min-h-[44px]"
                      >
                        <SelectValue placeholder="Selecione uma categoria" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {currentDialogCategoryOptions.map(([key, label]) => (
                            <SelectItem key={key} value={key}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />

              <Controller
                name="notes"
                control={control}
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor="expense-notes">
                      Notas Adicionais (Opcional)
                    </FieldLabel>
                    <Input
                      {...field}
                      id="expense-notes"
                      placeholder="Ex: Nota fiscal nº 1234, pago via Pix"
                      className="min-h-[44px]"
                    />
                  </Field>
                )}
              />
            </FieldGroup>

            <Separator />

            {/* Seção de Upload Múltiplo e Anexos Vinculados */}
            <div className="flex flex-col gap-3 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Paperclip className="size-4 text-primary shrink-0" />
                  <span>Comprovantes e Notas Fiscais</span>
                </span>
                <span className="text-[11px] text-muted-foreground">
                  PDF, JPG, PNG ou WebP • Máx. 10 MB
                </span>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ALLOWED_EXPENSE_ATTACHMENT_ACCEPT}
                onChange={handleFileInputChange}
                className="sr-only"
                aria-label="Selecionar comprovantes da despesa"
              />

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingOver(true);
                }}
                onDragLeave={() => setIsDraggingOver(false)}
                onDrop={handleDropFiles}
                className={cn(
                  "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center transition-colors",
                  isDraggingOver
                    ? "border-primary bg-primary/5"
                    : "border-border bg-muted/20"
                )}
              >
                <Upload className="size-5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  Arraste arquivos para cá ou selecione do seu dispositivo.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={submittingExpense}
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-[44px] cursor-pointer"
                >
                  <Plus data-icon="inline-start" />
                  <span>Adicionar Comprovantes</span>
                </Button>
              </div>

              {uploadNoticeError && (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                >
                  {uploadNoticeError}
                </div>
              )}

              {/* Arquivos já anexados no banco (modo edição) */}
              {editingExpense && editingExpenseAttachments.length > 0 && (
                <div className="flex flex-col gap-2 min-w-0">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Anexos salvos ({editingExpenseAttachments.length})
                  </span>
                  {editingExpenseAttachments.map((att) => {
                    const isPdf = isPdfMimeType(att.mime_type);
                    const isConfirming = confirmDeleteAttId === att.id;
                    const isDeleting = deletingAttId === att.id;

                    return (
                      <div
                        key={att.id}
                        className="flex flex-col gap-2 rounded-xl border border-border bg-background/70 p-2.5 min-w-0"
                      >
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {isPdf ? (
                              <FileText className="size-4 text-muted-foreground shrink-0" />
                            ) : (
                              <ImageIcon className="size-4 text-muted-foreground shrink-0" />
                            )}
                            <div className="flex flex-col min-w-0 flex-1">
                              <span className="truncate text-xs font-medium text-foreground">
                                {att.file_name}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {formatAttachmentSize(att.file_size)}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => setViewerExpenseId(editingExpense.id)}
                              aria-label={`Visualizar ${att.file_name}`}
                              title="Visualizar comprovante"
                              className="min-h-[44px] min-w-[44px] cursor-pointer"
                            >
                              <Eye />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={isDeleting}
                              onClick={() =>
                                setConfirmDeleteAttId(isConfirming ? null : att.id)
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
                              Remover este comprovante?
                            </span>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={isDeleting}
                                onClick={() => setConfirmDeleteAttId(null)}
                                className="min-h-[44px] px-3 cursor-pointer"
                              >
                                Cancelar
                              </Button>
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                disabled={isDeleting}
                                onClick={() =>
                                  handleDeleteExistingAttachmentInForm(att)
                                }
                                className="min-h-[44px] px-3 cursor-pointer"
                              >
                                {isDeleting && (
                                  <Spinner data-icon="inline-start" />
                                )}
                                <span>Remover</span>
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Arquivos pendentes de envio */}
              {pendingFiles.length > 0 && (
                <div className="flex flex-col gap-2 min-w-0">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Aguardando envio ({pendingFiles.length})
                  </span>
                  {pendingFiles.map((item) => {
                    const isPdf = item.file.type === "application/pdf";
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          "flex flex-col gap-1 rounded-xl border p-2.5 min-w-0",
                          item.error
                            ? "border-destructive/40 bg-destructive/5"
                            : "border-border bg-muted/30"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {isPdf ? (
                              <FileText className="size-4 text-muted-foreground shrink-0" />
                            ) : (
                              <ImageIcon className="size-4 text-muted-foreground shrink-0" />
                            )}
                            <div className="flex flex-col min-w-0 flex-1">
                              <span className="truncate text-xs font-medium text-foreground">
                                {item.file.name}
                              </span>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-[11px] text-muted-foreground">
                                  {formatAttachmentSize(item.file.size)}
                                </span>
                                <Badge variant="secondary" className="text-[10px]">
                                  Pendente
                                </Badge>
                              </div>
                            </div>
                          </div>

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={submittingExpense}
                            onClick={() => handleRemovePendingFile(item.id)}
                            aria-label={`Remover ${item.file.name} da fila`}
                            className="min-h-[44px] min-w-[44px] shrink-0 cursor-pointer"
                          >
                            <X />
                          </Button>
                        </div>

                        {item.error && (
                          <span className="text-[11px] text-destructive">
                            Erro no envio: {item.error}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <DialogFooter className="pt-2 flex flex-col-reverse sm:flex-row gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={submittingExpense}
                onClick={() => setIsExpenseDialogOpen(false)}
                className="min-h-[44px] w-full sm:w-auto cursor-pointer"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={submittingExpense}
                className="min-h-[44px] w-full sm:w-auto cursor-pointer"
              >
                {submittingExpense && <Spinner data-icon="inline-start" />}
                <span>
                  {submittingExpense ? "Salvando..." : "Salvar Despesa"}
                </span>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: Visualizar / Baixar / Excluir Comprovantes */}
      <ExpenseAttachmentsDialog
        expense={viewerExpense}
        attachments={viewerAttachments}
        isOpen={Boolean(viewerExpenseId)}
        onClose={() => setViewerExpenseId(null)}
        onAttachmentsChanged={fetchExpenses}
        uploadedByProfileId={currentProfileId}
      />

      {/* Dialog: Confirmação de Exclusão de Despesa */}
      <Dialog
        open={Boolean(expenseToDelete)}
        onOpenChange={(open) => {
          if (!open && !deletingExpense) {
            setExpenseToDelete(null);
          }
        }}
      >
        <DialogContent
          size="sm"
          className="rounded-2xl border border-border bg-card p-5 sm:p-6"
        >
          <DialogHeader className="pr-10">
            <DialogTitle className="text-base font-bold text-foreground">
              Excluir lançamento de despesa
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Tem certeza que deseja excluir{" "}
              <strong className="text-foreground">
                {expenseToDelete?.description}
              </strong>
              ?
              {expenseToDelete &&
                (attachmentsByExpenseId[expenseToDelete.id]?.length ?? 0) > 0 &&
                ` Os ${
                  attachmentsByExpenseId[expenseToDelete.id].length
                } comprovante(s) vinculados também serão removidos permanentemente.`}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="pt-2 flex flex-col-reverse sm:flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={deletingExpense}
              onClick={() => setExpenseToDelete(null)}
              className="min-h-[44px] w-full sm:w-auto cursor-pointer"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingExpense}
              onClick={handleConfirmDeleteExpense}
              className="min-h-[44px] w-full sm:w-auto cursor-pointer"
            >
              {deletingExpense && <Spinner data-icon="inline-start" />}
              <span>{deletingExpense ? "Excluindo..." : "Excluir Despesa"}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
