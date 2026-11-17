import { useEffect, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Plane, Save, CheckCircle2 } from "lucide-react"
import { toast } from "sonner"
import supabase from "@/lib/supabase"
import { flightDetailsSchema, type FlightDetailsValue } from "@/lib/schemas"
import { formatFlightDateTime } from "@/lib/participantPortal"
import { THEME_CLASSES } from "@/constants/colors"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

interface ParticipantPortalFlightFormProps {
  portalToken?: string
  registrationId?: string
  initialFlightDetails: FlightDetailsValue | null
  isCancelled: boolean
  onSaved: (saved: FlightDetailsValue) => void
}

const EMPTY_FLIGHT_VALUES: FlightDetailsValue = {
  arrivalAirline: "",
  arrivalFlightNumber: "",
  arrivalAirport: "",
  arrivalDateTime: "",
  departureAirline: "",
  departureFlightNumber: "",
  departureDateTime: "",
  needsAirportTransfer: false,
  notes: "",
}

export function ParticipantPortalFlightForm({
  portalToken,
  registrationId,
  initialFlightDetails,
  isCancelled,
  onSaved,
}: ParticipantPortalFlightFormProps) {
  const [saving, setSaving] = useState(false)

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FlightDetailsValue>({
    resolver: zodResolver(flightDetailsSchema),
    defaultValues: initialFlightDetails ?? EMPTY_FLIGHT_VALUES,
  })

  useEffect(() => {
    reset(initialFlightDetails ?? EMPTY_FLIGHT_VALUES)
  }, [initialFlightDetails, reset])

  const onSubmit = async (values: FlightDetailsValue) => {
    setSaving(true)
    try {
      const payload = {
        arrivalAirline: values.arrivalAirline.trim(),
        arrivalFlightNumber: values.arrivalFlightNumber.trim().toUpperCase(),
        arrivalAirport: values.arrivalAirport.trim().toUpperCase(),
        arrivalDateTime: values.arrivalDateTime,
        departureAirline: values.departureAirline?.trim() || "",
        departureFlightNumber: values.departureFlightNumber?.trim().toUpperCase() || "",
        departureDateTime: values.departureDateTime || "",
        needsAirportTransfer: values.needsAirportTransfer,
        notes: values.notes?.trim() || "",
      }

      const { error } = await supabase.rpc("update_participant_flight_details", {
        p_portal_token: portalToken ?? null,
        p_registration_id: portalToken ? null : (registrationId ?? null),
        p_flight_details: payload,
      })

      if (error) throw error

      toast.success("Dados do voo salvos com sucesso!")
      onSaved(payload)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Não foi possível salvar os dados do voo."
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card id="dados-voo" className={THEME_CLASSES.card}>
      <CardHeader className="border-b border-border/60">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Plane className="size-4 text-primary shrink-0" />
            <CardTitle className="text-base font-bold text-foreground">
              Dados do Voo e Chegada
            </CardTitle>
          </div>
          {initialFlightDetails && (
            <Badge variant="outline" className={THEME_CLASSES.badgeSuccess}>
              <CheckCircle2 data-icon="inline-start" />
              Informado
            </Badge>
          )}
        </div>
        <CardDescription>
          Informe os horários de chegada e retorno para apoiar a organização logística.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {initialFlightDetails && (
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground flex flex-col gap-1">
            <span className="font-semibold text-foreground">
              Voo registrado: {initialFlightDetails.arrivalAirline} {initialFlightDetails.arrivalFlightNumber} ({initialFlightDetails.arrivalAirport})
            </span>
            <span>
              Chegada: {formatFlightDateTime(initialFlightDetails.arrivalDateTime)}
              {initialFlightDetails.needsAirportTransfer ? " • Traslado solicitado" : ""}
            </span>
          </div>
        )}

        {isCancelled && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            Esta inscrição foi cancelada. Não é possível editar informações de voo.
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
          <FieldGroup>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field data-invalid={!!errors.arrivalAirline} data-disabled={isCancelled}>
                <FieldLabel htmlFor="arrivalAirline">Companhia Aérea (Chegada) *</FieldLabel>
                <Input
                  id="arrivalAirline"
                  placeholder="Ex: LATAM, Gol, Azul"
                  className="min-h-[44px]"
                  disabled={isCancelled || saving}
                  aria-invalid={!!errors.arrivalAirline}
                  {...register("arrivalAirline")}
                />
                <FieldError errors={[errors.arrivalAirline]} />
              </Field>

              <Field data-invalid={!!errors.arrivalFlightNumber} data-disabled={isCancelled}>
                <FieldLabel htmlFor="arrivalFlightNumber">Número do Voo (Chegada) *</FieldLabel>
                <Input
                  id="arrivalFlightNumber"
                  placeholder="Ex: LA3456"
                  className="min-h-[44px]"
                  disabled={isCancelled || saving}
                  aria-invalid={!!errors.arrivalFlightNumber}
                  {...register("arrivalFlightNumber")}
                />
                <FieldError errors={[errors.arrivalFlightNumber]} />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field data-invalid={!!errors.arrivalAirport} data-disabled={isCancelled}>
                <FieldLabel htmlFor="arrivalAirport">Aeroporto de Chegada *</FieldLabel>
                <Input
                  id="arrivalAirport"
                  placeholder="Ex: CNF (Confins) ou PLU"
                  className="min-h-[44px]"
                  disabled={isCancelled || saving}
                  aria-invalid={!!errors.arrivalAirport}
                  {...register("arrivalAirport")}
                />
                <FieldError errors={[errors.arrivalAirport]} />
              </Field>

              <Field data-invalid={!!errors.arrivalDateTime} data-disabled={isCancelled}>
                <FieldLabel htmlFor="arrivalDateTime">Data e Horário de Chegada *</FieldLabel>
                <Input
                  id="arrivalDateTime"
                  type="datetime-local"
                  className="min-h-[44px]"
                  disabled={isCancelled || saving}
                  aria-invalid={!!errors.arrivalDateTime}
                  {...register("arrivalDateTime")}
                />
                <FieldError errors={[errors.arrivalDateTime]} />
              </Field>
            </div>

            <Separator />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field data-invalid={!!errors.departureAirline} data-disabled={isCancelled}>
                <FieldLabel htmlFor="departureAirline">Companhia Aérea (Retorno)</FieldLabel>
                <Input
                  id="departureAirline"
                  placeholder="Opcional"
                  className="min-h-[44px]"
                  disabled={isCancelled || saving}
                  aria-invalid={!!errors.departureAirline}
                  {...register("departureAirline")}
                />
                <FieldError errors={[errors.departureAirline]} />
              </Field>

              <Field data-invalid={!!errors.departureFlightNumber} data-disabled={isCancelled}>
                <FieldLabel htmlFor="departureFlightNumber">Número do Voo (Retorno)</FieldLabel>
                <Input
                  id="departureFlightNumber"
                  placeholder="Opcional"
                  className="min-h-[44px]"
                  disabled={isCancelled || saving}
                  aria-invalid={!!errors.departureFlightNumber}
                  {...register("departureFlightNumber")}
                />
                <FieldError errors={[errors.departureFlightNumber]} />
              </Field>
            </div>

            <Field data-invalid={!!errors.departureDateTime} data-disabled={isCancelled}>
              <FieldLabel htmlFor="departureDateTime">Data e Horário de Retorno</FieldLabel>
              <Input
                id="departureDateTime"
                type="datetime-local"
                className="min-h-[44px]"
                disabled={isCancelled || saving}
                aria-invalid={!!errors.departureDateTime}
                {...register("departureDateTime")}
              />
              <FieldError errors={[errors.departureDateTime]} />
            </Field>

            <Field
              orientation="horizontal"
              data-disabled={isCancelled}
              className="justify-between rounded-lg border border-border bg-muted/20 p-3.5"
            >
              <div className="flex flex-col gap-0.5 pr-3">
                <FieldLabel htmlFor="needsAirportTransfer" className="cursor-pointer">
                  Preciso de traslado (transfer) do aeroporto
                </FieldLabel>
                <FieldDescription>
                  Marque caso precise de apoio dos organizadores no deslocamento a partir do aeroporto.
                </FieldDescription>
              </div>
              <Controller
                control={control}
                name="needsAirportTransfer"
                render={({ field }) => (
                  <Switch
                    id="needsAirportTransfer"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={isCancelled || saving}
                  />
                )}
              />
            </Field>

            <Field data-invalid={!!errors.notes} data-disabled={isCancelled}>
              <FieldLabel htmlFor="flightNotes">Observações sobre o voo (opcional)</FieldLabel>
              <Textarea
                id="flightNotes"
                placeholder="Ex: Chegando com família, bagagem extra ou conexão..."
                className="min-h-[88px]"
                disabled={isCancelled || saving}
                aria-invalid={!!errors.notes}
                {...register("notes")}
              />
              <FieldError errors={[errors.notes]} />
            </Field>
          </FieldGroup>

          {!isCancelled && (
            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={saving}
                className="min-h-[44px] w-full sm:w-auto px-5 font-semibold"
              >
                {saving ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Save data-icon="inline-start" />
                )}
                {saving ? "Salvando..." : "Salvar Dados do Voo"}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
