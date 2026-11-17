import { useEffect, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { AlertTriangle, Ban } from "lucide-react"
import { toast } from "sonner"
import supabase from "@/lib/supabase"
import { cancelAndRefundSchema, type CancelAndRefundValue } from "@/lib/schemas"
import { Button } from "@/components/ui/button"
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
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

interface ParticipantPortalCancelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  retreatTitle: string
  portalToken?: string
  registrationId?: string
  refundEligible: boolean
  alreadyCancelled: boolean
  existingReason?: string | null
  onSuccess: () => void
}

export function ParticipantPortalCancelDialog({
  open,
  onOpenChange,
  retreatTitle,
  portalToken,
  registrationId,
  refundEligible,
  alreadyCancelled,
  existingReason,
  onSuccess,
}: ParticipantPortalCancelDialogProps) {
  const [submitting, setSubmitting] = useState(false)

  const {
    register,
    control,
    watch,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CancelAndRefundValue>({
    resolver: zodResolver(cancelAndRefundSchema),
    defaultValues: {
      reason: existingReason || "",
      requestRefund: alreadyCancelled ? true : refundEligible,
      pixKey: "",
    },
  })

  useEffect(() => {
    if (open) {
      reset({
        reason: existingReason || "",
        requestRefund: alreadyCancelled ? true : refundEligible,
        pixKey: "",
      })
    }
  }, [open, existingReason, alreadyCancelled, refundEligible, reset])

  const requestRefund = watch("requestRefund")

  const onSubmit = async (values: CancelAndRefundValue) => {
    setSubmitting(true)
    try {
      const wantRefund = alreadyCancelled ? true : refundEligible && values.requestRefund
      const { error } = await supabase.rpc("cancel_and_request_refund", {
        p_portal_token: portalToken ?? null,
        p_registration_id: portalToken ? null : (registrationId ?? null),
        p_reason: values.reason?.trim() || null,
        p_request_refund: wantRefund,
        p_pix_key: wantRefund ? values.pixKey?.trim() || null : null,
      })

      if (error) throw error

      toast.success(
        alreadyCancelled
          ? "Solicitação de reembolso registrada com sucesso."
          : wantRefund
            ? "Inscrição cancelada, vaga liberada e reembolso solicitado."
            : "Inscrição cancelada e vaga liberada para outro irmão."
      )
      onOpenChange(false)
      onSuccess()
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Não foi possível concluir a solicitação."
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" className="p-5 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <AlertTriangle className="size-5 text-destructive shrink-0" />
            <span>
              {alreadyCancelled
                ? "Solicitar Reembolso"
                : "Cancelar Inscrição"}
            </span>
          </DialogTitle>
          <DialogDescription>
            {alreadyCancelled ? (
              <>
                Informe sua chave PIX para solicitar o reembolso referente ao evento{" "}
                <strong className="text-foreground">{retreatTitle}</strong>. A equipe
                organizadora acompanhará a análise por aqui.
              </>
            ) : (
              <>
                Ao confirmar o cancelamento em{" "}
                <strong className="text-foreground">{retreatTitle}</strong>, sua vaga
                será imediatamente liberada para que outro irmão possa participar. O
                histórico da sua ficha permanece registrado.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <FieldGroup>
            {!alreadyCancelled && (
              <Field data-invalid={!!errors.reason}>
                <FieldLabel htmlFor="cancelReason">
                  Motivo do cancelamento (opcional)
                </FieldLabel>
                <Textarea
                  id="cancelReason"
                  placeholder="Ex: Imprevisto familiar, alteração na escala de trabalho..."
                  className="min-h-[84px]"
                  disabled={submitting}
                  aria-invalid={!!errors.reason}
                  {...register("reason")}
                />
                <FieldError errors={[errors.reason]} />
              </Field>
            )}

            {refundEligible && !alreadyCancelled && (
              <Field
                orientation="horizontal"
                className="justify-between rounded-lg border border-border bg-muted/20 p-3.5"
              >
                <div className="flex flex-col gap-0.5 pr-3">
                  <FieldLabel htmlFor="requestRefundSwitch" className="cursor-pointer">
                    Solicitar reembolso do valor pago
                  </FieldLabel>
                  <FieldDescription>
                    Informe uma chave PIX para que os organizadores realizem o estorno.
                  </FieldDescription>
                </div>
                <Controller
                  control={control}
                  name="requestRefund"
                  render={({ field }) => (
                    <Switch
                      id="requestRefundSwitch"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={submitting}
                    />
                  )}
                />
              </Field>
            )}

            {(alreadyCancelled || (refundEligible && requestRefund)) && (
              <Field data-invalid={!!errors.pixKey}>
                <FieldLabel htmlFor="pixKey">Chave PIX para Reembolso *</FieldLabel>
                <Input
                  id="pixKey"
                  placeholder="CPF, e-mail, celular ou chave aleatória"
                  className="min-h-[44px]"
                  disabled={submitting}
                  aria-invalid={!!errors.pixKey}
                  {...register("pixKey")}
                />
                <FieldDescription>
                  Verifique a chave com atenção antes de enviar.
                </FieldDescription>
                <FieldError errors={[errors.pixKey]} />
              </Field>
            )}

            {!refundEligible && !alreadyCancelled && (
              <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                Esta inscrição não possui pagamento financeiro elegível para reembolso
                (inscrição gratuita, isenta por cupom integral ou com pagamento pendente).
              </p>
            )}
          </FieldGroup>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="min-h-[44px]"
            >
              Voltar
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={submitting}
              className="min-h-[44px] font-semibold"
            >
              {submitting ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Ban data-icon="inline-start" />
              )}
              {submitting
                ? "Processando..."
                : alreadyCancelled
                  ? "Enviar Solicitação de Reembolso"
                  : "Confirmar Cancelamento"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
