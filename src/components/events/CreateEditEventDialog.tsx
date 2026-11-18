import { useEffect, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2, AlertTriangle, Info, Mail } from "lucide-react";
import { toast } from "sonner";
import supabase from "@/lib/supabase";
import { ensureMandatoryEventFields, type FormField } from "@/lib/forms";
import { GRAPH_UI_CLASSES, THEME_CLASSES } from "@/constants/colors";
import { isRetreatAutoClosed, isRetreatExpiredByDate } from "@/lib/retreatStatus";
import {
  buildBatchCountsMapFromRpcRows,
  toDateTimeLocalInput,
  validateBatchWindows,
  type BatchDraft,
  type BatchFieldErrors,
  type RetreatBatch,
} from "@/lib/retreatBatches";
import { syncRetreatBatches } from "@/lib/retreatBatchesSync";
import { RetreatBatchesSection } from "@/components/events/RetreatBatchesSection";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Field, FieldLabel, FieldDescription, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Resolver } from "react-hook-form";
import type { Database, Json } from "@/lib/database.types";
import { CheckinChecklistConfigEditor } from "@/components/events/CheckinChecklistConfigEditor";
import {
  DEFAULT_CHECKIN_CHECKLIST,
  parseChecklistConfig,
} from "@/lib/checkinFlags";

type Retreat = Database["public"]["Tables"]["retreats"]["Row"];

export const DEFAULT_CONFIRMATION_EMAIL_SUBJECT = "Confirmação de Inscrição: {evento}";

export const DEFAULT_CONFIRMATION_EMAIL_BODY = `Graça e paz, {nome}!

Sua inscrição para o {evento} está confirmada. Cremos que será um tempo precioso de edificação mútua e fortalecimento no Senhor.

Detalhes do Encontro:
📅 Data: {data}
📍 Local: {local}

Orientações:
- Leve sua Bíblia, caderno de anotações e itens de uso pessoal.
- Chegue com antecedência para o credenciamento e acolhimento.`;

const retreatFormSchema = z.object({
  title: z.string().min(3, { message: "O título deve ter pelo menos 3 caracteres." }),
  description: z.string().default(""),
  has_payment: z.boolean().default(false),
  price: z.coerce.number().min(0, { message: "O preço deve ser igual ou maior que zero." }),
  location_text: z.string().default(""),
  start_date: z
    .string()
    .min(1, { message: "A data de início é obrigatória." })
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Formato de data inválido (AAAA-MM-DD)." }),
  end_date: z
    .string()
    .min(1, { message: "A data de término é obrigatória." })
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Formato de data inválido (AAAA-MM-DD)." }),
  max_participants: z.coerce
    .number()
    .min(1, { message: "Deve ter capacidade para pelo menos 1 participante." }),
  status: z.enum(["ativo", "rascunho", "encerrado"] as const),
  form_id: z.string().optional().nullable(),
  registration_deadline: z.string().optional().nullable(),
  checkin_checklist_config: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
      })
    )
    .default(DEFAULT_CHECKIN_CHECKLIST),
  whatsapp_group_url: z.string().optional().nullable(),
  send_confirmation_email: z.boolean().default(true),
  custom_confirmation_subject: z.string().optional().nullable(),
  custom_confirmation_body: z.string().optional().nullable(),
});

type RetreatFormValues = z.infer<typeof retreatFormSchema>;

export interface FormOption {
  id: string;
  name: string;
  connectedRetreatId?: string | null;
  connectedRetreatTitle?: string | null;
}

interface CreateEditEventDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  retreat?: Retreat | null;
  forms: FormOption[];
  onSuccess: () => void;
}

export function CreateEditEventDialog({
  isOpen,
  onOpenChange,
  retreat,
  forms,
  onSuccess,
}: CreateEditEventDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [batchDrafts, setBatchDrafts] = useState<BatchDraft[]>([]);
  const [originalBatches, setOriginalBatches] = useState<RetreatBatch[]>([]);
  const [batchCounts, setBatchCounts] = useState<Record<string, number>>({});
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [batchFieldErrors, setBatchFieldErrors] = useState<Record<number, BatchFieldErrors>>({});
  const [batchValidationErrors, setBatchValidationErrors] = useState<string[]>([]);

  const { control, handleSubmit, reset, setValue, watch, setError, clearErrors } = useForm<RetreatFormValues>({
    resolver: zodResolver(retreatFormSchema) as Resolver<RetreatFormValues>,
    defaultValues: {
      title: "",
      description: "",
      has_payment: false,
      price: 0,
      location_text: "",
      start_date: "",
      end_date: "",
      max_participants: 100,
      status: "ativo",
      form_id: "",
      registration_deadline: "",
      checkin_checklist_config: [...DEFAULT_CHECKIN_CHECKLIST],
      whatsapp_group_url: "",
      send_confirmation_email: true,
      custom_confirmation_subject: DEFAULT_CONFIRMATION_EMAIL_SUBJECT,
      custom_confirmation_body: DEFAULT_CONFIRMATION_EMAIL_BODY,
    },
  });

  const hasPayment = watch("has_payment");
  const defaultPriceValue = watch("price");
  const watchedEndDate = watch("end_date");
  const watchedStatus = watch("status");
  const isEndDateInPast = isRetreatExpiredByDate(watchedEndDate);
  const isAttemptingActivePastRetreat = isEndDateInPast && watchedStatus === "ativo";
  const isViewingAutoClosed = Boolean(
    retreat && isRetreatAutoClosed(retreat.status, watchedEndDate || retreat.end_date)
  );
  const sendEmailEnabled = watch("send_confirmation_email");

  useEffect(() => {
    if (!isAttemptingActivePastRetreat) {
      clearErrors("status");
    }
  }, [isAttemptingActivePastRetreat, clearErrors]);

  useEffect(() => {
    let active = true;

    async function loadBatches(retreatId: string) {
      setLoadingBatches(true);
      try {
        const [{ data: batchesData, error: batchesErr }, { data: countsData }] =
          await Promise.all([
            supabase
              .from("retreat_batches")
              .select("*")
              .eq("retreat_id", retreatId)
              .order("sort_order", { ascending: true })
              .order("start_at", { ascending: true }),
            supabase.rpc("get_retreat_batch_counts", {
              p_retreat_ids: [retreatId],
            }),
          ]);

        if (!active) return;
        if (batchesErr) throw batchesErr;

        const rows = batchesData || [];
        setOriginalBatches(rows);
        setBatchDrafts(
          rows.map((b, idx) => ({
            id: b.id,
            name: b.name,
            price: Number(b.price),
            start_at: toDateTimeLocalInput(b.start_at),
            end_at: toDateTimeLocalInput(b.end_at),
            max_spots: b.max_spots,
            sort_order: b.sort_order ?? idx,
          }))
        );
        setBatchCounts(buildBatchCountsMapFromRpcRows(countsData || []));
      } catch (err: unknown) {
        console.error("Erro ao carregar lotes do evento:", err);
      } finally {
        if (active) setLoadingBatches(false);
      }
    }

    setBatchFieldErrors({});
    setBatchValidationErrors([]);

    if (retreat) {
      setValue("title", retreat.title);
      setValue("description", retreat.description || "");
      const isPaid = retreat.has_payment ?? ((retreat.price || 0) > 0);
      setValue("has_payment", isPaid);
      setValue("price", retreat.price || 0);
      setValue("location_text", retreat.location_text || "");
      setValue("start_date", retreat.start_date || "");
      setValue("end_date", retreat.end_date || "");
      setValue("max_participants", retreat.max_participants || 100);
      setValue(
        "status",
        retreat.status === "rascunho" || retreat.status === "encerrado"
          ? retreat.status
          : "ativo"
      );
      setValue("form_id", retreat.form_id || "");
      setValue("registration_deadline", retreat.registration_deadline || "");
      setValue(
        "checkin_checklist_config",
        parseChecklistConfig(retreat.checkin_checklist_config)
      );
      if (isOpen) {
        loadBatches(retreat.id);
      }

      const spreadsheet = (retreat.spreadsheet_data as Record<string, any>) || {};
      setValue("whatsapp_group_url", spreadsheet.whatsapp_group_url || "");
      setValue("send_confirmation_email", spreadsheet.send_confirmation_email ?? true);
      setValue(
        "custom_confirmation_subject",
        spreadsheet.custom_confirmation_subject || DEFAULT_CONFIRMATION_EMAIL_SUBJECT
      );
      setValue(
        "custom_confirmation_body",
        spreadsheet.custom_confirmation_body || DEFAULT_CONFIRMATION_EMAIL_BODY
      );
    } else {
      reset({
        title: "",
        description: "",
        has_payment: false,
        price: 0,
        location_text: "",
        start_date: "",
        end_date: "",
        max_participants: 100,
        status: "ativo",
        form_id: "",
        registration_deadline: "",
        checkin_checklist_config: [...DEFAULT_CHECKIN_CHECKLIST],
        whatsapp_group_url: "",
        send_confirmation_email: true,
        custom_confirmation_subject: DEFAULT_CONFIRMATION_EMAIL_SUBJECT,
        custom_confirmation_body: DEFAULT_CONFIRMATION_EMAIL_BODY,
      });
      setOriginalBatches([]);
      setBatchDrafts([]);
      setBatchCounts({});
    }

    return () => {
      active = false;
    };
  }, [retreat, isOpen, setValue, reset]);

  const handleBatchesChange = (nextBatches: BatchDraft[]) => {
    setBatchDrafts(nextBatches);
    if (batchValidationErrors.length > 0 || Object.keys(batchFieldErrors).length > 0) {
      const normalized = nextBatches.map((b) => ({
        ...b,
        price: hasPayment ? b.price : 0,
      }));
      const result = validateBatchWindows(normalized);
      setBatchFieldErrors(result.fieldErrors);
      setBatchValidationErrors(result.errors);
    }
  };

  const onSubmitEvent = async (data: RetreatFormValues) => {
    if (data.status === "ativo" && isRetreatExpiredByDate(data.end_date)) {
      setError("status", {
        type: "manual",
        message:
          "Retiros com data de término no passado encerram automaticamente. Ajuste a data de término ou mantenha como Encerrado.",
      });
      toast.warning(
        "Atualize a data de término para uma data futura antes de manter o retiro ativo."
      );
      return;
    }

    setSubmitting(true);
    if (batchDrafts.length > 0) {
      const normalized = batchDrafts.map((b) => ({
        ...b,
        price: data.has_payment ? b.price : 0,
      }));
      const validation = validateBatchWindows(normalized);
      if (!validation.valid) {
        setBatchFieldErrors(validation.fieldErrors);
        setBatchValidationErrors(validation.errors);
        toast.error("Revise as janelas e os valores dos lotes antes de salvar.");
        setSubmitting(false);
        return;
      }
    }
    setBatchFieldErrors({});
    setBatchValidationErrors([]);

    const existingSpreadsheet = (retreat?.spreadsheet_data as Record<string, any>) || {};
    const payload = {
      title: data.title,
      description: data.description || null,
      has_payment: data.has_payment,
      price: data.has_payment ? data.price : 0,
      location_text: data.location_text || null,
      start_date: data.start_date,
      end_date: data.end_date,
      max_participants: data.max_participants,
      status: data.status,
      form_id: data.form_id === "" ? null : data.form_id,
      registration_deadline:
        data.registration_deadline === "" ? null : data.registration_deadline,
      checkin_checklist_config: data.checkin_checklist_config as unknown as Json,
      spreadsheet_data: {
        ...existingSpreadsheet,
        whatsapp_group_url: data.whatsapp_group_url?.trim() || null,
        send_confirmation_email: data.send_confirmation_email ?? true,
        custom_confirmation_subject: data.custom_confirmation_subject?.trim() || null,
        custom_confirmation_body: data.custom_confirmation_body?.trim() || null,
      },
    };

    // Validação preventiva: exclusividade 1-para-1 de formulário por evento
    if (payload.form_id) {
      const alreadyLinked = forms.find(
        (f) =>
          f.id === payload.form_id &&
          f.connectedRetreatId &&
          f.connectedRetreatId !== retreat?.id
      );
      if (alreadyLinked) {
        toast.error(
          `Este formulário já está vinculado ao evento "${alreadyLinked.connectedRetreatTitle}". Cada evento deve possuir sua própria ficha de inscrição exclusiva.`
        );
        setSubmitting(false);
        return;
      }
    }

    // Garantir campos obrigatórios no formulário selecionado
    if (payload.form_id) {
      try {
        const { data: dbForm } = await supabase
          .from("forms")
          .select("id, fields")
          .eq("id", payload.form_id)
          .single();

        if (dbForm && dbForm.fields) {
          const updatedFields = ensureMandatoryEventFields(
            dbForm.fields as unknown as FormField[]
          );
          await supabase
            .from("forms")
            .update({ fields: updatedFields as unknown as Json })
            .eq("id", payload.form_id);
        }
      } catch (fErr: unknown) {
        const msg = fErr instanceof Error ? fErr.message : "Erro desconhecido";
        console.error("Erro ao verificar campos obrigatórios no formulário:", msg);
      }
    }

    try {
      let savedRetreatId: string;
      if (retreat) {
        const { error } = await supabase
          .from("retreats")
          .update(payload)
          .eq("id", retreat.id);

        if (error) throw error;
        savedRetreatId = retreat.id;
      } else {
        const { data: insertedRetreat, error } = await supabase
          .from("retreats")
          .insert([payload])
          .select("id")
          .single();

        if (error) throw error;
        savedRetreatId = insertedRetreat.id;
      }

      if (batchDrafts.length > 0 || originalBatches.length > 0) {
        await syncRetreatBatches(
          savedRetreatId,
          batchDrafts,
          originalBatches,
          data.has_payment
        );
      }

      toast.success(retreat ? "Evento atualizado com sucesso!" : "Evento criado com sucesso!");

      onOpenChange(false);
      reset();
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao salvar evento";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="sm:max-w-3xl lg:max-w-4xl rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-6 md:p-8 max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
            {retreat ? "Editar Encontro/Retiro" : "Criar Novo Encontro/Retiro"}
          </DialogTitle>
          <DialogDescription className="text-zinc-500 dark:text-zinc-400">
            Preencha os detalhes logísticos do evento comunitário.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmitEvent)} className="space-y-4 py-2">
          <Field>
            <FieldLabel htmlFor="title">Título do Retiro *</FieldLabel>
            <Controller
              name="title"
              control={control}
              render={({ field, fieldState }) => (
                <>
                  <Input
                    {...field}
                    id="title"
                    placeholder="Ex: Retiro de Jovens 2026"
                    className="rounded-md min-h-[44px]"
                  />
                  {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
                </>
              )}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="description">Descrição</FieldLabel>
            <Controller
              name="description"
              control={control}
              render={({ field }) => (
                <Textarea
                  {...field}
                  value={field.value || ""}
                  id="description"
                  placeholder="Informações detalhadas do encontro..."
                  className="rounded-md min-h-[80px]"
                />
              )}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="has_payment">Cobrança de Inscrição *</FieldLabel>
              <Controller
                name="has_payment"
                control={control}
                render={({ field }) => (
                  <Select
                    onValueChange={(val) => {
                      const isPaid = val === "pago";
                      field.onChange(isPaid);
                      if (!isPaid) setValue("price", 0);
                    }}
                    value={field.value ? "pago" : "gratuito"}
                  >
                    <SelectTrigger id="has_payment" className="w-full min-h-[44px]">
                      <SelectValue placeholder="Selecione o tipo de evento" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gratuito">
                        Gratuito (Sem Cobrança)
                      </SelectItem>
                      <SelectItem value="pago">
                        Pago (Com Cobrança)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            {hasPayment ? (
              <Field>
                <FieldLabel htmlFor="price">Preço por Pessoa (R$) *</FieldLabel>
                <Controller
                  name="price"
                  control={control}
                  render={({ field, fieldState }) => (
                    <>
                      <Input
                        {...field}
                        id="price"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="Ex: 150.00"
                        className="rounded-md min-h-[44px]"
                      />
                      {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
                    </>
                  )}
                />
              </Field>
            ) : (
              <div className="flex flex-col justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-400">
                <span className="font-bold">Inscrição Gratuita</span>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Os inscritos não verão nenhuma etapa ou modal de pagamento.
                </span>
              </div>
            )}
          </div>

          <Field>
            <FieldLabel htmlFor="max_participants">Capacidade Máxima *</FieldLabel>
            <Controller
              name="max_participants"
              control={control}
              render={({ field, fieldState }) => (
                <>
                  <Input
                    {...field}
                    id="max_participants"
                    type="number"
                    min="1"
                    placeholder="Ex: 120"
                    className="rounded-md min-h-[44px]"
                  />
                  {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
                </>
              )}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="location_text">Local do Evento</FieldLabel>
            <Controller
              name="location_text"
              control={control}
              render={({ field }) => (
                <Input
                  {...field}
                  value={field.value || ""}
                  id="location_text"
                  placeholder="Ex: Sítio Ebenézer, Esmeraldas - MG"
                  className="rounded-md min-h-[44px]"
                />
              )}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="start_date">Data de Início *</FieldLabel>
              <Controller
                name="start_date"
                control={control}
                render={({ field, fieldState }) => (
                  <>
                    <Input
                      {...field}
                      id="start_date"
                      type="date"
                      className="rounded-md min-h-[44px]"
                    />
                    {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
                  </>
                )}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="end_date">Data de Término *</FieldLabel>
              <Controller
                name="end_date"
                control={control}
                render={({ field, fieldState }) => (
                  <>
                    <Input
                      {...field}
                      id="end_date"
                      type="date"
                      className="rounded-md min-h-[44px]"
                    />
                    {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
                  </>
                )}
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="registration_deadline">Prazo Limite para Inscrições</FieldLabel>
            <Controller
              name="registration_deadline"
              control={control}
              render={({ field, fieldState }) => (
                <>
                  <Input
                    {...field}
                    value={field.value || ""}
                    id="registration_deadline"
                    type="date"
                    className="rounded-md min-h-[44px]"
                  />
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                    {batchDrafts.length > 0
                      ? "Com lotes configurados abaixo, a abertura e o encerramento das inscrições seguem automaticamente as janelas dos lotes."
                      : "Opcional. Data final (até as 23:59) para recebimento de inscrições. Se deixado em branco, o prazo limite será a Data de Término do evento."}
                  </p>
                  {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
                </>
              )}
            />
          </Field>

          <RetreatBatchesSection
            batches={batchDrafts}
            onChange={handleBatchesChange}
            hasPayment={hasPayment}
            defaultPrice={Number(defaultPriceValue || 0)}
            batchCounts={batchCounts}
            fieldErrors={batchFieldErrors}
            validationErrors={batchValidationErrors}
            disabled={submitting || loadingBatches}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="status">Status *</FieldLabel>
              <Controller
                name="status"
                control={control}
                render={({ field, fieldState }) => (
                  <>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger
                        id="status"
                        aria-invalid={Boolean(fieldState.error)}
                        className="w-full min-h-[44px]"
                      >
                        <SelectValue placeholder="Selecione o status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ativo">Ativo (Inscrições Abertas)</SelectItem>
                        <SelectItem value="rascunho">Rascunho (Privado)</SelectItem>
                        <SelectItem value="encerrado">Encerrado</SelectItem>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      Retiros ativos passam automaticamente para Encerrado após a data de término.
                    </FieldDescription>
                    {isAttemptingActivePastRetreat && (
                      <div
                        role="alert"
                        className={`flex items-start gap-2 rounded-lg border p-3 text-xs leading-relaxed ${GRAPH_UI_CLASSES.inspectorWarningBox}`}
                      >
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>
                          A data de término já passou. Retiros com data de término no passado
                          encerram automaticamente — atualize a data de término para o futuro ou
                          selecione &quot;Encerrado&quot;.
                        </span>
                      </div>
                    )}
                    {!isAttemptingActivePastRetreat && isViewingAutoClosed && (
                      <div
                        role="status"
                        className={`flex items-start gap-2 rounded-lg border p-3 text-xs leading-relaxed ${THEME_CLASSES.surface} text-zinc-600 dark:text-zinc-400`}
                      >
                        <Info className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>
                          Este retiro foi encerrado automaticamente após o fim da data de término.
                          Para reativá-lo, informe uma nova data de término futura.
                        </span>
                      </div>
                    )}
                    {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
                  </>
                )}
              />
            </Field>

            <Field>
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="form_id">Ficha de Inscrição Customizada</FieldLabel>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Cada evento deve possuir uma ficha exclusiva. Para reaproveitar campos de um modelo existente, duplique-o na{" "}
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">Gestão de Formulários</span>.
                </p>
              </div>
              <Controller
                name="form_id"
                control={control}
                render={({ field }) => (
                  <Select
                    onValueChange={(val) => field.onChange(val === "none" ? null : val)}
                    value={field.value || "none"}
                  >
                    <SelectTrigger id="form_id" className="w-full min-h-[44px]">
                      <SelectValue placeholder="Nenhum (Formulário Padrão)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhum (Formulário Padrão)</SelectItem>
                      {forms.map((f) => {
                        const isLinkedToAnother = !!(
                          f.connectedRetreatId &&
                          f.connectedRetreatId !== retreat?.id
                        );
                        return (
                          <SelectItem
                            key={f.id}
                            value={f.id}
                            disabled={isLinkedToAnother}
                            className={isLinkedToAnother ? "opacity-50 cursor-not-allowed" : ""}
                          >
                            {f.name}
                            {isLinkedToAnother && f.connectedRetreatTitle
                              ? ` (Já vinculado a: ${f.connectedRetreatTitle})`
                              : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </div>

          <Controller
            name="checkin_checklist_config"
            control={control}
            render={({ field }) => (
              <CheckinChecklistConfigEditor
                value={field.value}
                onChange={field.onChange}
                disabled={submitting}
                inputId="create-edit-checklist-input"
              />
            )}
          />

          {/* Seção de Comunicação e E-mail de Confirmação */}
          <div className="rounded-xl border border-border/80 bg-muted/20 p-4 space-y-4">
            <div className="flex items-center gap-2 border-b border-border/40 pb-2">
              <Mail className="h-5 w-5 text-primary" />
              <div>
                <h4 className="text-sm font-bold text-foreground">
                  Comunicação & E-mail de Confirmação
                </h4>
                <p className="text-[11px] text-muted-foreground">
                  Configure o grupo oficial de WhatsApp e o e-mail de confirmação enviado aos participantes.
                </p>
              </div>
            </div>

            <Field>
              <FieldLabel htmlFor="whatsapp_group_url">Link do Grupo Oficial de WhatsApp</FieldLabel>
              <Controller
                name="whatsapp_group_url"
                control={control}
                render={({ field }) => (
                  <>
                    <Input
                      {...field}
                      value={field.value || ""}
                      id="whatsapp_group_url"
                      placeholder="https://chat.whatsapp.com/..."
                      className="rounded-md min-h-[44px]"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Se informado, um botão oficial para entrar no grupo de WhatsApp será exibido no e-mail de confirmação.
                    </p>
                  </>
                )}
              />
            </Field>

            <Field>
              <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border/60 bg-background">
                <div className="space-y-0.5">
                  <span className="text-xs font-semibold text-foreground">
                    Enviar e-mail de confirmação de inscrição aos participantes
                  </span>
                  <p className="text-[11px] text-muted-foreground">
                    Dispara automaticamente o e-mail assim que a ficha for enviada (caso haja campo de e-mail).
                  </p>
                </div>
                <Controller
                  name="send_confirmation_email"
                  control={control}
                  render={({ field }) => (
                    <input
                      type="checkbox"
                      id="send_confirmation_email"
                      checked={field.value}
                      onChange={(e) => field.onChange(e.target.checked)}
                      className="h-5 w-5 rounded border-zinc-300 text-primary focus:ring-primary cursor-pointer"
                    />
                  )}
                />
              </div>
            </Field>

            {sendEmailEnabled && (
              <div className="space-y-3 pt-1 border-t border-border/40">
                <Field>
                  <FieldLabel htmlFor="custom_confirmation_subject">
                    Assunto do E-mail de Confirmação
                  </FieldLabel>
                  <Controller
                    name="custom_confirmation_subject"
                    control={control}
                    render={({ field }) => (
                      <Input
                        {...field}
                        value={field.value ?? ""}
                        id="custom_confirmation_subject"
                        className="rounded-md min-h-[44px]"
                      />
                    )}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Tag disponível: <code className="bg-muted px-1 rounded">{"{evento}"}</code> (substituída pelo nome deste evento).
                  </p>
                </Field>

                <Field>
                  <div className="flex items-center justify-between mb-1">
                    <FieldLabel htmlFor="custom_confirmation_body">
                      Mensagem / Orientações do E-mail
                    </FieldLabel>
                    <button
                      type="button"
                      onClick={() => {
                        setValue("custom_confirmation_subject", DEFAULT_CONFIRMATION_EMAIL_SUBJECT);
                        setValue("custom_confirmation_body", DEFAULT_CONFIRMATION_EMAIL_BODY);
                        toast.info("Modelo padrão restaurado!");
                      }}
                      className="text-[11px] text-muted-foreground hover:text-foreground underline cursor-pointer"
                    >
                      Restaurar texto padrão
                    </button>
                  </div>
                  <Controller
                    name="custom_confirmation_body"
                    control={control}
                    render={({ field }) => (
                      <>
                        <Textarea
                          {...field}
                          value={field.value ?? ""}
                          id="custom_confirmation_body"
                          rows={6}
                          className="rounded-md text-xs leading-relaxed bg-background"
                        />
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Tags dinâmicas: <code className="bg-muted px-1 rounded">{"{nome}"}</code>, <code className="bg-muted px-1 rounded">{"{evento}"}</code>, <code className="bg-muted px-1 rounded">{"{data}"}</code>, <code className="bg-muted px-1 rounded">{"{local}"}</code>. O texto acima já vem preenchido como modelo e pode ser editado livremente.
                        </p>
                      </>
                    )}
                  />
                </Field>
              </div>
            )}
          </div>

          <DialogFooter className="pt-4 flex flex-col sm:flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="min-h-[44px] cursor-pointer"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              className="min-h-[44px] cursor-pointer bg-zinc-900 hover:bg-zinc-800 text-zinc-50 dark:bg-zinc-50 dark:hover:bg-zinc-200 dark:text-zinc-900 font-bold"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Salvando...
                </>
              ) : retreat ? (
                "Salvar Alterações"
              ) : (
                "Criar Retiro"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
