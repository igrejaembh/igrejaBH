import { useForm, Controller } from "react-hook-form";
import { 
    signUpSchema, 
    type SignUpValue, 
    visitorSignUpSchema, 
    type VisitorSignUpValue, 
    validateCPF 
} from "../lib/schemas"
import { formatPhone } from "@/lib/phoneUtils"
import { cleanCPF, formatCPF } from "@/lib/cpfUtils"
import {
    claimParticipantRegistrationsSafe,
    clearGuestPrefillSession,
    getSafeRedirectPath,
    readGuestPrefillFromSession,
    toProfileGenderValue,
} from "@/lib/participantProfile"
import {
    normalizeGender,
    normalizeMaritalStatus,
    normalizeEducationLevel,
    normalizeEmploymentStatus,
    normalizeHouseholdIncome,
    normalizeHousingStatus,
    normalizeDriversLicense,
} from "@/lib/profileNormalization"
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
import { Textarea } from "@/components/ui/textarea"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { 
    EyeIcon, 
    EyeOffIcon, 
    UploadIcon, 
    UserIcon, 
    SearchIcon, 
    Loader2, 
    ArrowLeftIcon, 
    XIcon,
    BookOpenIcon,
    UsersIcon,
    InfoIcon,
    AlertCircleIcon,
} from "lucide-react";
import { useState, useRef, useEffect, useMemo } from "react";
import supabase from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { CardSelector, CardSelectorItem } from "@/components/ui/card-selector";
import { 
    Dialog, 
    DialogContent, 
    DialogHeader, 
    DialogTitle, 
    DialogDescription 
} from "@/components/ui/dialog";
import { ImageCropper } from "@/components/ImageCropper";

function AccountTypeSelector({ 
    selected, 
    onSelect 
}: { 
    selected: 'visitor' | 'church_member'; 
    onSelect: (type: 'visitor' | 'church_member') => void;
}) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 p-1 bg-muted/60 rounded-xl border border-border/50">
            <button
                type="button"
                onClick={() => onSelect('visitor')}
                className={cn(
                    "flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs sm:text-sm font-semibold transition-all min-h-[44px] cursor-pointer text-center",
                    selected === 'visitor'
                        ? "bg-background text-foreground shadow-xs border border-border/60"
                        : "text-muted-foreground hover:text-foreground"
                )}
            >
                <BookOpenIcon className="h-4 w-4 text-primary shrink-0" />
                <span>Participante de Retiros &amp; Estudos</span>
            </button>
            <button
                type="button"
                onClick={() => onSelect('church_member')}
                className={cn(
                    "flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs sm:text-sm font-semibold transition-all min-h-[44px] cursor-pointer text-center",
                    selected === 'church_member'
                        ? "bg-background text-foreground shadow-xs border border-border/60"
                        : "text-muted-foreground hover:text-foreground"
                )}
            >
                <UsersIcon className="h-4 w-4 text-primary shrink-0" />
                <span>Caminho na Igreja em BH</span>
            </button>
        </div>
    );
}

export default function SignUp() {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const fileInputRef = useRef<HTMLInputElement>(null)

    const initialPrefill = useMemo(() => {
        const stored = readGuestPrefillFromSession()
        const rawPhone =
            searchParams.get("telefone") ||
            searchParams.get("phone") ||
            stored?.phone ||
            ""
        const rawCpf = searchParams.get("cpf") || stored?.cpf || ""
        const rawGender =
            searchParams.get("genero") ||
            searchParams.get("gender") ||
            stored?.gender ||
            ""
        const rawBirthDate =
            searchParams.get("nascimento") ||
            searchParams.get("birthDate") ||
            searchParams.get("birth_date") ||
            stored?.birthDate ||
            ""
        return {
            fullName:
                searchParams.get("nome") ||
                searchParams.get("fullName") ||
                searchParams.get("name") ||
                stored?.fullName ||
                "",
            email: searchParams.get("email") || stored?.email || "",
            phone: rawPhone ? formatPhone(rawPhone) : "",
            cpf: rawCpf ? formatCPF(rawCpf) : "",
            birthDate: /^\d{4}-\d{2}-\d{2}$/.test(rawBirthDate)
                ? rawBirthDate
                : "",
            gender: toProfileGenderValue(rawGender),
            cityState:
                searchParams.get("cidade") ||
                searchParams.get("cityState") ||
                searchParams.get("city_state") ||
                stored?.cityState ||
                "",
            dietaryRestrictions:
                searchParams.get("restricoes") ||
                searchParams.get("dietaryRestrictions") ||
                searchParams.get("dietary_restrictions") ||
                stored?.dietaryRestrictions ||
                "",
            emergencyContact:
                searchParams.get("emergencia") ||
                searchParams.get("emergencyContact") ||
                searchParams.get("emergency_contact") ||
                stored?.emergencyContact ||
                "",
            redirectTo: getSafeRedirectPath(searchParams.get("redirect")),
            fromGuestRetreat: Boolean(
                searchParams.get("email") ||
                    searchParams.get("nome") ||
                    searchParams.get("cpf") ||
                    stored
            ),
        }
    }, [searchParams])

    const signForm = useForm<SignUpValue>({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resolver: zodResolver(signUpSchema) as any,
        defaultValues: {
            fullName: "",
            email: "",
            phone: "",
            cpf: "",
            birthDate: "",
            baptismDate: "",
            gender: "masculino",
            maritalStatus: "solteiro",
            addressZipCode: "",
            addressStreet: "",
            addressNumber: "",
            addressNeighborhood: "",
            addressCity: "Belo Horizonte",
            addressState: "MG",
            addressComplement: "",
            password: "",
            confirmPassword: "",
            occupation: "",
            educationLevel: "Médio Completo",
            employmentStatus: "CLT",
            householdIncome: "1 a 3 SM",
            dependentsCount: 0,
            housingStatus: "Própria",
            driversLicense: "Não possui",
        }
    })

    const [accountType, setAccountType] = useState<'visitor' | 'church_member'>(() => {
        const mode = (searchParams.get("tab") || searchParams.get("modo") || "").toLowerCase()
        if (mode === "igreja" || mode === "discipulo" || mode === "church") {
            return "church_member"
        }
        return "visitor"
    })
    const [cpfNotFound, setCpfNotFound] = useState(false)
    const [visitorCpfNotice, setVisitorCpfNotice] = useState<
        | { type: "linked"; cpf: string }
        | { type: "church_pre_registered"; cpf: string }
        | null
    >(null)
    const [checkingVisitorCpf, setCheckingVisitorCpf] = useState(false)

    const visitorForm = useForm<VisitorSignUpValue>({
        resolver: zodResolver(visitorSignUpSchema),
        defaultValues: {
            fullName: initialPrefill.fullName,
            email: initialPrefill.email,
            phone: initialPrefill.phone,
            cpf: initialPrefill.cpf,
            birthDate: initialPrefill.birthDate,
            gender: initialPrefill.gender,
            cityState: initialPrefill.cityState,
            dietaryRestrictions: initialPrefill.dietaryRestrictions,
            emergencyContact: initialPrefill.emergencyContact,
            password: "",
            confirmPassword: "",
        }
    })

    const watchedVisitorCpf = visitorForm.watch("cpf")

    useEffect(() => {
        const clean = cleanCPF(watchedVisitorCpf)
        if (clean.length !== 11 || !validateCPF(clean)) {
            setVisitorCpfNotice(null)
            return
        }

        let active = true
        const timer = setTimeout(async () => {
            setCheckingVisitorCpf(true)
            try {
                const formatted = formatCPF(clean)
                const { data, error } = await supabase.rpc("check_cpf_registration", {
                    p_cpf: formatted,
                })
                if (!active || error || !data || data.length === 0) return

                const result = data[0]
                if (!result.exists_profile) {
                    setVisitorCpfNotice(null)
                } else if (result.is_linked) {
                    setVisitorCpfNotice({ type: "linked", cpf: formatted })
                } else if (result.has_baptism_date || result.is_baptized) {
                    setVisitorCpfNotice({
                        type: "church_pre_registered",
                        cpf: formatted,
                    })
                } else {
                    setVisitorCpfNotice(null)
                }
            } catch (err) {
                console.warn("Erro ao consultar CPF na aba de participante:", err)
            } finally {
                if (active) setCheckingVisitorCpf(false)
            }
        }, 300)

        return () => {
            active = false
            clearTimeout(timer)
        }
    }, [watchedVisitorCpf])

    const [showPassword, setShowPassword] = useState(false)
    const [showConfirmPassword, setShowConfirmPassword] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [searchingCep, setSearchingCep] = useState(false)

    const [step, setStep] = useState<'cpf_check' | 'complete'>('cpf_check')
    const [verificationCpf, setVerificationCpf] = useState('')
    const [verifyingCpf, setVerifyingCpf] = useState(false)
    const [cpfError, setCpfError] = useState<string | null>(null)

    const verifyAndAdvanceChurchCpf = async (cpfToVerify: string) => {
        const cleanCpf = cpfToVerify.replace(/\D/g, "");
        if (cleanCpf.length !== 11) {
            setCpfError("CPF deve conter 11 dígitos");
            setCpfNotFound(false);
            return;
        }
        if (!validateCPF(cleanCpf)) {
            setCpfError("CPF inválido");
            setCpfNotFound(false);
            return;
        }

        setVerifyingCpf(true);
        setCpfError(null);
        setCpfNotFound(false);
        try {
            const formattedCpf = formatCPF(cleanCpf);
            const { data, error } = await supabase.rpc('check_cpf_registration', {
                p_cpf: formattedCpf
            });

            if (error) {
                console.error("Erro na verificação de CPF:", error);
                setCpfError("Erro ao verificar o CPF. Tente novamente.");
                return;
            }

            if (!data || data.length === 0 || !data[0].exists_profile) {
                setCpfError("CPF não encontrado no pré-cadastro da igreja. Se você já caminha conosco, converse com seu discipulador ou líder de grupo caseiro.");
                setCpfNotFound(true);
                return;
            }

            const result = data[0];

            if (result.is_linked) {
                setCpfError("Este CPF já está vinculado a um usuário cadastrado. Se você já tem uma conta, faça login.");
                return;
            }

            if (!result.has_baptism_date && !result.is_baptized) {
                setCpfError("Seu cadastro está pendente. É necessário que seu discipulador ou um líder de grupo caseiro atualize seu status para batizado antes de realizar o cadastro.");
                return;
            }

            // CPF is eligible! Pre-fill the form and proceed
            signForm.setValue("cpf", formattedCpf);
            signForm.setValue("fullName", result.full_name || "");
            signForm.setValue("email", result.email || "");
            signForm.setValue("phone", formatPhone(result.phone || ""));
            signForm.setValue("birthDate", result.birth_date || "");
            signForm.setValue("baptismDate", result.baptism_date || "");
            signForm.setValue("gender", normalizeGender(result.gender));
            signForm.setValue("maritalStatus", normalizeMaritalStatus(result.marital_status));
            signForm.setValue("addressZipCode", result.address_zip_code || "");
            signForm.setValue("addressStreet", result.address_street || "");
            signForm.setValue("addressNumber", result.address_number || "");
            signForm.setValue("addressNeighborhood", result.address_neighborhood || "");
            signForm.setValue("addressCity", result.address_city || "Belo Horizonte");
            signForm.setValue("addressState", result.address_state || "MG");
            signForm.setValue("addressComplement", result.address_complement || "");
            signForm.setValue("occupation", result.occupation || "");
            signForm.setValue("educationLevel", normalizeEducationLevel(result.education_level));
            signForm.setValue("employmentStatus", normalizeEmploymentStatus(result.employment_status));
            signForm.setValue("householdIncome", normalizeHouseholdIncome(result.household_income));
            signForm.setValue("dependentsCount", result.dependents_count || 0);
            signForm.setValue("housingStatus", normalizeHousingStatus(result.housing_status));
            signForm.setValue("driversLicense", normalizeDriversLicense(result.drivers_license));

            setStep('complete');
            toast.success("CPF verificado com sucesso! Por favor, complete seus dados de cadastro.");
        } catch (err) {
            console.error(err);
            setCpfError("Ocorreu um erro inesperado.");
        } finally {
            setVerifyingCpf(false);
        }
    };

    const handleVerifyCpf = async (e: React.FormEvent) => {
        e.preventDefault();
        await verifyAndAdvanceChurchCpf(verificationCpf);
    };
    const [avatarFile, setAvatarFile] = useState<File | null>(null)
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
    const [isCropping, setIsCropping] = useState(false)

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0]
            setAvatarPreview(URL.createObjectURL(file))
            setIsCropping(true)
        }
    }

    const handleCropComplete = (croppedBlob: Blob) => {
        const file = new File([croppedBlob], "avatar.jpg", { type: "image/jpeg" });
        setAvatarFile(file);
        setAvatarPreview(URL.createObjectURL(croppedBlob));
        setIsCropping(false);
    };

    const clearAvatar = (e: React.MouseEvent) => {
        e.stopPropagation();
        setAvatarFile(null);
        setAvatarPreview(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    // Busca CEP automaticamente
    const zipCode = signForm.watch("addressZipCode");
    useEffect(() => {
        const fetchCep = async () => {
            const cleanCep = zipCode?.replace(/\D/g, "");
            if (cleanCep?.length === 8) {
                setSearchingCep(true);
                try {
                    const response = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
                    const data = await response.json();
                    
                    if (!data.erro) {
                        signForm.setValue("addressStreet", data.logradouro);
                        signForm.setValue("addressNeighborhood", data.bairro);
                        signForm.setValue("addressCity", data.localidade);
                        signForm.setValue("addressState", data.uf);
                        toast.success("Endereço preenchido automaticamente");
                    } else {
                        toast.error("CEP não encontrado");
                    }
                } catch {
                    toast.error("Erro ao buscar CEP");
                } finally {
                    setSearchingCep(false);
                }
            }
        };

        fetchCep();
    }, [zipCode, signForm]);

    async function onVisitorSubmit(data: VisitorSignUpValue) {
        setSubmitting(true)
        const signupOperation = async () => {
            const cleanedVisitorCpf = cleanCPF(data.cpf)
            const formattedVisitorCpf = cleanedVisitorCpf.length === 11 ? formatCPF(cleanedVisitorCpf) : null

            if (formattedVisitorCpf) {
                const { data: checkData, error: checkError } = await supabase.rpc('check_cpf_registration', {
                    p_cpf: formattedVisitorCpf
                })
                if (!checkError && checkData && checkData.length > 0 && checkData[0].exists_profile) {
                    const check = checkData[0]
                    if (check.is_linked) {
                        throw new Error("Este CPF já está vinculado a uma conta existente. Faça login para acessar.")
                    }
                    if (check.has_baptism_date || check.is_baptized) {
                        throw new Error("Localizamos um pré-cadastro seu na Igreja em Belo Horizonte. Use a aba 'Caminho na Igreja em BH' para ativar sua conta.")
                    }
                }
            }

            const { data: authData, error: authError } = await supabase.auth.signUp({
                email: data.email.trim(),
                password: data.password,
                options: {
                    data: {
                        account_mode: "visitor",
                        full_name: data.fullName.trim(),
                        phone: data.phone?.trim() || null,
                        cpf: formattedVisitorCpf,
                        birth_date: data.birthDate?.trim() || null,
                        gender: data.gender || null,
                        city_state: data.cityState?.trim() || null,
                        dietary_restrictions: data.dietaryRestrictions?.trim() || null,
                        emergency_contact: data.emergencyContact?.trim() || null,
                    }
                }
            })

            if (authError) throw authError
            if (!authData.user) throw new Error("Erro ao criar conta")

            if (avatarFile && authData.session) {
                try {
                    const fileExt = avatarFile.name.split('.').pop() || "jpg"
                    const filePath = `${authData.user.id}/avatar.${fileExt}`
                    const { error: uploadError } = await supabase.storage
                        .from('avatars')
                        .upload(filePath, avatarFile, {
                            upsert: true,
                            contentType: avatarFile.type || "image/jpeg"
                        })
                    if (!uploadError) {
                        const { data: { publicUrl } } = supabase.storage
                            .from('avatars')
                            .getPublicUrl(filePath)
                        await supabase
                            .from('profiles')
                            .update({ avatar_url: `${publicUrl}?t=${Date.now()}` })
                            .eq('user_id', authData.user.id)
                    }
                } catch (avatarErr) {
                    console.error("Erro no upload do avatar:", avatarErr)
                }
            }

            let claimedCount = 0
            if (authData.session) {
                claimedCount = await claimParticipantRegistrationsSafe()
            }

            clearGuestPrefillSession()
            return { authData, claimedCount }
        }

        toast.promise(signupOperation(), {
            loading: "Criando sua conta de participante...",
            success: ({ authData, claimedCount }) => {
                if (!authData.session) {
                    const loginUrl = initialPrefill.redirectTo
                        ? `/entrar?redirect=${encodeURIComponent(initialPrefill.redirectTo)}`
                        : "/entrar"
                    navigate(loginUrl)
                    return "Conta criada! Confirme seu e-mail e faça login para acessar."
                }
                navigate(initialPrefill.redirectTo || '/dashboard')
                if (claimedCount > 0) {
                    return `Conta criada e ${claimedCount} inscrição(ões) anteriores vinculada(s)!`
                }
                return "Conta criada com sucesso! Seja bem-vindo(a)."
            },
            error: (error) => {
                console.error("Erro no cadastro de participante:", error)
                if (error instanceof Error) {
                    if (error.message === "User already registered") {
                        return "Este e-mail já está cadastrado."
                    }
                    return error.message
                }
                return "Erro ao realizar cadastro. Tente novamente."
            },
            finally: () => {
                setSubmitting(false)
            }
        })
    }

    async function onSubmit(data: SignUpValue) {
        setSubmitting(true)
        
        const signupOperation = async () => {
            // 0. Verificar se existe um pré-cadastro batizado com este CPF usando a RPC
            const { data: checkData, error: checkError } = await supabase.rpc('check_cpf_registration', {
                p_cpf: data.cpf
            });

            if (checkError) {
                console.error("Erro ao buscar pré-cadastro:", checkError);
                throw new Error("Erro ao validar pré-cadastro no banco de dados.");
            }

            const check = checkData?.[0];

            if (!check || !check.exists_profile) {
                throw new Error("Pré-cadastro não encontrado. Por favor, entre em contato com seu discipulador ou com um líder de grupo caseiro para realizar seu cadastro inicial.");
            }

            if (check.is_linked) {
                throw new Error("Este CPF já está vinculado a um usuário registrado.");
            }

            if (!check.has_baptism_date && !check.is_baptized) {
                throw new Error("Seu cadastro está pendente. É necessário que seu discipulador ou um líder de grupo caseiro atualize seu status para batizado antes de realizar o cadastro.");
            }

            // 1. Auth SignUp Primeiro
            const { data: authData, error: authError } = await supabase.auth.signUp({
                email: data.email,
                password: data.password,
                options: {
                    data: {
                        full_name: data.fullName,
                        cpf: data.cpf,
                    }
                }
            })
            
            if (authError) throw authError
            if (!authData.user) throw new Error("Erro ao criar usuário");

            let avatarUrl = ""

            // 2. Upload Avatar (Agora com usuário criado)
            if (avatarFile) {
                const fileExt = avatarFile.name.split('.').pop() || "jpg"
                const filePath = `${authData.user.id}/avatar.${fileExt}`

                const { error: uploadError } = await supabase.storage
                    .from('avatars')
                    .upload(filePath, avatarFile, {
                        upsert: true,
                        contentType: avatarFile.type || "image/jpeg"
                    })

                if (uploadError) {
                    console.error("Erro no upload do avatar:", uploadError);
                    throw uploadError;
                }

                const { data: { publicUrl } } = supabase.storage
                    .from('avatars')
                    .getPublicUrl(filePath)
                
                avatarUrl = `${publicUrl}?t=${Date.now()}`
            }

            // 3. Update Profile
            const profileUpdates: Record<string, unknown> = {
                phone: data.phone,
                cpf: data.cpf,
                birth_date: data.birthDate,
                baptism_date: data.baptismDate || null,
                gender: data.gender,
                marital_status: data.maritalStatus,
                address_zip_code: data.addressZipCode,
                address_street: data.addressStreet,
                address_number: data.addressNumber,
                address_neighborhood: data.addressNeighborhood,
                address_city: data.addressCity,
                address_state: data.addressState,
                address_complement: data.addressComplement,
                occupation: data.occupation,
                education_level: data.educationLevel,
                employment_status: data.employmentStatus,
                household_income: data.householdIncome,
                dependents_count: data.dependentsCount,
                housing_status: data.housingStatus,
                drivers_license: data.driversLicense,
            };
            if (avatarUrl) {
                profileUpdates.avatar_url = avatarUrl;
            }

            const { error: profileError } = await supabase
                .from('profiles')
                .update(profileUpdates)
                .eq('user_id', authData.user.id)

            if (profileError) throw profileError

            if (authData.session) {
                await claimParticipantRegistrationsSafe()
            }

            return authData
        }

        toast.promise(signupOperation(), {
            loading: "Criando sua conta...",
            success: () => {
                navigate(initialPrefill.redirectTo || '/dashboard')
                return "Cadastro realizado com sucesso! Seja bem-vindo(a)."
            },
            error: (error) => {
                console.error("Error on sign up: ", error);
                if (error instanceof Error) {
                    if (error.message === "User already registered") {
                        return "Este e-mail já está cadastrado.";
                    }
                    return error.message;
                }
                return "Erro ao realizar cadastro. Tente novamente.";
            },
            finally: () => {
                setSubmitting(false)
            }
        })
    }

    const loginTarget = useMemo(() => {
        const params = new URLSearchParams()
        if (initialPrefill.redirectTo) params.set("redirect", initialPrefill.redirectTo)
        if (initialPrefill.email) params.set("email", initialPrefill.email)
        const qs = params.toString()
        return qs ? `/entrar?${qs}` : "/entrar"
    }, [initialPrefill.redirectTo, initialPrefill.email])

    return (
        <div className="relative min-h-screen flex items-center justify-center py-8 px-4 bg-background">
            {/* Dynamic Background Elements */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/20 blur-[120px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-secondary/20 blur-[120px]" />
            </div>

            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*"
                onChange={handleFileChange}
            />

            {accountType === 'visitor' ? (
                <Card className="w-full max-w-xl border-border bg-card/50 backdrop-blur-xl shadow-2xl relative z-10">
                    <CardHeader className="space-y-3 text-center">
                        <div className="flex items-center justify-between">
                            <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="min-h-[44px]">
                                <ArrowLeftIcon className="mr-2 h-4 w-4" />
                                Voltar
                            </Button>
                        </div>

                        {/* Seletor de Tipo de Cadastro */}
                        <AccountTypeSelector
                            selected={accountType}
                            onSelect={(t) => {
                                setAccountType(t);
                                setCpfError(null);
                                if (t === 'visitor') setCpfNotFound(false);
                            }}
                        />

                        <div>
                            <CardTitle className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                                Participante de Retiros &amp; Estudos
                            </CardTitle>
                            <CardDescription className="text-muted-foreground text-xs sm:text-sm mt-1">
                                Crie sua conta para acessar estudos e preencher suas próximas inscrições em retiros e encontros em segundos
                            </CardDescription>
                        </div>

                        {initialPrefill.fromGuestRetreat && (
                            <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 text-left flex items-start gap-2.5">
                                <InfoIcon className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                                <p className="text-xs text-muted-foreground leading-relaxed">
                                    Preenchemos seus dados a partir da sua inscrição. Ao concluir, suas inscrições anteriores com este e-mail ou CPF serão vinculadas automaticamente à sua conta.
                                </p>
                            </div>
                        )}
                    </CardHeader>

                    <CardContent>
                        <form id="visitor-sign-up-form" onSubmit={visitorForm.handleSubmit(onVisitorSubmit)} className="flex flex-col gap-5">
                            {/* Avatar */}
                            <div className="flex flex-col items-center gap-2">
                                <div className="relative h-20 w-20 group">
                                    <button
                                        type="button"
                                        className="relative h-full w-full rounded-full border-2 border-dashed border-muted-foreground/40 flex items-center justify-center bg-muted overflow-hidden cursor-pointer shadow-inner"
                                        onClick={() => fileInputRef.current?.click()}
                                        aria-label="Selecionar foto de perfil"
                                    >
                                        {avatarPreview ? (
                                            <img src={avatarPreview} alt="Preview" className="h-full w-full object-cover" />
                                        ) : (
                                            <UserIcon className="h-10 w-10 text-muted-foreground" />
                                        )}
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                            <UploadIcon className="h-5 w-5 text-white" />
                                        </div>
                                    </button>
                                    {avatarPreview && (
                                        <button 
                                            type="button" 
                                            onClick={clearAvatar}
                                            className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-2 shadow-lg transition-colors z-20 min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
                                            aria-label="Remover foto"
                                        >
                                            <XIcon className="h-3 w-3" />
                                        </button>
                                    )}
                                </div>
                                <p className="text-[11px] text-muted-foreground">Foto de perfil (opcional)</p>
                            </div>

                            <FieldGroup>
                                <Controller
                                    name="fullName"
                                    control={visitorForm.control}
                                    render={({ field, fieldState }) => (
                                        <Field data-invalid={fieldState.invalid}>
                                            <FieldLabel htmlFor="visitor-fullname">Nome Completo*</FieldLabel>
                                            <Input
                                                {...field}
                                                id="visitor-fullname"
                                                aria-invalid={fieldState.invalid}
                                                placeholder="Seu nome completo"
                                                className="min-h-[44px]"
                                            />
                                            <FieldError errors={[fieldState.error]} />
                                        </Field>
                                    )}
                                />

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <Controller
                                        name="email"
                                        control={visitorForm.control}
                                        render={({ field, fieldState }) => (
                                            <Field data-invalid={fieldState.invalid}>
                                                <FieldLabel htmlFor="visitor-email">E-mail*</FieldLabel>
                                                <Input
                                                    {...field}
                                                    id="visitor-email"
                                                    type="email"
                                                    aria-invalid={fieldState.invalid}
                                                    placeholder="seu@email.com"
                                                    className="min-h-[44px]"
                                                />
                                                <FieldError errors={[fieldState.error]} />
                                            </Field>
                                        )}
                                    />

                                    <Controller
                                        name="phone"
                                        control={visitorForm.control}
                                        render={({ field: { onChange, value, ...fieldProps }, fieldState }) => (
                                            <Field data-invalid={fieldState.invalid}>
                                                <FieldLabel htmlFor="visitor-phone">Telefone / WhatsApp (Opcional)</FieldLabel>
                                                <Input
                                                    {...fieldProps}
                                                    id="visitor-phone"
                                                    value={value || ""}
                                                    aria-invalid={fieldState.invalid}
                                                    onChange={(e) => {
                                                        const cursor = e.target.selectionStart;
                                                        const formatted = formatPhone(e.target.value);
                                                        onChange(formatted);
                                                        setTimeout(() => {
                                                            if (e.target && cursor !== null) {
                                                                const diff = formatted.length - e.target.value.length;
                                                                e.target.setSelectionRange(cursor + diff, cursor + diff);
                                                            }
                                                        }, 0);
                                                    }}
                                                    placeholder="+55 (31) 9XXXX-XXXX"
                                                    maxLength={20}
                                                    className="min-h-[44px]"
                                                />
                                                <FieldError errors={[fieldState.error]} />
                                            </Field>
                                        )}
                                    />
                                </div>
                            </FieldGroup>

                            <FieldSeparator>Dados para Retiros e Encontros (Opcional)</FieldSeparator>

                            <FieldGroup>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <Controller
                                        name="cpf"
                                        control={visitorForm.control}
                                        render={({ field: { onChange, value, ...fieldProps }, fieldState }) => (
                                            <Field data-invalid={fieldState.invalid}>
                                                <FieldLabel htmlFor="visitor-cpf">CPF (Opcional)</FieldLabel>
                                                <Input
                                                    {...fieldProps}
                                                    id="visitor-cpf"
                                                    inputMode="numeric"
                                                    value={value || ""}
                                                    aria-invalid={fieldState.invalid}
                                                    onChange={(e) => onChange(formatCPF(e.target.value))}
                                                    placeholder="000.000.000-00"
                                                    maxLength={14}
                                                    className="min-h-[44px]"
                                                />
                                                <FieldDescription>
                                                    Usado para preencher inscrições e localizar registros anteriores.
                                                </FieldDescription>
                                                <FieldError errors={[fieldState.error]} />
                                            </Field>
                                        )}
                                    />

                                    <Controller
                                        name="birthDate"
                                        control={visitorForm.control}
                                        render={({ field, fieldState }) => (
                                            <Field data-invalid={fieldState.invalid}>
                                                <FieldLabel htmlFor="visitor-birthdate">Data de Nascimento (Opcional)</FieldLabel>
                                                <Input
                                                    {...field}
                                                    id="visitor-birthdate"
                                                    type="date"
                                                    value={field.value || ""}
                                                    aria-invalid={fieldState.invalid}
                                                    className="min-h-[44px]"
                                                />
                                                <FieldError errors={[fieldState.error]} />
                                            </Field>
                                        )}
                                    />
                                </div>

                                {checkingVisitorCpf && (
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        <span>Verificando CPF...</span>
                                    </div>
                                )}

                                {visitorCpfNotice?.type === "church_pre_registered" && (
                                    <div
                                        role="status"
                                        className="rounded-xl border border-primary/30 bg-primary/5 p-3.5 text-left flex flex-col gap-2.5"
                                    >
                                        <div className="flex items-start gap-2">
                                            <InfoIcon className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                                            <p className="text-xs text-foreground leading-relaxed">
                                                Localizamos um pré-cadastro seu na Igreja em Belo Horizonte! Para ativar seu perfil completo de discípulo com seus dados já preenchidos, use a aba <strong>Caminho na Igreja em BH</strong>.
                                            </p>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                setVerificationCpf(visitorCpfNotice.cpf)
                                                setAccountType("church_member")
                                                setCpfError(null)
                                                setCpfNotFound(false)
                                                void verifyAndAdvanceChurchCpf(visitorCpfNotice.cpf)
                                            }}
                                            className="w-full min-h-[44px] text-xs font-semibold gap-2 border-primary/40 text-primary hover:bg-primary/10 cursor-pointer"
                                        >
                                            <UsersIcon className="h-3.5 w-3.5" />
                                            Ir para Caminho na Igreja em BH
                                        </Button>
                                    </div>
                                )}

                                {visitorCpfNotice?.type === "linked" && (
                                    <div
                                        role="alert"
                                        className="rounded-xl border border-destructive/30 bg-destructive/5 p-3.5 text-left flex flex-col gap-2.5"
                                    >
                                        <div className="flex items-start gap-2">
                                            <AlertCircleIcon className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                                            <p className="text-xs text-foreground leading-relaxed">
                                                Este CPF já está vinculado a uma conta ativa. Entre com seu e-mail e senha para acessar seus dados e inscrições.
                                            </p>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            asChild
                                            className="w-full min-h-[44px] text-xs font-semibold"
                                        >
                                            <Link to={loginTarget}>Entrar na minha conta</Link>
                                        </Button>
                                    </div>
                                )}

                                <Controller
                                    name="gender"
                                    control={visitorForm.control}
                                    render={({ field, fieldState }) => (
                                        <Field data-invalid={fieldState.invalid}>
                                            <FieldLabel>Sexo / Gênero (Opcional)</FieldLabel>
                                            <CardSelector
                                                value={field.value || ""}
                                                onValueChange={field.onChange}
                                                columns={2}
                                            >
                                                <CardSelectorItem value="masculino" label="Masculino" size="sm" />
                                                <CardSelectorItem value="feminino" label="Feminino" size="sm" />
                                            </CardSelector>
                                            <FieldError errors={[fieldState.error]} />
                                        </Field>
                                    )}
                                />

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <Controller
                                        name="cityState"
                                        control={visitorForm.control}
                                        render={({ field, fieldState }) => (
                                            <Field data-invalid={fieldState.invalid}>
                                                <FieldLabel htmlFor="visitor-city-state">Cidade / Estado (Opcional)</FieldLabel>
                                                <Input
                                                    {...field}
                                                    id="visitor-city-state"
                                                    value={field.value || ""}
                                                    aria-invalid={fieldState.invalid}
                                                    placeholder="Ex: Belo Horizonte / MG"
                                                    className="min-h-[44px]"
                                                />
                                                <FieldError errors={[fieldState.error]} />
                                            </Field>
                                        )}
                                    />

                                    <Controller
                                        name="emergencyContact"
                                        control={visitorForm.control}
                                        render={({ field, fieldState }) => (
                                            <Field data-invalid={fieldState.invalid}>
                                                <FieldLabel htmlFor="visitor-emergency">Contato de Emergência (Opcional)</FieldLabel>
                                                <Input
                                                    {...field}
                                                    id="visitor-emergency"
                                                    value={field.value || ""}
                                                    aria-invalid={fieldState.invalid}
                                                    placeholder="Ex: Maria (31) 99999-9999"
                                                    className="min-h-[44px]"
                                                />
                                                <FieldError errors={[fieldState.error]} />
                                            </Field>
                                        )}
                                    />
                                </div>

                                <Controller
                                    name="dietaryRestrictions"
                                    control={visitorForm.control}
                                    render={({ field, fieldState }) => (
                                        <Field data-invalid={fieldState.invalid}>
                                            <FieldLabel htmlFor="visitor-dietary">Restrições Alimentares ou Alergias (Opcional)</FieldLabel>
                                            <Textarea
                                                {...field}
                                                id="visitor-dietary"
                                                value={field.value || ""}
                                                aria-invalid={fieldState.invalid}
                                                placeholder="Ex: Alergia a lactose, intolerância a glúten, medicação contínua..."
                                                className="min-h-[84px]"
                                            />
                                            <FieldError errors={[fieldState.error]} />
                                        </Field>
                                    )}
                                />
                            </FieldGroup>

                            <FieldSeparator>Segurança</FieldSeparator>

                            <FieldGroup>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <Controller
                                        name="password"
                                        control={visitorForm.control}
                                        render={({ field, fieldState }) => (
                                            <Field data-invalid={fieldState.invalid}>
                                                <FieldLabel htmlFor="visitor-password">Senha*</FieldLabel>
                                                <InputGroup>
                                                    <InputGroupInput
                                                        {...field}
                                                        id="visitor-password"
                                                        type={showPassword ? "text" : "password"}
                                                        aria-invalid={fieldState.invalid}
                                                        placeholder="********"
                                                        className="min-h-[44px]"
                                                    />
                                                    <InputGroupAddon align="inline-end">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            type="button"
                                                            aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                                                            onClick={() => setShowPassword(!showPassword)}
                                                            className="min-h-[44px] min-w-[44px]"
                                                        >
                                                            {showPassword ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                                                        </Button>
                                                    </InputGroupAddon>
                                                </InputGroup>
                                                <FieldError errors={[fieldState.error]} />
                                            </Field>
                                        )}
                                    />

                                    <Controller
                                        name="confirmPassword"
                                        control={visitorForm.control}
                                        render={({ field, fieldState }) => (
                                            <Field data-invalid={fieldState.invalid}>
                                                <FieldLabel htmlFor="visitor-confirm-password">Confirmar Senha*</FieldLabel>
                                                <InputGroup>
                                                    <InputGroupInput
                                                        {...field}
                                                        id="visitor-confirm-password"
                                                        type={showConfirmPassword ? "text" : "password"}
                                                        aria-invalid={fieldState.invalid}
                                                        placeholder="********"
                                                        className="min-h-[44px]"
                                                    />
                                                    <InputGroupAddon align="inline-end">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            type="button"
                                                            aria-label={showConfirmPassword ? "Ocultar confirmação de senha" : "Mostrar confirmação de senha"}
                                                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                                            className="min-h-[44px] min-w-[44px]"
                                                        >
                                                            {showConfirmPassword ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                                                        </Button>
                                                    </InputGroupAddon>
                                                </InputGroup>
                                                <FieldError errors={[fieldState.error]} />
                                            </Field>
                                        )}
                                    />
                                </div>
                            </FieldGroup>
                        </form>
                    </CardContent>

                    <CardFooter className="flex flex-col gap-4">
                        <Button 
                            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground text-base font-semibold min-h-[48px] transition-all active:scale-[0.98]" 
                            type="submit" 
                            form="visitor-sign-up-form" 
                            disabled={submitting || visitorCpfNotice?.type === "linked"}
                        >
                            {submitting ? (
                                <>
                                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                    Criando sua conta...
                                </>
                            ) : "Criar Conta e Acessar"}
                        </Button>

                        <p className="text-center text-sm text-muted-foreground">
                            Já tem uma conta?{" "}
                            <Link
                                to={loginTarget}
                                className="inline-flex min-h-[44px] items-center text-primary hover:text-primary/80 font-medium transition-colors"
                            >
                                Faça login
                            </Link>
                        </p>
                    </CardFooter>
                </Card>
            ) : step === 'cpf_check' ? (
                <Card className="w-full max-w-md border-border bg-card/50 backdrop-blur-xl shadow-2xl relative z-10">
                    <CardHeader className="space-y-3 text-center">
                        <div className="flex items-center justify-between">
                            <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="min-h-[44px]">
                                <ArrowLeftIcon className="mr-2 h-4 w-4" />
                                Voltar
                            </Button>
                        </div>

                        {/* Seletor de Tipo de Cadastro */}
                        <AccountTypeSelector
                            selected={accountType}
                            onSelect={(t) => {
                                setAccountType(t);
                                setCpfError(null);
                                if (t === 'visitor') setCpfNotFound(false);
                            }}
                        />

                        <div>
                            <CardTitle className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                                Ativar Conta
                            </CardTitle>
                            <CardDescription className="text-muted-foreground text-xs sm:text-sm mt-1">
                                Insira seu CPF para localizar seu pré-cadastro na igreja
                            </CardDescription>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleVerifyCpf} className="space-y-4">
                            <div className="space-y-2">
                                <label htmlFor="cpf-verify" className="text-sm font-medium text-foreground">
                                    CPF*
                                </label>
                                <Input
                                    id="cpf-verify"
                                    type="text"
                                    value={verificationCpf}
                                    onChange={(e) => {
                                        const formatted = formatCPF(e.target.value);
                                        setVerificationCpf(formatted);
                                    }}
                                    placeholder="000.000.000-00"
                                    maxLength={14}
                                    className="h-10 text-lg min-h-[44px]"
                                    required
                                />
                                {cpfError && (
                                    <div className="space-y-2 mt-2">
                                        <p className="text-sm font-medium text-destructive">
                                            {cpfError}
                                        </p>
                                        {cpfNotFound && (
                                            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-left space-y-2">
                                                <div className="flex items-start gap-2">
                                                    <InfoIcon className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                                                    <p className="text-xs text-muted-foreground leading-relaxed">
                                                        Não encontrou seu pré-cadastro? Você pode criar uma conta de participante para acessar estudos e agilizar inscrições em retiros e encontros.
                                                    </p>
                                                </div>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => {
                                                        setAccountType('visitor');
                                                        setCpfError(null);
                                                        setCpfNotFound(false);
                                                    }}
                                                    className="w-full min-h-[44px] text-xs font-semibold gap-2 border-primary/40 text-primary hover:bg-primary/10"
                                                >
                                                    <BookOpenIcon className="h-3.5 w-3.5" />
                                                    Criar Conta de Retiros &amp; Estudos
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                            <Button 
                                type="submit" 
                                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground text-lg font-semibold h-12 transition-all active:scale-[0.98] mt-4 min-h-[44px]"
                                disabled={verifyingCpf}
                            >
                                {verifyingCpf ? (
                                    <>
                                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                        Verificando...
                                    </>
                                ) : (
                                    "Avançar"
                                )}
                            </Button>
                        </form>
                    </CardContent>
                    <CardFooter className="flex flex-col space-y-4">
                        <p className="text-center text-sm text-muted-foreground mt-2">
                            Já tem uma conta?{" "}
                            <Link
                                to="/entrar"
                                className="text-primary hover:text-primary/80 font-medium transition-colors"
                            >
                                Faça login
                            </Link>
                        </p>
                    </CardFooter>
                </Card>
            ) : (
                <Card className="w-full max-w-2xl border-border bg-card/50 backdrop-blur-xl shadow-2xl relative z-10">
                    <CardHeader className="space-y-1 text-center">
                        <div className="flex items-center justify-between">
                            <Button variant="ghost" onClick={() => setStep('cpf_check')}>
                                <ArrowLeftIcon className="mr-2 h-4 w-4" />
                                Alterar CPF
                            </Button>
                        </div>
                        <CardTitle className="text-3xl font-bold tracking-tight text-foreground">Cadastro</CardTitle>
                        <CardDescription className="text-muted-foreground">Preencha os dados abaixo para criar sua conta</CardDescription>
                    </CardHeader>
                <CardContent>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <form id="sign-up-form" onSubmit={signForm.handleSubmit(onSubmit as any)} className="space-y-6">
                        
                        {/* Seção: Avatar */}
                        <div className="flex flex-col items-center gap-4 mb-6">
                            <div className="relative h-24 w-24 group">
                                <div 
                                    className="relative h-full w-full rounded-full border-2 border-dashed border-muted-foreground flex items-center justify-center bg-muted overflow-hidden cursor-pointer shadow-inner" 
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    {avatarPreview ? (
                                        <img src={avatarPreview} alt="Preview" className="h-full w-full object-cover" />
                                    ) : (
                                        <UserIcon className="h-12 w-12 text-muted-foreground" />
                                    )}
                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                        <UploadIcon className="h-6 w-6 text-white" />
                                    </div>
                                </div>
                                {avatarPreview && (
                                    <button 
                                        type="button" 
                                        onClick={clearAvatar}
                                        className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-2 shadow-lg transition-colors z-20 min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
                                    >
                                        <XIcon className="h-3 w-3" />
                                    </button>
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground">Toque na imagem para carregar sua foto</p>
                        </div>

                        <FieldGroup className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Controller
                                name="fullName"
                                control={signForm.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel>Nome Completo*</FieldLabel>
                                        <Input {...field} placeholder="Seu Nome Completo" />
                                        <FieldError errors={[fieldState.error]} />
                                    </Field>
                                )}
                            />

                            <Controller
                                name="email"
                                control={signForm.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel>Email*</FieldLabel>
                                        <Input {...field} type="email" placeholder="seu@email.com" />
                                        <FieldError errors={[fieldState.error]} />
                                    </Field>
                                )}
                            />

                            <Controller
                                name="phone"
                                control={signForm.control}
                                render={({ field: { onChange, value, ...fieldProps }, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel>Telefone* (+55 31 9XXXX-XXXX)</FieldLabel>
                                        <Input
                                            {...fieldProps}
                                            value={value || ""}
                                            onChange={(e) => {
                                                const cursor = e.target.selectionStart;
                                                const formatted = formatPhone(e.target.value);
                                                onChange(formatted);
                                                
                                                // Pequeno timeout para restaurar a posição do cursor após o render do React
                                                setTimeout(() => {
                                                    if (e.target && cursor !== null) {
                                                        // Se o novo valor for maior (ex: adicionou parênteses), o cursor pode precisar andar
                                                        const diff = formatted.length - e.target.value.length;
                                                        e.target.setSelectionRange(cursor + diff, cursor + diff);
                                                    }
                                                }, 0);
                                            }}
                                            placeholder="+55 (31) 99999-9999"
                                            maxLength={20}
                                        />
                                        <FieldError errors={[fieldState.error]} />
                                    </Field>
                                )}
                            />

                            <Controller
                                name="cpf"
                                control={signForm.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel>CPF*</FieldLabel>
                                        <Input {...field} placeholder="000.000.000-00" readOnly className="bg-muted cursor-not-allowed opacity-80" />
                                        <FieldError errors={[fieldState.error]} />
                                    </Field>
                                )}
                            />

                            <Controller
                                name="birthDate"
                                control={signForm.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel>Data de Nascimento*</FieldLabel>
                                        <Input {...field} type="date" />
                                        <FieldError errors={[fieldState.error]} />
                                    </Field>
                                )}
                            />

                            <Controller
                                name="baptismDate"
                                control={signForm.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel>Data de Batismo*</FieldLabel>
                                        <Input {...field} type="date" value={field.value || ""} />
                                        <FieldError errors={[fieldState.error]} />
                                    </Field>
                                )}
                            />


                            <Controller
                                name="gender"
                                control={signForm.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel>Gênero*</FieldLabel>
                                        <CardSelector 
                                            value={field.value} 
                                            onValueChange={field.onChange}
                                            columns={2}
                                            className="mt-2"
                                        >
                                            <CardSelectorItem value="masculino" label="Masculino" />
                                            <CardSelectorItem value="feminino" label="Feminino" />
                                        </CardSelector>
                                        <FieldError errors={[fieldState.error]} />
                                    </Field>
                                )}
                            />
                            <Controller
                                name="maritalStatus"
                                control={signForm.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel>Estado Civil*</FieldLabel>
                                        <CardSelector 
                                            value={field.value} 
                                            onValueChange={field.onChange}
                                            columns={2}
                                            className="mt-2"
                                        >
                                            <CardSelectorItem value="solteiro" label="Solteiro" />
                                            <CardSelectorItem value="casado" label="Casado" />
                                            <CardSelectorItem value="divorciado" label="Divorciado" />
                                            <CardSelectorItem value="viuvo" label="Viúvo" />
                                        </CardSelector>
                                        <FieldError errors={[fieldState.error]} />
                                    </Field>
                                )}
                            />
                        </FieldGroup>

                        <FieldSeparator>Endereço*</FieldSeparator>

                        <FieldGroup className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <Controller
                                name="addressZipCode"
                                control={signForm.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel>CEP*</FieldLabel>
                                        <InputGroup>
                                            <InputGroupInput {...field} placeholder="00000-000" />
                                            <InputGroupAddon align="inline-end">
                                                {searchingCep ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <SearchIcon className="h-4 w-4 text-muted-foreground" />}
                                            </InputGroupAddon>
                                        </InputGroup>
                                        <FieldError errors={[fieldState.error]} />
                                    </Field>
                                )}
                            />
                            <div className="md:col-span-2">
                                <Controller
                                    name="addressStreet"
                                    control={signForm.control}
                                    render={({ field, fieldState }) => (
                                        <Field data-invalid={fieldState.invalid}>
                                            <FieldLabel>Rua*</FieldLabel>
                                            <Input {...field} placeholder="Rua / Avenida" />
                                            <FieldError errors={[fieldState.error]} />
                                        </Field>
                                    )}
                                />
                            </div>
                            <Controller
                                name="addressNumber"
                                control={signForm.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel>Número*</FieldLabel>
                                        <Input {...field} placeholder="123" />
                                        <FieldError errors={[fieldState.error]} />
                                    </Field>
                                )}
                            />
                            <Controller
                                name="addressNeighborhood"
                                control={signForm.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel>Bairro*</FieldLabel>
                                        <Input {...field} placeholder="Centro" />
                                        <FieldError errors={[fieldState.error]} />
                                    </Field>
                                )}
                            />
                            <Controller
                                name="addressCity"
                                control={signForm.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel>Cidade*</FieldLabel>
                                        <Input {...field} />
                                        <FieldError errors={[fieldState.error]} />
                                    </Field>
                                )}
                            />
                            <Controller
                                name="addressState"
                                control={signForm.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel>Estado*</FieldLabel>
                                        <Input {...field} maxLength={2} placeholder="UF" />
                                        <FieldError errors={[fieldState.error]} />
                                    </Field>
                                )}
                            />
                            <div className="md:col-span-2">
                                <Controller
                                    name="addressComplement"
                                    control={signForm.control}
                                    render={({ field, fieldState }) => (
                                        <Field data-invalid={fieldState.invalid}>
                                            <FieldLabel>Complemento (Opcional)</FieldLabel>
                                            <Input {...field} placeholder="Apto, Bloco, etc" />
                                            <FieldError errors={[fieldState.error]} />
                                        </Field>
                                    )}
                                />
                            </div>
                        </FieldGroup>

                        <FieldSeparator>Informações Socioeconômicas*</FieldSeparator>

                        <FieldGroup className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Controller
                                name="occupation"
                                control={signForm.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel>Profissão*</FieldLabel>
                                        <Input {...field} placeholder="Sua Profissão" />
                                        <FieldError errors={[fieldState.error]} />
                                    </Field>
                                )}
                            />

                            <Controller
                                name="dependentsCount"
                                control={signForm.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel>Nº de Dependentes*</FieldLabel>
                                        <Input {...field} type="number" min="0" />
                                        <FieldError errors={[fieldState.error]} />
                                    </Field>
                                )}
                            />

                            <Controller
                                name="educationLevel"
                                control={signForm.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel>Escolaridade*</FieldLabel>
                                        <CardSelector 
                                            value={field.value} 
                                            onValueChange={field.onChange}
                                            columns={1}
                                            className="mt-2"
                                        >
                                            {["Fundamental Incompleto", "Fundamental Completo", "Médio Incompleto", "Médio Completo", "Superior Incompleto", "Superior Completo", "Pós-graduação"].map((opt) => (
                                                <CardSelectorItem key={opt} value={opt} label={opt} />
                                            ))}
                                        </CardSelector>
                                        <FieldError errors={[fieldState.error]} />
                                    </Field>
                                )}
                            />

                            <Controller
                                name="employmentStatus"
                                control={signForm.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel>Vínculo Empregatício*</FieldLabel>
                                        <CardSelector 
                                            value={field.value} 
                                            onValueChange={field.onChange}
                                            columns={1}
                                            className="mt-2 sm:grid-cols-2"
                                        >
                                            {["CLT", "Autônomo/PJ", "Desempregado", "Aposentado", "Estudante", "Empreendedor"].map((opt) => (
                                                <CardSelectorItem key={opt} value={opt} label={opt} />
                                            ))}
                                        </CardSelector>
                                        <FieldError errors={[fieldState.error]} />
                                    </Field>
                                )}
                            />

                            <Controller
                                name="householdIncome"
                                control={signForm.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel>Renda Familiar*</FieldLabel>
                                        <CardSelector 
                                            value={field.value} 
                                            onValueChange={field.onChange}
                                            columns={1}
                                            className="mt-2 sm:grid-cols-2"
                                        >
                                            {["Até 1 SM", "1 a 3 SM", "3 a 5 SM", "Acima de 5 SM", "Prefiro não informar"].map((opt) => (
                                                <CardSelectorItem key={opt} value={opt} label={opt} />
                                            ))}
                                        </CardSelector>
                                        <FieldError errors={[fieldState.error]} />
                                    </Field>
                                )}
                            />

                            <Controller
                                name="housingStatus"
                                control={signForm.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel>Situação de Moradia*</FieldLabel>
                                        <CardSelector 
                                            value={field.value} 
                                            onValueChange={field.onChange}
                                            columns={1}
                                            className="mt-2 sm:grid-cols-2"
                                        >
                                            {["Própria", "Alugada", "Cedida/Parentes", "Financiada"].map((opt) => (
                                                <CardSelectorItem key={opt} value={opt} label={opt} />
                                            ))}
                                        </CardSelector>
                                        <FieldError errors={[fieldState.error]} />
                                    </Field>
                                )}
                            />

                            <Controller
                                name="driversLicense"
                                control={signForm.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel>CNH*</FieldLabel>
                                        <CardSelector 
                                            value={field.value} 
                                            onValueChange={field.onChange}
                                            columns={2}
                                            className="mt-2 sm:grid-cols-4"
                                        >
                                            {["Não possui", "A", "B", "AB", "C", "D", "E"].map((opt) => (
                                                <CardSelectorItem key={opt} value={opt} label={opt} />
                                            ))}
                                        </CardSelector>
                                        <FieldError errors={[fieldState.error]} />
                                    </Field>
                                )}
                            />
                        </FieldGroup>

                        <FieldSeparator>Segurança</FieldSeparator>

                        <FieldGroup className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Controller
                                name="password"
                                control={signForm.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel>Senha*</FieldLabel>
                                        <InputGroup>
                                            <InputGroupInput
                                                {...field}
                                                type={showPassword ? "text" : "password"}
                                                placeholder="********"
                                            />
                                            <InputGroupAddon align="inline-end">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    type="button"
                                                    onClick={() => setShowPassword(!showPassword)}
                                                >
                                                    {showPassword ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                                                </Button>
                                            </InputGroupAddon>
                                        </InputGroup>
                                        <FieldError errors={[fieldState.error]} />
                                    </Field>
                                )}
                            />
                            <Controller
                                name="confirmPassword"
                                control={signForm.control}
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid}>
                                        <FieldLabel>Confirmar Senha*</FieldLabel>
                                        <InputGroup>
                                            <InputGroupInput
                                                {...field}
                                                type={showConfirmPassword ? "text" : "password"}
                                                placeholder="********"
                                            />
                                            <InputGroupAddon align="inline-end">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    type="button"
                                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                                >
                                                    {showConfirmPassword ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                                                </Button>
                                            </InputGroupAddon>
                                        </InputGroup>
                                        <FieldError errors={[fieldState.error]} />
                                    </Field>
                                )}
                            />
                        </FieldGroup>

                    </form>
                </CardContent>
                <CardFooter className="flex flex-col space-y-4">
                    <Button 
                        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground text-lg font-semibold h-12 transition-all active:scale-[0.98]" 
                        type="submit" 
                        form="sign-up-form" 
                        disabled={submitting}
                    >
                        {submitting ? (
                            <>
                                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                Processando...
                            </>
                        ) : "Confirmar Cadastro"}
                    </Button>

                    <p className="text-center text-sm text-muted-foreground mt-2">
                        Já tem uma conta?{" "}
                        <Link
                            to="/entrar"
                            className="text-primary hover:text-primary/80 font-medium transition-colors"
                        >
                            Faça login
                        </Link>
                    </p>
                </CardFooter>
            </Card>
            )}

            <Dialog open={isCropping} onOpenChange={setIsCropping}>
                <DialogContent size="lg">
                    <DialogHeader>
                        <DialogTitle>Ajustar Foto</DialogTitle>
                        <DialogDescription>
                            Arraste e aproxime para escolher o melhor enquadramento para seu perfil.
                        </DialogDescription>
                    </DialogHeader>
                    {avatarPreview && (
                        <div className="py-4">
                            <ImageCropper 
                                image={avatarPreview} 
                                onCropComplete={handleCropComplete}
                                onCancel={() => setIsCropping(false)}
                            />
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}

function FieldSeparator({ children }: { children: React.ReactNode }) {
    return (
        <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground font-semibold">
                    {children}
                </span>
            </div>
        </div>
    )
}
