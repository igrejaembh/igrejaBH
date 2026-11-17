import { useEffect, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, CheckCircle2Icon } from "lucide-react"
import { toast } from "sonner"
import supabase from "@/lib/supabase"
import {
  retreatParticipantBaseSchema,
  type RetreatParticipantProfileValue,
} from "@/lib/schemas"
import { cleanCPF, formatCPF } from "@/lib/cpfUtils"
import { formatPhone } from "@/lib/phoneUtils"
import {
  claimParticipantRegistrationsSafe,
  toProfileGenderValue,
} from "@/lib/participantProfile"
import { invalidateCurrentUserProfileCache } from "@/hooks/useCurrentUserProfile"
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
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { CardSelector, CardSelectorItem } from "@/components/ui/card-selector"

export interface RetreatProfileEditableValues {
  user_id?: string | null
  full_name: string
  phone?: string | null
  cpf?: string | null
  birth_date?: string | null
  gender?: string | null
  city_state?: string | null
  dietary_restrictions?: string | null
  emergency_contact?: string | null
}

export interface EditRetreatProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile: RetreatProfileEditableValues
  mode?: "full" | "retreat_only"
  onSuccess: () => Promise<void>
}

export function EditRetreatProfileDialog({
  open,
  onOpenChange,
  profile,
  mode = "full",
  onSuccess,
}: EditRetreatProfileDialogProps) {
  const [saving, setSaving] = useState(false)
  const isRetreatOnly = mode === "retreat_only"

  const form = useForm<RetreatParticipantProfileValue>({
    resolver: zodResolver(retreatParticipantBaseSchema),
    defaultValues: {
      fullName: profile.full_name || "",
      phone: profile.phone ? formatPhone(profile.phone) : "",
      cpf: profile.cpf ? formatCPF(profile.cpf) : "",
      birthDate: profile.birth_date || "",
      gender: toProfileGenderValue(profile.gender),
      cityState: profile.city_state || "",
      dietaryRestrictions: profile.dietary_restrictions || "",
      emergencyContact: profile.emergency_contact || "",
    },
  })

  useEffect(() => {
    if (open && profile) {
      form.reset({
        fullName: profile.full_name || "",
        phone: profile.phone ? formatPhone(profile.phone) : "",
        cpf: profile.cpf ? formatCPF(profile.cpf) : "",
        birthDate: profile.birth_date || "",
        gender: toProfileGenderValue(profile.gender),
        cityState: profile.city_state || "",
        dietaryRestrictions: profile.dietary_restrictions || "",
        emergencyContact: profile.emergency_contact || "",
      })
    }
  }, [open, profile, form])

  async function onSubmit(values: RetreatParticipantProfileValue) {
    try {
      setSaving(true)

      let userId = profile.user_id
      if (!userId) {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        userId = session?.user?.id
      }
      if (!userId) {
        toast.error("Sessão expirada. Faça login novamente.")
        return
      }

      const cleanedCpf = cleanCPF(values.cpf)
      const formattedCpf = cleanedCpf.length === 11 ? formatCPF(cleanedCpf) : null

      const updates: Record<string, string | null> = isRetreatOnly
        ? {
            city_state: values.cityState?.trim() || null,
            dietary_restrictions: values.dietaryRestrictions?.trim() || null,
            emergency_contact: values.emergencyContact?.trim() || null,
          }
        : {
            full_name: values.fullName.trim(),
            phone: values.phone?.trim() || null,
            cpf: formattedCpf,
            birth_date: values.birthDate?.trim() || null,
            gender: values.gender || null,
            city_state: values.cityState?.trim() || null,
            dietary_restrictions: values.dietaryRestrictions?.trim() || null,
            emergency_contact: values.emergencyContact?.trim() || null,
          }

      const { error } = await supabase
        .from("profiles")
        .update(updates)
        .eq("user_id", userId)

      if (error) {
        if (
          error.code === "23505" ||
          error.message?.toLowerCase().includes("cpf")
        ) {
          form.setError("cpf", {
            message: "Este CPF já está cadastrado em outra conta.",
          })
          toast.error("Este CPF já está cadastrado em outra conta.")
          return
        }
        throw error
      }

      if (!isRetreatOnly && values.fullName.trim() !== profile.full_name) {
        try {
          await supabase.auth.updateUser({
            data: { full_name: values.fullName.trim() },
          })
        } catch (authErr) {
          console.warn(
            "Não foi possível sincronizar nome no auth metadata:",
            authErr
          )
        }
      }

      const claimedCount = await claimParticipantRegistrationsSafe()
      await invalidateCurrentUserProfileCache()
      await onSuccess()

      toast.success(
        claimedCount > 0
          ? `Dados salvos e ${claimedCount} inscrição(ões) anteriores vinculada(s)!`
          : "Dados de participante atualizados com sucesso!"
      )
      onOpenChange(false)
    } catch (err) {
      console.error("Erro ao salvar perfil de participante:", err)
      toast.error("Não foi possível salvar suas alterações. Tente novamente.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        className="flex max-h-[90dvh] flex-col overflow-hidden rounded-3xl border-border/60 bg-card/95 p-0 backdrop-blur-xl"
      >
        <DialogHeader className="shrink-0 border-b border-border/40 p-5 pb-4 text-left">
          <DialogTitle className="text-xl font-bold tracking-tight">
            {isRetreatOnly
              ? "Preferências para Retiros e Encontros"
              : "Editar Dados do Participante"}
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm text-muted-foreground">
            {isRetreatOnly
              ? "Mantenha cidade, restrições alimentares e contato de emergência salvos para agilizar futuras inscrições."
              : "Essas informações agilizam suas inscrições em retiros e encontros da Igreja em Belo Horizonte."}
          </DialogDescription>
        </DialogHeader>

        <form
          id="edit-retreat-profile-form"
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex-1 overflow-y-auto p-5"
        >
          <FieldGroup>
            {!isRetreatOnly && (
              <>
                <Controller
                  name="fullName"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="retreat-profile-fullname">
                        Nome Completo*
                      </FieldLabel>
                      <Input
                        {...field}
                        id="retreat-profile-fullname"
                        aria-invalid={fieldState.invalid}
                        disabled={saving}
                        className="min-h-[44px]"
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Controller
                    name="phone"
                    control={form.control}
                    render={({
                      field: { onChange, value, ...fieldProps },
                      fieldState,
                    }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor="retreat-profile-phone">
                          Telefone / WhatsApp
                        </FieldLabel>
                        <Input
                          {...fieldProps}
                          id="retreat-profile-phone"
                          value={value || ""}
                          aria-invalid={fieldState.invalid}
                          disabled={saving}
                          onChange={(e) => onChange(formatPhone(e.target.value))}
                          placeholder="(31) 98888-7777"
                          maxLength={20}
                          className="min-h-[44px]"
                        />
                        <FieldError errors={[fieldState.error]} />
                      </Field>
                    )}
                  />

                  <Controller
                    name="cpf"
                    control={form.control}
                    render={({
                      field: { onChange, value, ...fieldProps },
                      fieldState,
                    }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor="retreat-profile-cpf">
                          CPF
                        </FieldLabel>
                        <Input
                          {...fieldProps}
                          id="retreat-profile-cpf"
                          inputMode="numeric"
                          value={value || ""}
                          aria-invalid={fieldState.invalid}
                          disabled={saving}
                          onChange={(e) => onChange(formatCPF(e.target.value))}
                          placeholder="000.000.000-00"
                          maxLength={14}
                          className="min-h-[44px]"
                        />
                        <FieldDescription>
                          Também ajuda a localizar inscrições anteriores.
                        </FieldDescription>
                        <FieldError errors={[fieldState.error]} />
                      </Field>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Controller
                    name="birthDate"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor="retreat-profile-birthdate">
                          Data de Nascimento
                        </FieldLabel>
                        <Input
                          {...field}
                          id="retreat-profile-birthdate"
                          type="date"
                          value={field.value || ""}
                          aria-invalid={fieldState.invalid}
                          disabled={saving}
                          className="min-h-[44px]"
                        />
                        <FieldError errors={[fieldState.error]} />
                      </Field>
                    )}
                  />

                  <Controller
                    name="cityState"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor="retreat-profile-citystate">
                          Cidade / Estado
                        </FieldLabel>
                        <Input
                          {...field}
                          id="retreat-profile-citystate"
                          value={field.value || ""}
                          aria-invalid={fieldState.invalid}
                          disabled={saving}
                          placeholder="Ex: Belo Horizonte / MG"
                          className="min-h-[44px]"
                        />
                        <FieldError errors={[fieldState.error]} />
                      </Field>
                    )}
                  />
                </div>

                <Controller
                  name="gender"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel>Sexo / Gênero</FieldLabel>
                      <CardSelector
                        value={field.value || ""}
                        onValueChange={field.onChange}
                        columns={2}
                        disabled={saving}
                      >
                        <CardSelectorItem
                          value="masculino"
                          label="Masculino"
                          size="sm"
                        />
                        <CardSelectorItem
                          value="feminino"
                          label="Feminino"
                          size="sm"
                        />
                      </CardSelector>
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
              </>
            )}

            {isRetreatOnly && (
              <Controller
                name="cityState"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="retreat-only-citystate">
                      Cidade / Estado para Retiros
                    </FieldLabel>
                    <Input
                      {...field}
                      id="retreat-only-citystate"
                      value={field.value || ""}
                      aria-invalid={fieldState.invalid}
                      disabled={saving}
                      placeholder="Ex: Belo Horizonte / MG"
                      className="min-h-[44px]"
                    />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
            )}

            <Controller
              name="emergencyContact"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="retreat-profile-emergency">
                    Contato de Emergência
                  </FieldLabel>
                  <Input
                    {...field}
                    id="retreat-profile-emergency"
                    value={field.value || ""}
                    aria-invalid={fieldState.invalid}
                    disabled={saving}
                    placeholder="Ex: Nome do familiar e telefone"
                    className="min-h-[44px]"
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />

            <Controller
              name="dietaryRestrictions"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="retreat-profile-dietary">
                    Restrições Alimentares ou Alergias
                  </FieldLabel>
                  <Textarea
                    {...field}
                    id="retreat-profile-dietary"
                    value={field.value || ""}
                    aria-invalid={fieldState.invalid}
                    disabled={saving}
                    placeholder="Ex: Intolerância à lactose, alergia a amendoim, medicação contínua..."
                    className="min-h-[88px]"
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          </FieldGroup>
        </form>

        <DialogFooter className="shrink-0 flex-row items-center justify-between gap-3 border-t border-border/40 bg-card/60 p-4 sm:p-5">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="min-h-[44px] rounded-xl"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            form="edit-retreat-profile-form"
            disabled={saving}
            className="min-h-[44px] gap-2 rounded-xl font-bold shadow-lg shadow-primary/20"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                <CheckCircle2Icon className="h-4 w-4" />
                Salvar Dados
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
