import { z } from "zod"
import { isValidBrazilianPhone } from "./phoneUtils"

/**
 * Validação de CPF brasileiro
 */
export const validateCPF = (cpf: string) => {
  const cleanCPF = cpf.replace(/\D/g, "")

  if (cleanCPF.length !== 11) return false
  if (/^(\d)\1+$/.test(cleanCPF)) return false

  let sum = 0
  let rest

  for (let i = 1; i <= 9; i++) {
    sum = sum + parseInt(cleanCPF.substring(i - 1, i)) * (11 - i)
  }

  rest = (sum * 10) % 11
  if (rest === 10 || rest === 11) rest = 0
  if (rest !== parseInt(cleanCPF.substring(9, 10))) return false

  sum = 0
  for (let i = 1; i <= 10; i++) {
    sum = sum + parseInt(cleanCPF.substring(i - 1, i)) * (12 - i)
  }

  rest = (sum * 10) % 11
  if (rest === 10 || rest === 11) rest = 0
  if (rest !== parseInt(cleanCPF.substring(10, 11))) return false

  return true
}

export const passwordSchema = z
  .string()
  .min(8, { message: "A senha deve ter pelo menos 8 caracteres." })
  .max(32, { message: "A senha deve ter no máximo 32 caracteres." })
  .refine((val) => /[A-Z]/.test(val), {
    message: "A senha deve conter pelo menos uma letra maiúscula.",
  })
  .refine((val) => /[a-z]/.test(val), {
    message: "A senha deve conter pelo menos uma letra minúscula.",
  })
  .refine((val) => /[0-9]/.test(val), {
    message: "A senha deve conter pelo menos um número.",
  })
  .refine((val) => /[!@#$%^&*(),.?":{}|<>]/.test(val), {
    message: "A senha deve conter pelo menos um caractere especial.",
  })

export const signInSchema = z.object({
  email: z.string().trim().email({ message: "Email inválido" }),
  password: z.string().min(1, { message: "Senha é obrigatória" }),
})
export type SignInValue = z.infer<typeof signInSchema>

export const signUpSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(3, { message: "Nome completo deve ter pelo menos 3 caracteres." }),
    email: z.string().trim().email({ message: "Email inválido" }),
    phone: z
      .string()
      .refine(isValidBrazilianPhone, {
        message: "Telefone inválido. Informe um número com DDD (ex: (31) 98888-7777).",
      }),
    cpf: z.string().refine(validateCPF, {
      message: "CPF inválido",
    }),
    birthDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, {
        message: "Data de nascimento inválida (AAAA-MM-DD)",
      }),
    baptismDate: z.union([
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, {
          message: "Data de batismo inválida (AAAA-MM-DD)",
        }),
      z.literal(""),
    ]),
    gender: z.enum(["masculino", "feminino", "outro"] as const),
    maritalStatus: z.enum([
      "solteiro",
      "casado",
      "divorciado",
      "viuvo",
    ] as const),
    addressZipCode: z.string().min(8, { message: "CEP inválido" }),
    addressStreet: z.string().min(3, { message: "Rua é obrigatória" }),
    addressNumber: z.string().min(1, { message: "Número é obrigatório" }),
    addressNeighborhood: z.string().min(2, { message: "Bairro é obrigatório" }),
    addressCity: z.string().min(2, { message: "Cidade é obrigatória" }),
    addressState: z
      .string()
      .length(2, { message: "Estado deve ser a sigla (ex: MG)" }),
    addressComplement: z.string().optional(),
    password: passwordSchema,
    confirmPassword: z
      .string()
      .min(1, { message: "Confirmação de senha é obrigatória" }),
    avatarUrl: z.string().optional(),
    occupation: z.string().min(2, { message: "Profissão é obrigatória" }),
    educationLevel: z.enum(
      [
        "Fundamental Incompleto",
        "Fundamental Completo",
        "Médio Incompleto",
        "Médio Completo",
        "Superior Incompleto",
        "Superior Completo",
        "Pós-graduação",
      ],
      {
        message: "Selecione seu nível de escolaridade",
      }
    ),
    employmentStatus: z.enum(
      [
        "CLT",
        "Autônomo/PJ",
        "Desempregado",
        "Aposentado",
        "Estudante",
        "Empreendedor",
      ],
      {
        message: "Selecione seu vínculo empregatício",
      }
    ),
    householdIncome: z.enum(
      [
        "Até 1 SM",
        "1 a 3 SM",
        "3 a 5 SM",
        "Acima de 5 SM",
        "Prefiro não informar",
      ],
      {
        message: "Selecione uma faixa de renda",
      }
    ),
    dependentsCount: z.coerce
      .number()
      .min(0, { message: "Número de dependentes inválido" }),
    housingStatus: z.enum(
      ["Própria", "Alugada", "Cedida/Parentes", "Financiada"],
      {
        message: "Selecione sua situação de moradia",
      }
    ),
    driversLicense: z.enum(["Não possui", "A", "B", "AB", "C", "D", "E"], {
      message: "Selecione sua categoria de CNH",
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem.",
    path: ["confirmPassword"],
  })
export type SignUpValue = z.infer<typeof signUpSchema>

const optionalBirthDateSchema = z
  .string()
  .refine(
    (val) => {
      if (!val || val.trim() === "") return true
      if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return false
      const [y, m, d] = val.split("-").map(Number)
      const parsed = new Date(Date.UTC(y, m - 1, d))
      return (
        parsed.getUTCFullYear() === y &&
        parsed.getUTCMonth() === m - 1 &&
        parsed.getUTCDate() === d
      )
    },
    { message: "Data de nascimento inválida (AAAA-MM-DD)." }
  )
  .optional()
  .or(z.literal(""))

const optionalCpfSchema = z
  .string()
  .refine((val) => !val || val.trim() === "" || validateCPF(val), {
    message: "CPF inválido.",
  })
  .optional()
  .or(z.literal(""))

const optionalPhoneSchema = z
  .string()
  .refine((val) => val === "" || isValidBrazilianPhone(val), {
    message:
      "Telefone inválido. Informe um número com DDD (ex: (31) 98888-7777).",
  })
  .optional()
  .or(z.literal(""))

export const retreatParticipantBaseSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(3, { message: "Nome completo deve ter pelo menos 3 caracteres." }),
  phone: optionalPhoneSchema,
  cpf: optionalCpfSchema,
  birthDate: optionalBirthDateSchema,
  gender: z
    .enum(["masculino", "feminino", "outro"] as const)
    .optional()
    .or(z.literal("")),
  cityState: z
    .string()
    .trim()
    .max(120, { message: "Cidade / Estado deve ter no máximo 120 caracteres." })
    .optional()
    .or(z.literal("")),
  dietaryRestrictions: z
    .string()
    .trim()
    .max(500, {
      message: "Restrições alimentares devem ter no máximo 500 caracteres.",
    })
    .optional()
    .or(z.literal("")),
  emergencyContact: z
    .string()
    .trim()
    .max(160, {
      message: "Contato de emergência deve ter no máximo 160 caracteres.",
    })
    .optional()
    .or(z.literal("")),
})

export type RetreatParticipantProfileValue = z.infer<
  typeof retreatParticipantBaseSchema
>

export const visitorSignUpSchema = retreatParticipantBaseSchema
  .extend({
    cpf: z
      .string()
      .min(1, { message: "CPF é obrigatório." })
      .refine(validateCPF, { message: "CPF inválido." }),
    email: z.string().trim().email({ message: "E-mail inválido." }),
    password: passwordSchema,
    confirmPassword: z
      .string()
      .min(1, { message: "Confirmação de senha é obrigatória." }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem.",
    path: ["confirmPassword"],
  })
export type VisitorSignUpValue = z.infer<typeof visitorSignUpSchema>

export const homeGroupSchema = z.object({
  meetingDay: z.number().min(0).max(6),
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, { message: "Horário inválido (HH:MM)" }),
  locationText: z
    .string()
    .min(5, { message: "Endereço deve ter pelo menos 5 caracteres." }),
  nucleusName: z
    .string()
    .trim()
    .max(120, { message: "Nome do núcleo deve ter no máximo 120 caracteres." })
    .optional()
    .nullable(),
  leader1Id: z.string().uuid({ message: "Selecione um líder" }),
  leader2Id: z.string().uuid().optional().nullable(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  sectorId: z.string().uuid().optional().nullable(),
})
export type HomeGroupValue = z.infer<typeof homeGroupSchema>
export const postSchema = z.object({
  title: z
    .string()
    .min(3, { message: "Título deve ter pelo menos 3 caracteres." }),
  content: z
    .string()
    .min(10, { message: "Conteúdo deve ter pelo menos 10 caracteres." }),
  category: z.enum([
    "geral",
    "oracao",
    "missoes",
    "encontro",
    "estudo",
    "formulario",
    "evento",
  ] as const),
  isPublic: z.boolean(),
  isPublished: z.boolean(),
  imageUrls: z.array(z.string()),
  eventStartDate: z.string().nullable().optional(),
  eventEndDate: z.string().nullable().optional(),
  eventLocation: z.string().nullable().optional(),
  mediaResourceId: z.string().nullable().optional(),
  formId: z.string().nullable().optional(),
  retreatId: z.string().nullable().optional(),
  eventLabel: z.string().nullable().optional(),
})
export type PostValue = z.infer<typeof postSchema>

export const flightDetailsSchema = z.object({
  arrivalAirline: z
    .string()
    .trim()
    .min(2, { message: "Informe a companhia aérea de chegada." }),
  arrivalFlightNumber: z
    .string()
    .trim()
    .min(2, { message: "Informe o número do voo de chegada." }),
  arrivalAirport: z
    .string()
    .trim()
    .min(2, { message: "Informe o aeroporto de chegada (ex: CNF, PLU)." }),
  arrivalDateTime: z
    .string()
    .trim()
    .min(1, { message: "Informe a data e horário de chegada." }),
  departureAirline: z.string().trim().optional().or(z.literal("")),
  departureFlightNumber: z.string().trim().optional().or(z.literal("")),
  departureDateTime: z.string().trim().optional().or(z.literal("")),
  needsAirportTransfer: z.boolean(),
  notes: z
    .string()
    .trim()
    .max(500, { message: "Observações devem ter no máximo 500 caracteres." })
    .optional()
    .or(z.literal("")),
})
export type FlightDetailsValue = z.infer<typeof flightDetailsSchema>

export const portalMessageSchema = z.object({
  message: z
    .string()
    .trim()
    .min(2, { message: "Escreva uma mensagem com pelo menos 2 caracteres." })
    .max(2000, { message: "A mensagem deve ter no máximo 2000 caracteres." }),
})
export type PortalMessageValue = z.infer<typeof portalMessageSchema>

export const cancelAndRefundSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .max(500, { message: "O motivo deve ter no máximo 500 caracteres." })
      .optional()
      .or(z.literal("")),
    requestRefund: z.boolean(),
    pixKey: z.string().trim().optional().or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    if (data.requestRefund && (!data.pixKey || data.pixKey.trim().length < 3)) {
      ctx.addIssue({
        code: "custom",
        path: ["pixKey"],
        message: "Informe uma chave PIX válida para receber o reembolso.",
      })
    }
  })
export type CancelAndRefundValue = z.infer<typeof cancelAndRefundSchema>

export const manageRefundSchema = z.object({
  refundStatus: z.enum([
    "pendente",
    "em_analise",
    "aprovado",
    "recusado",
    "reembolsado",
  ] as const),
  refundNotes: z
    .string()
    .trim()
    .max(1000, { message: "As observações devem ter no máximo 1000 caracteres." })
    .optional()
    .or(z.literal("")),
})
export type ManageRefundValue = z.infer<typeof manageRefundSchema>
