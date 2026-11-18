import { useState, useEffect, useMemo } from "react"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Separator } from "@/components/ui/separator"
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select"
import {
  getHomeGroupDisplayName,
  getHomeGroupFullLabel,
  getHomeGroupSearchKeywords,
} from "@/lib/homeGroupUtils"
import { formatCPF, isValidCPF } from "@/lib/cpfUtils"
import { formatPhone, isValidBrazilianPhone } from "@/lib/phoneUtils"
import {
  Trash2,
  X,
  Loader2,
  Check,
  RotateCcw,
} from "lucide-react"
import { toast } from "sonner"
import supabase from "@/lib/supabase"
import type { Database } from "@/lib/database.types"

type Profile = Database["public"]["Tables"]["profiles"]["Row"]
type HomeGroup = Database["public"]["Tables"]["home_groups"]["Row"]
type Fellowship = Database["public"]["Tables"]["fellowships"]["Row"]

export interface DiscipleEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  disciple: Profile | null
  homeGroups: HomeGroup[]
  allProfiles: Profile[]
  fellowships: Fellowship[]
  defaultHomeGroupId?: string | null
  isTier3: boolean
  initialTransformToBaptized?: boolean
  initialTransformToLinked?: boolean
  lockGroupSelectionOnCreate?: boolean
  onSuccess: () => void
}

const checkIsChild = (p: Profile) => {
  if (p.is_baptized) return false
  if (p.discipler_id || p.spouse_id || p.is_presbyter || p.is_deacon || p.is_dev) return false
  return !p.baptism_date && !!(p.father_id || p.mother_id)
}

const normalizeGender = (val?: string | null): "M" | "F" | "" => {
  if (!val) return ""
  const upper = val.toUpperCase().trim()
  if (upper === "F" || upper === "FEMININO" || upper === "MULHER") return "F"
  if (upper === "M" || upper === "MASCULINO" || upper === "HOMEM") return "M"
  return ""
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function buildParentOptions(params: {
  allProfiles: Profile[]
  discipleId?: string
  activeGroupId: string
  targetGender: "M" | "F"
  selectedId: string
  emptyLabel: string
}): SearchableSelectOption[] {
  const { allProfiles, discipleId, activeGroupId, targetGender, selectedId, emptyLabel } = params
  return [
    { value: "none", label: emptyLabel },
    ...allProfiles
      .filter((p) => {
        if (p.id === discipleId) return false
        if (p.id === selectedId) return true
        if (checkIsChild(p)) return false
        if (normalizeGender(p.gender) !== targetGender) return false
        if (activeGroupId && p.home_group_id !== activeGroupId) return false
        return true
      })
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR"))
      .map((p) => ({
        value: p.id,
        label: p.full_name,
        description: p.phone ? formatPhone(p.phone) : undefined,
        keywords: p.phone || "",
      })),
  ]
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object") {
    const record = err as { code?: unknown; message?: unknown }
    if (record.code === "23505" && typeof record.message === "string") {
      if (record.message.includes("profiles_email_key")) {
        return "Este e-mail já está cadastrado para outro irmão."
      }
      if (record.message.includes("profiles_cpf_key")) {
        return "Este CPF já está cadastrado para outro irmão."
      }
      return "Registro duplicado no sistema."
    }
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message
    }
  }
  if (err instanceof Error && err.message) {
    return err.message
  }
  return fallback
}

export function DiscipleEditorDialog({
  open,
  onOpenChange,
  disciple,
  homeGroups,
  allProfiles,
  fellowships,
  defaultHomeGroupId,
  initialTransformToBaptized = false,
  initialTransformToLinked = false,
  lockGroupSelectionOnCreate = false,
  onSuccess,
}: DiscipleEditorDialogProps) {
  const isEditing = !!disciple
  const isTransformingLinked = Boolean(
    initialTransformToLinked || (disciple && disciple.is_church_linked === false)
  )

  const [isChild, setIsChild] = useState<boolean>(false)

  // Campos principais
  const [fullName, setFullName] = useState<string>("")
  const [gender, setGender] = useState<"M" | "F" | "">("")
  const [phone, setPhone] = useState<string>("")
  const [homeGroupId, setHomeGroupId] = useState<string>("")
  const [disciplerId, setDisciplerId] = useState<string>("none")
  const [customDisciplerName, setCustomDisciplerName] = useState<string>("")
  const [isMarried, setIsMarried] = useState<boolean>(false)
  const [spouseId, setSpouseId] = useState<string>("none")
  const [parentsInChurch, setParentsInChurch] = useState<boolean>(false)
  const [fatherId, setFatherId] = useState<string>("none")
  const [motherId, setMotherId] = useState<string>("none")
  const [selectedFellowships, setSelectedFellowships] = useState<string[]>([])
  const [isGroupNucleus, setIsGroupNucleus] = useState<boolean>(false)

  // Campos opcionais
  const [email, setEmail] = useState<string>("")
  const [birthDate, setBirthDate] = useState<string>("")
  const [baptismDate, setBaptismDate] = useState<string>("")
  const [cpf, setCpf] = useState<string>("")

  // Controle de salvamento/exclusão
  const [saving, setSaving] = useState<boolean>(false)
  const [deleting, setDeleting] = useState<boolean>(false)
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false)

  useEffect(() => {
    if (!open) return

    if (disciple) {
      const childProfile = checkIsChild(disciple)
      const shouldTransform = Boolean(initialTransformToBaptized && childProfile)
      const nextIsChild = shouldTransform ? false : childProfile
      const married =
        Boolean(disciple.spouse_id) ||
        Boolean(disciple.marital_status?.toLowerCase().includes("casad"))
      const hasParents = Boolean(disciple.father_id || disciple.mother_id)

      setIsChild(nextIsChild)
      setFullName(disciple.full_name || "")
      setGender(normalizeGender(disciple.gender))
      setPhone(disciple.phone ? formatPhone(disciple.phone) : "")
      setHomeGroupId(disciple.home_group_id || defaultHomeGroupId || "")
      setDisciplerId(disciple.discipler_id || "none")
      setCustomDisciplerName(disciple.custom_discipler_name || "")
      setIsMarried(married)
      setSpouseId(disciple.spouse_id || "none")
      setParentsInChurch(!married && hasParents)
      setFatherId(disciple.father_id || "none")
      setMotherId(disciple.mother_id || "none")
      setIsGroupNucleus(Boolean(disciple.is_group_nucleus))

      setEmail(disciple.email || "")
      setBirthDate(disciple.birth_date || "")
      setBaptismDate(
        shouldTransform
          ? disciple.baptism_date || new Date().toISOString().split("T")[0]
          : disciple.baptism_date || ""
      )
      setCpf(disciple.cpf ? formatCPF(disciple.cpf) : "")

      const currentCompanions = fellowships
        .filter((f) => f.member_a_id === disciple.id || f.member_b_id === disciple.id)
        .map((f) => (f.member_a_id === disciple.id ? f.member_b_id : f.member_a_id))
      setSelectedFellowships(currentCompanions)
    } else {
      setIsChild(false)
      setFullName("")
      setGender("")
      setPhone("")
      setHomeGroupId(defaultHomeGroupId || (homeGroups[0]?.id ?? ""))
      setDisciplerId("none")
      setCustomDisciplerName("")
      setIsMarried(false)
      setSpouseId("none")
      setParentsInChurch(false)
      setFatherId("none")
      setMotherId("none")
      setSelectedFellowships([])
      setIsGroupNucleus(false)

      setEmail("")
      setBirthDate("")
      setBaptismDate("")
      setCpf("")
    }

    setConfirmDelete(false)
  }, [
    open,
    disciple,
    defaultHomeGroupId,
    homeGroups,
    fellowships,
    initialTransformToBaptized,
  ])

  const profileMap = useMemo(() => {
    const map = new Map<string, Profile>()
    allProfiles.forEach((p) => map.set(p.id, p))
    return map
  }, [allProfiles])

  const homeGroupMap = useMemo(() => {
    const map = new Map<string, HomeGroup>()
    homeGroups.forEach((hg) => map.set(hg.id, hg))
    return map
  }, [homeGroups])

  const leaderIds = useMemo(() => {
    const set = new Set<string>()
    homeGroups.forEach((g) => {
      if (g.leader_1_id) set.add(g.leader_1_id)
      if (g.leader_2_id) set.add(g.leader_2_id)
    })
    return set
  }, [homeGroups])

  const handleGenderChange = (newGender: "M" | "F") => {
    setGender(newGender)

    if (disciplerId !== "none") {
      const dProf = profileMap.get(disciplerId)
      if (dProf?.gender && normalizeGender(dProf.gender) !== newGender) {
        setDisciplerId("none")
      }
    }

    if (spouseId !== "none") {
      const sProf = profileMap.get(spouseId)
      if (sProf?.gender && normalizeGender(sProf.gender) === newGender) {
        setSpouseId("none")
      }
    }

    if (selectedFellowships.length > 0) {
      const validFellowships = selectedFellowships.filter((fid) => {
        const fProf = profileMap.get(fid)
        return !fProf?.gender || normalizeGender(fProf.gender) === newGender
      })
      if (validFellowships.length !== selectedFellowships.length) {
        setSelectedFellowships(validFellowships)
      }
    }
  }

  const handleMarriedChange = (married: boolean) => {
    setIsMarried(married)
    if (married) {
      setParentsInChurch(false)
    } else {
      setSpouseId("none")
      setParentsInChurch(fatherId !== "none" || motherId !== "none")
    }
  }

  const handleParentsInChurchChange = (inChurch: boolean) => {
    setParentsInChurch(inChurch)
    if (!inChurch) {
      setFatherId("none")
      setMotherId("none")
    }
  }

  const activeGroupId = homeGroupId || disciple?.home_group_id || defaultHomeGroupId || ""

  const findSpouseForParent = (parentId: string, expectedGender: "M" | "F"): Profile | undefined => {
    const parent = profileMap.get(parentId)
    const spouse =
      (parent?.spouse_id ? profileMap.get(parent.spouse_id) : undefined) ||
      allProfiles.find((p) => p.spouse_id === parentId)

    if (!spouse || spouse.id === disciple?.id) return undefined
    if (activeGroupId && spouse.home_group_id !== activeGroupId) return undefined
    const spouseGender = normalizeGender(spouse.gender)
    if (spouseGender && spouseGender !== expectedGender) return undefined
    return spouse
  }

  const handleFatherChange = (newFatherId: string) => {
    const val = newFatherId || "none"
    setFatherId(val)
    if (val !== "none") {
      const wife = findSpouseForParent(val, "F")
      if (wife) {
        setMotherId(wife.id)
      }
    }
  }

  const handleMotherChange = (newMotherId: string) => {
    const val = newMotherId || "none"
    setMotherId(val)
    if (val !== "none") {
      const husband = findSpouseForParent(val, "M")
      if (husband) {
        setFatherId(husband.id)
      }
    }
  }

  const handleRegisterBaptism = () => {
    setIsChild(false)
    if (!baptismDate) {
      setBaptismDate(new Date().toISOString().split("T")[0])
    }
    if (!homeGroupId) {
      const fatherGroup = fatherId !== "none" ? profileMap.get(fatherId)?.home_group_id : null
      const motherGroup = motherId !== "none" ? profileMap.get(motherId)?.home_group_id : null
      setHomeGroupId(
        fatherGroup || motherGroup || defaultHomeGroupId || homeGroups[0]?.id || ""
      )
    }
  }

  const availableDisciplers = useMemo(() => {
    return allProfiles
      .filter((p) => {
        if (p.id === disciple?.id) return false
        if (p.id === disciplerId) return true
        if (checkIsChild(p)) return false
        return gender ? normalizeGender(p.gender) === gender : true
      })
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR"))
  }, [allProfiles, disciple?.id, disciplerId, gender])

  const availableSpouses = useMemo(() => {
    const oppositeGender = gender === "M" ? "F" : gender === "F" ? "M" : ""
    return allProfiles
      .filter((p) => {
        if (p.id === disciple?.id) return false
        if (p.id === spouseId) return true
        if (checkIsChild(p)) return false
        return oppositeGender ? normalizeGender(p.gender) === oppositeGender : true
      })
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR"))
  }, [allProfiles, disciple?.id, spouseId, gender])

  const availableCompanions = useMemo(() => {
    return allProfiles
      .filter(
        (p) =>
          p.id !== disciple?.id &&
          !selectedFellowships.includes(p.id) &&
          !checkIsChild(p) &&
          (gender ? normalizeGender(p.gender) === gender : true)
      )
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR"))
  }, [allProfiles, disciple?.id, selectedFellowships, gender])

  const homeGroupOptions = useMemo<SearchableSelectOption[]>(() => {
    return homeGroups.map((hg) => {
      const displayName = getHomeGroupDisplayName(hg, profileMap)
      const loc = hg.location_text ? hg.location_text.split("-")[0].trim() : ""
      return {
        value: hg.id,
        label: displayName,
        description: loc || undefined,
        keywords: getHomeGroupSearchKeywords(hg, profileMap),
      }
    })
  }, [homeGroups, profileMap])

  const disciplerOptions = useMemo<SearchableSelectOption[]>(() => {
    const list: SearchableSelectOption[] = [
      { value: "none", label: "Nenhum", keywords: "nenhum sem discipulador" },
    ]

    if (customDisciplerName.trim() && disciplerId === "none") {
      list.push({
        value: `custom:${customDisciplerName.trim()}`,
        label: customDisciplerName.trim(),
        badge: "Não cadastrado",
        keywords: customDisciplerName.trim(),
      })
    }

    list.push(
      ...availableDisciplers.map((p) => {
        const hg = p.home_group_id ? homeGroupMap.get(p.home_group_id) : undefined
        const hgLabel = hg ? getHomeGroupFullLabel(hg, profileMap) : undefined
        return {
          value: p.id,
          label: p.full_name,
          description: hgLabel,
          badge: p.is_presbyter ? "Presbítero" : leaderIds.has(p.id) ? "Líder" : undefined,
        }
      })
    )

    return list
  }, [availableDisciplers, leaderIds, homeGroupMap, profileMap, customDisciplerName, disciplerId])

  const handleDisciplerChange = (val: string) => {
    if (val.startsWith("custom:")) {
      const name = val.replace(/^custom:/, "").trim()
      setDisciplerId("none")
      setCustomDisciplerName(name)
    } else if (val === "none" || !val) {
      setDisciplerId("none")
      setCustomDisciplerName("")
    } else {
      setDisciplerId(val)
      setCustomDisciplerName("")
    }
  }

  const spouseOptions = useMemo<SearchableSelectOption[]>(() => {
    return [
      { value: "none", label: "Não cadastrado" },
      ...availableSpouses.map((p) => ({
        value: p.id,
        label: p.full_name,
        description: p.phone ? formatPhone(p.phone) : undefined,
        keywords: p.phone || "",
      })),
    ]
  }, [availableSpouses])

  const companionOptions = useMemo<SearchableSelectOption[]>(() => {
    return availableCompanions.map((p) => ({
      value: p.id,
      label: p.full_name,
      description: p.phone ? formatPhone(p.phone) : undefined,
      keywords: p.phone || "",
    }))
  }, [availableCompanions])

  const fatherOptions = useMemo<SearchableSelectOption[]>(
    () =>
      buildParentOptions({
        allProfiles,
        discipleId: disciple?.id,
        activeGroupId,
        targetGender: "M",
        selectedId: fatherId,
        emptyLabel: "Não informado",
      }),
    [allProfiles, disciple?.id, fatherId, activeGroupId]
  )

  const motherOptions = useMemo<SearchableSelectOption[]>(
    () =>
      buildParentOptions({
        allProfiles,
        discipleId: disciple?.id,
        activeGroupId,
        targetGender: "F",
        selectedId: motherId,
        emptyLabel: "Não informada",
      }),
    [allProfiles, disciple?.id, motherId, activeGroupId]
  )

  const handleSelectCompanion = (id: string) => {
    if (id && id !== "none" && !selectedFellowships.includes(id)) {
      setSelectedFellowships((prev) => [...prev, id])
    }
  }

  const handleRemoveCompanion = (idToRemove: string) => {
    setSelectedFellowships((prev) => prev.filter((id) => id !== idToRemove))
  }

  const handleSave = async () => {
    if (!fullName.trim()) {
      toast.error("Informe o nome.")
      return
    }

    if (!gender) {
      toast.error("Selecione o sexo.")
      return
    }

    if (isChild) {
      if (fatherId === "none" && motherId === "none") {
        toast.error("Selecione o pai ou a mãe.")
        return
      }

      const fatherGroup = fatherId !== "none" ? profileMap.get(fatherId)?.home_group_id : null
      const motherGroup = motherId !== "none" ? profileMap.get(motherId)?.home_group_id : null
      const resolvedGroupId =
        fatherGroup ||
        motherGroup ||
        disciple?.home_group_id ||
        homeGroupId ||
        defaultHomeGroupId ||
        homeGroups[0]?.id ||
        null

      setSaving(true)
      try {
        const childPayload = {
          full_name: fullName.trim(),
          gender,
          home_group_id: resolvedGroupId,
          father_id: fatherId !== "none" ? fatherId : null,
          mother_id: motherId !== "none" ? motherId : null,
          discipler_id: null,
          custom_discipler_name: null,
          spouse_id: null,
          marital_status: "solteiro",
          is_baptized: false,
          baptism_date: null,
          is_group_nucleus: false,
          is_church_linked: isTransformingLinked ? true : disciple ? disciple.is_church_linked : true,
        }

        if (isEditing && disciple) {
          const { error: updateError } = await supabase
            .from("profiles")
            .update(childPayload)
            .eq("id", disciple.id)
          if (updateError) throw updateError

          if (disciple.spouse_id) {
            await supabase
              .from("profiles")
              .update({ spouse_id: null })
              .eq("id", disciple.spouse_id)
          }
        } else {
          const { error: insertError } = await supabase
            .from("profiles")
            .insert({
              ...childPayload,
              user_id: null,
            })
          if (insertError) throw insertError
        }

        toast.success(isEditing ? "Cadastro atualizado." : "Cadastro criado.")
        onSuccess()
        onOpenChange(false)
      } catch (err: unknown) {
        console.error("Erro ao salvar criança:", err)
        toast.error(`Não foi possível salvar: ${extractErrorMessage(err, "Erro desconhecido ao salvar.")}`)
      } finally {
        setSaving(false)
      }
      return
    }

    const cleanEmail = email.trim().toLowerCase() || null
    const cleanPhone = phone.replace(/\D/g, "") || null
    const cleanCPF = cpf.replace(/\D/g, "") || null
    const cleanBirth = birthDate.trim() || null
    const cleanBaptism = baptismDate.trim() || null

    if (!cleanPhone) {
      toast.error("Informe o telefone.")
      return
    }

    if (!isValidBrazilianPhone(phone)) {
      toast.error("Informe um telefone válido com DDD.")
      return
    }

    if (!homeGroupId) {
      toast.error("Selecione o grupo caseiro.")
      return
    }

    if (!isMarried && parentsInChurch && fatherId === "none" && motherId === "none") {
      toast.error("Selecione o pai ou a mãe.")
      return
    }

    if (cleanEmail) {
      if (!EMAIL_REGEX.test(cleanEmail)) {
        toast.error("Informe um e-mail válido.")
        return
      }
      const duplicateEmail = allProfiles.find(
        (p) => p.id !== disciple?.id && p.email?.trim().toLowerCase() === cleanEmail
      )
      if (duplicateEmail) {
        toast.error(`Este e-mail já está cadastrado para ${duplicateEmail.full_name}.`)
        return
      }
    }

    if (cleanBaptism && cleanBirth && cleanBaptism < cleanBirth) {
      toast.error("A data de batismo não pode ser anterior à data de nascimento.")
      return
    }

    if (cleanCPF) {
      const previousCpf = disciple?.cpf?.replace(/\D/g, "") || ""
      if (cleanCPF.length !== 11 || (cleanCPF !== previousCpf && !isValidCPF(cleanCPF))) {
        toast.error("Informe um CPF válido.")
        return
      }
      const duplicateCpf = allProfiles.find(
        (p) => p.id !== disciple?.id && p.cpf?.replace(/\D/g, "") === cleanCPF
      )
      if (duplicateCpf) {
        toast.error(`Este CPF já está cadastrado para ${duplicateCpf.full_name}.`)
        return
      }
    }

    setSaving(true)
    let profileSaved = false
    try {
      const isRegisteredDiscipler = disciplerId !== "none"
      const finalCustomDiscipler =
        !isRegisteredDiscipler && customDisciplerName.trim()
          ? customDisciplerName.trim()
          : null

      const nextSpouseId = isMarried && spouseId !== "none" ? spouseId : null
      const nextMaritalStatus = isMarried
        ? "casado"
        : disciple?.marital_status === "casado"
        ? "solteiro"
        : disciple?.marital_status || "solteiro"

      const nextFatherId = isMarried
        ? disciple?.father_id || null
        : parentsInChurch && fatherId !== "none"
        ? fatherId
        : null

      const nextMotherId = isMarried
        ? disciple?.mother_id || null
        : parentsInChurch && motherId !== "none"
        ? motherId
        : null

      const profilePayload = {
        full_name: fullName.trim(),
        gender,
        phone: cleanPhone,
        home_group_id: homeGroupId,
        discipler_id: isRegisteredDiscipler ? disciplerId : null,
        custom_discipler_name: finalCustomDiscipler,
        spouse_id: nextSpouseId,
        marital_status: nextMaritalStatus,
        father_id: nextFatherId,
        mother_id: nextMotherId,
        is_group_nucleus: isGroupNucleus,
        email: cleanEmail,
        birth_date: cleanBirth,
        is_baptized: true,
        baptism_date: cleanBaptism,
        cpf: cleanCPF,
        is_church_linked: isTransformingLinked ? true : disciple ? disciple.is_church_linked : true,
      }

      let savedProfileId = disciple?.id

      if (isEditing && disciple) {
        const { error: updateError } = await supabase
          .from("profiles")
          .update(profilePayload)
          .eq("id", disciple.id)

        if (updateError) throw updateError
        profileSaved = true

        if (disciple.spouse_id && disciple.spouse_id !== profilePayload.spouse_id) {
          await supabase
            .from("profiles")
            .update({ spouse_id: null })
            .eq("id", disciple.spouse_id)
        }
        if (profilePayload.spouse_id) {
          await supabase
            .from("profiles")
            .update({ spouse_id: disciple.id, marital_status: "casado" })
            .eq("id", profilePayload.spouse_id)
        }
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from("profiles")
          .insert({
            ...profilePayload,
            user_id: null,
          })
          .select("id")
          .single()

        if (insertError) throw insertError
        profileSaved = true
        savedProfileId = inserted.id

        if (profilePayload.spouse_id && savedProfileId) {
          await supabase
            .from("profiles")
            .update({ spouse_id: savedProfileId, marital_status: "casado" })
            .eq("id", profilePayload.spouse_id)
        }
      }

      if (savedProfileId) {
        const existingFellowships = fellowships.filter(
          (f) => f.member_a_id === savedProfileId || f.member_b_id === savedProfileId
        )

        const toDelete = existingFellowships.filter((f) => {
          const otherId =
            f.member_a_id === savedProfileId ? f.member_b_id : f.member_a_id
          return !selectedFellowships.includes(otherId)
        })

        for (const f of toDelete) {
          const { error: delErr } = await supabase
            .from("fellowships")
            .delete()
            .match({ member_a_id: f.member_a_id, member_b_id: f.member_b_id })
          if (delErr) throw delErr
        }

        const existingOtherIds = existingFellowships.map((f) =>
          f.member_a_id === savedProfileId ? f.member_b_id : f.member_a_id
        )
        const toAdd = selectedFellowships.filter(
          (id) => !existingOtherIds.includes(id)
        )

        if (toAdd.length > 0) {
          const insertRows = toAdd.map((otherId) => ({
            member_a_id: savedProfileId!,
            member_b_id: otherId,
          }))
          const { error: fErr } = await supabase.from("fellowships").insert(insertRows)
          if (fErr) throw fErr
        }
      }

      toast.success(isEditing ? "Cadastro atualizado." : "Cadastro criado.")
      onSuccess()
      onOpenChange(false)
    } catch (err: unknown) {
      console.error("Erro ao salvar irmão:", err)
      if (profileSaved) {
        onSuccess()
      }
      const message = extractErrorMessage(err, "Erro desconhecido ao salvar.")
      toast.error(
        profileSaved
          ? `Cadastro salvo, mas erro ao atualizar companheiros: ${message}`
          : `Não foi possível salvar: ${message}`
      )
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!disciple) return
    setDeleting(true)
    try {
      const { error } = await supabase.from("profiles").delete().eq("id", disciple.id)
      if (error) throw error

      toast.success("Cadastro excluído.")
      onSuccess()
      onOpenChange(false)
    } catch (err: unknown) {
      console.error("Erro ao excluir perfil:", err)
      const message = extractErrorMessage(err, "Erro desconhecido.")
      toast.error(`Não foi possível excluir: ${message}`)
    } finally {
      setDeleting(false)
    }
  }

  const wasChildOriginally = Boolean(disciple && checkIsChild(disciple))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        className="max-h-[92dvh] sm:max-h-[88dvh] flex flex-col p-0 overflow-hidden gap-0"
      >
        <DialogHeader className="px-5 py-4 sm:px-6 border-b border-border/60 shrink-0">
          <DialogTitle>
            {isEditing ? "Editar Cadastro" : "Novo Cadastro"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Formulário de cadastro e edição de irmão.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex-[0_1_auto] min-h-0 overflow-y-auto flex flex-col gap-5 px-5 py-4 sm:px-6">
          {/* Tipo ao criar novo */}
          {!isEditing && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={!isChild ? "default" : "outline"}
                aria-pressed={!isChild}
                onClick={() => setIsChild(false)}
                className="h-11 min-h-[44px] rounded-xl text-xs sm:text-sm font-medium"
              >
                Adulto
              </Button>
              <Button
                type="button"
                variant={isChild ? "default" : "outline"}
                aria-pressed={isChild}
                onClick={() => {
                  setIsChild(true)
                  setBaptismDate("")
                }}
                className="h-11 min-h-[44px] rounded-xl text-xs sm:text-sm font-medium"
              >
                Criança
              </Button>
            </div>
          )}

          {/* Voltar para criança caso tenha clicado em Cadastrar batismo ao editar */}
          {isEditing && wasChildOriginally && !isChild && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-border/70 bg-muted/30 px-3.5 py-2">
              <span className="text-xs font-medium text-foreground">Batismo cadastrado</span>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsChild(true)
                  setBaptismDate("")
                }}
                className="h-11 min-h-[44px] rounded-xl px-3 text-xs"
              >
                <RotateCcw data-icon="inline-start" />
                <span>Desfazer</span>
              </Button>
            </div>
          )}

          {isChild ? (
            <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Nome */}
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="child-full-name">
                  Nome <span className="text-destructive">*</span>
                </FieldLabel>
                <Input
                  id="child-full-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Nome completo"
                  className="h-11 min-h-[44px] rounded-xl text-sm"
                />
              </Field>

              {/* Sexo */}
              <FieldSet className="gap-2 sm:col-span-2">
                <FieldLegend variant="label" className="mb-0">
                  Sexo <span className="text-destructive">*</span>
                </FieldLegend>
                <div className="grid grid-cols-2 gap-2 max-w-xs">
                  <Button
                    type="button"
                    variant={gender === "M" ? "default" : "outline"}
                    aria-pressed={gender === "M"}
                    onClick={() => handleGenderChange("M")}
                    className="h-11 min-h-[44px] rounded-xl text-xs sm:text-sm font-medium"
                  >
                    {gender === "M" && <Check data-icon="inline-start" />}
                    <span>Masculino</span>
                  </Button>
                  <Button
                    type="button"
                    variant={gender === "F" ? "default" : "outline"}
                    aria-pressed={gender === "F"}
                    onClick={() => handleGenderChange("F")}
                    className="h-11 min-h-[44px] rounded-xl text-xs sm:text-sm font-medium"
                  >
                    {gender === "F" && <Check data-icon="inline-start" />}
                    <span>Feminino</span>
                  </Button>
                </div>
              </FieldSet>

              {/* Pais */}
              <Field>
                <FieldLabel htmlFor="child-father">Pai</FieldLabel>
                <SearchableSelect
                  id="child-father"
                  options={fatherOptions}
                  value={fatherId}
                  onValueChange={handleFatherChange}
                  placeholder="Selecionar pai..."
                  clearable={true}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="child-mother">Mãe</FieldLabel>
                <SearchableSelect
                  id="child-mother"
                  options={motherOptions}
                  value={motherId}
                  onValueChange={handleMotherChange}
                  placeholder="Selecionar mãe..."
                  clearable={true}
                />
              </Field>

              {/* Botão cadastrar batismo */}
              <div className="sm:col-span-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRegisterBaptism}
                  className="h-11 min-h-[44px] w-full rounded-xl text-xs sm:text-sm font-medium"
                >
                  Cadastrar batismo
                </Button>
              </div>
            </FieldGroup>
          ) : (
            <>
              <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Nome */}
                <Field className="sm:col-span-2">
                  <FieldLabel htmlFor="disciple-full-name">
                    Nome <span className="text-destructive">*</span>
                  </FieldLabel>
                  <Input
                    id="disciple-full-name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Nome completo"
                    className="h-11 min-h-[44px] rounded-xl text-sm"
                  />
                </Field>

                {/* Sexo */}
                <FieldSet className="gap-2">
                  <FieldLegend variant="label" className="mb-0">
                    Sexo <span className="text-destructive">*</span>
                  </FieldLegend>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={gender === "M" ? "default" : "outline"}
                      aria-pressed={gender === "M"}
                      onClick={() => handleGenderChange("M")}
                      className="h-11 min-h-[44px] rounded-xl text-xs sm:text-sm font-medium"
                    >
                      {gender === "M" && <Check data-icon="inline-start" />}
                      <span>Masculino</span>
                    </Button>
                    <Button
                      type="button"
                      variant={gender === "F" ? "default" : "outline"}
                      aria-pressed={gender === "F"}
                      onClick={() => handleGenderChange("F")}
                      className="h-11 min-h-[44px] rounded-xl text-xs sm:text-sm font-medium"
                    >
                      {gender === "F" && <Check data-icon="inline-start" />}
                      <span>Feminino</span>
                    </Button>
                  </div>
                </FieldSet>

                {/* Telefone */}
                <Field>
                  <FieldLabel htmlFor="disciple-phone">
                    Telefone <span className="text-destructive">*</span>
                  </FieldLabel>
                  <Input
                    id="disciple-phone"
                    type="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(formatPhone(e.target.value))}
                    placeholder="(31) 99999-9999"
                    className="h-11 min-h-[44px] rounded-xl text-sm"
                  />
                </Field>

                {/* Grupo caseiro */}
                <Field>
                  <FieldLabel htmlFor="disciple-home-group">
                    Grupo caseiro <span className="text-destructive">*</span>
                  </FieldLabel>
                  <SearchableSelect
                    id="disciple-home-group"
                    options={homeGroupOptions}
                    value={homeGroupId}
                    onValueChange={setHomeGroupId}
                    placeholder="Selecionar grupo..."
                    disabled={!isEditing && lockGroupSelectionOnCreate}
                    clearable={false}
                  />
                </Field>

                {/* Discipulador */}
                <Field>
                  <FieldLabel htmlFor="disciple-discipler">Discipulador</FieldLabel>
                  <SearchableSelect
                    id="disciple-discipler"
                    options={disciplerOptions}
                    value={
                      disciplerId !== "none"
                        ? disciplerId
                        : customDisciplerName
                        ? `custom:${customDisciplerName}`
                        : "none"
                    }
                    onValueChange={handleDisciplerChange}
                    allowCustomValue={true}
                    searchByLabelOnly={true}
                    customValueActionLabel={(q) => `Usar "${q}"`}
                    placeholder={
                      gender === "F" ? "Selecionar discipuladora..." : "Selecionar discipulador..."
                    }
                    clearable={true}
                  />
                </Field>

                {/* Casado? */}
                <FieldSet className="gap-2 sm:col-span-2">
                  <FieldLegend variant="label" className="mb-0">
                    Casado?
                  </FieldLegend>
                  <div className="grid grid-cols-2 gap-2 max-w-xs">
                    <Button
                      type="button"
                      variant={isMarried ? "default" : "outline"}
                      aria-pressed={isMarried}
                      onClick={() => handleMarriedChange(true)}
                      className="h-11 min-h-[44px] rounded-xl text-xs sm:text-sm font-medium"
                    >
                      Sim
                    </Button>
                    <Button
                      type="button"
                      variant={!isMarried ? "default" : "outline"}
                      aria-pressed={!isMarried}
                      onClick={() => handleMarriedChange(false)}
                      className="h-11 min-h-[44px] rounded-xl text-xs sm:text-sm font-medium"
                    >
                      Não
                    </Button>
                  </div>
                </FieldSet>

                {isMarried ? (
                  <Field className="sm:col-span-2">
                    <FieldLabel htmlFor="disciple-spouse">Cônjuge</FieldLabel>
                    <SearchableSelect
                      id="disciple-spouse"
                      options={spouseOptions}
                      value={spouseId}
                      onValueChange={setSpouseId}
                      placeholder={gender === "F" ? "Selecionar esposo..." : "Selecionar esposa..."}
                      clearable={true}
                    />
                  </Field>
                ) : (
                  <>
                    <FieldSet className="gap-2 sm:col-span-2">
                      <FieldLegend variant="label" className="mb-0">
                        Os pais estão na igreja?
                      </FieldLegend>
                      <div className="grid grid-cols-2 gap-2 max-w-xs">
                        <Button
                          type="button"
                          variant={parentsInChurch ? "default" : "outline"}
                          aria-pressed={parentsInChurch}
                          onClick={() => handleParentsInChurchChange(true)}
                          className="h-11 min-h-[44px] rounded-xl text-xs sm:text-sm font-medium"
                        >
                          Sim
                        </Button>
                        <Button
                          type="button"
                          variant={!parentsInChurch ? "default" : "outline"}
                          aria-pressed={!parentsInChurch}
                          onClick={() => handleParentsInChurchChange(false)}
                          className="h-11 min-h-[44px] rounded-xl text-xs sm:text-sm font-medium"
                        >
                          Não
                        </Button>
                      </div>
                    </FieldSet>

                    {parentsInChurch && (
                      <>
                        <Field>
                          <FieldLabel htmlFor="disciple-father">Pai</FieldLabel>
                          <SearchableSelect
                            id="disciple-father"
                            options={fatherOptions}
                            value={fatherId}
                            onValueChange={handleFatherChange}
                            placeholder="Selecionar pai..."
                            clearable={true}
                          />
                        </Field>

                        <Field>
                          <FieldLabel htmlFor="disciple-mother">Mãe</FieldLabel>
                          <SearchableSelect
                            id="disciple-mother"
                            options={motherOptions}
                            value={motherId}
                            onValueChange={handleMotherChange}
                            placeholder="Selecionar mãe..."
                            clearable={true}
                          />
                        </Field>
                      </>
                    )}
                  </>
                )}

                {/* Companheiro */}
                <Field className="sm:col-span-2">
                  <FieldLabel htmlFor="disciple-companion">Companheiro</FieldLabel>
                  {selectedFellowships.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedFellowships.map((fid) => {
                        const companionName = profileMap.get(fid)?.full_name || "Irmão"
                        return (
                          <span
                            key={fid}
                            className="inline-flex min-h-[44px] items-center gap-1 rounded-full bg-secondary/80 pl-3.5 pr-1 text-xs font-medium text-secondary-foreground border border-border/50"
                          >
                            <span className="truncate max-w-[200px]">{companionName}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveCompanion(fid)}
                              aria-label={`Remover ${companionName}`}
                              className="flex size-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                            >
                              <X className="size-3.5" />
                            </button>
                          </span>
                        )
                      })}
                    </div>
                  )}
                  <SearchableSelect
                    id="disciple-companion"
                    options={companionOptions}
                    value=""
                    onValueChange={handleSelectCompanion}
                    placeholder={
                      gender === "F" ? "Adicionar companheira..." : "Adicionar companheiro..."
                    }
                    clearable={false}
                  />
                </Field>

                {/* Núcleo do grupo */}
                <div className="sm:col-span-2">
                  <Label
                    htmlFor="disciple-is-nucleus"
                    className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border border-border/70 bg-muted/20 px-3.5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/40"
                  >
                    <Checkbox
                      id="disciple-is-nucleus"
                      checked={isGroupNucleus}
                      onCheckedChange={(checked) => setIsGroupNucleus(!!checked)}
                    />
                    <span>Núcleo do grupo</span>
                  </Label>
                </div>
              </FieldGroup>

              <Separator />

              {/* Opcionais */}
              <div className="flex flex-col gap-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Opcionais
                </span>
                <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="disciple-email">E-mail</FieldLabel>
                    <Input
                      id="disciple-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="exemplo@email.com"
                      className="h-11 min-h-[44px] rounded-xl text-sm"
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="disciple-birth-date">Data de nascimento</FieldLabel>
                    <Input
                      id="disciple-birth-date"
                      type="date"
                      value={birthDate}
                      onChange={(e) => setBirthDate(e.target.value)}
                      className="h-11 min-h-[44px] rounded-xl text-sm"
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="disciple-baptism-date">Data de batismo</FieldLabel>
                    <Input
                      id="disciple-baptism-date"
                      type="date"
                      value={baptismDate}
                      onChange={(e) => setBaptismDate(e.target.value)}
                      className="h-11 min-h-[44px] rounded-xl text-sm"
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="disciple-cpf">CPF</FieldLabel>
                    <Input
                      id="disciple-cpf"
                      inputMode="numeric"
                      value={cpf}
                      onChange={(e) => setCpf(formatCPF(e.target.value))}
                      placeholder="000.000.000-00"
                      className="h-11 min-h-[44px] rounded-xl text-sm"
                    />
                  </Field>
                </FieldGroup>
              </div>
            </>
          )}

          {isEditing && disciple?.user_id === null && confirmDelete && (
            <div className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3.5 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs font-medium text-destructive">
                Excluir cadastro de {disciple.full_name}?
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  disabled={deleting}
                  onClick={handleDelete}
                  className="h-11 min-h-[44px] rounded-xl px-4 text-xs font-medium"
                >
                  {deleting ? <Loader2 className="animate-spin" /> : "Confirmar"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirmDelete(false)}
                  className="h-11 min-h-[44px] rounded-xl px-4 text-xs"
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </DialogBody>

        <DialogFooter className="px-5 py-3.5 sm:px-6 border-t border-border/60 shrink-0 bg-muted/20 flex flex-col-reverse sm:flex-row sm:items-center gap-2 sm:justify-end pt-3.5">
          {isEditing && disciple?.user_id === null && !confirmDelete && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmDelete(true)}
              className="h-11 min-h-[44px] w-full sm:w-auto sm:mr-auto text-xs text-destructive hover:bg-destructive/10 hover:text-destructive rounded-xl px-4"
            >
              <Trash2 data-icon="inline-start" />
              <span>Excluir</span>
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-11 min-h-[44px] w-full sm:w-auto text-xs rounded-xl px-5"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="h-11 min-h-[44px] w-full sm:w-auto text-xs font-semibold rounded-xl px-6"
          >
            {saving ? (
              <>
                <Loader2 data-icon="inline-start" className="animate-spin" />
                <span>Salvando...</span>
              </>
            ) : (
              <span>Salvar</span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
