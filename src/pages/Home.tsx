import { useEffect, useState, useMemo } from "react"
import supabase from "@/lib/supabase"
import { BookOpen } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { HomeGroupSideCard } from "@/components/home/HomeGroupSideCard"
import { DiscipleshipSideCard } from "@/components/home/DiscipleshipSideCard"
import { StudyProgressCard, type ActiveStudyInfo } from "@/components/home/StudyProgressCard"
import { CommunityCalendarCard } from "@/components/home/CommunityCalendarCard"
import { NewsTimeline } from "@/components/home/NewsTimeline"
import { ACCOUNT_TYPE_BADGE_CONFIG } from "@/constants/colors"
import { normalizeAccountType } from "@/lib/permissions"
import type { Database } from "@/lib/database.types"

type Profile = Database["public"]["Tables"]["profiles"]["Row"]
type ProfileSummary = {
  id: string
  full_name: string
  avatar_url: string | null
  phone: string | null
}
type HomeGroup = Database["public"]["Tables"]["home_groups"]["Row"] & {
  sectors?: Database["public"]["Tables"]["sectors"]["Row"] | null
  leader_1?: ProfileSummary | null
  leader_2?: ProfileSummary | null
}

// Versículos focados no Propósito Eterno e edificação mútua
const dailyVerses = [
  {
    verse:
      "Porque os que dantes conheceu, também os predestinou para serem conformes à imagem de seu Filho, a fim de que ele seja o primogênito entre muitos irmãos.",
    reference: "Romanos 8:29",
    theme: "O Propósito Eterno",
  },
  {
    verse:
      "Do qual todo o corpo, bem ajustado e ligado pelo auxílio de todas as juntas, segundo a justa operação de cada parte, faz o aumento do corpo, para sua edificação em amor.",
    reference: "Efésios 4:16",
    theme: "Juntas e Ligamentos",
  },
  {
    verse:
      "E perseveravam na doutrina dos apóstolos, e na comunhão, e no partir do pão, e nas orações.",
    reference: "Atos 2:42",
    theme: "A Vida Comum",
  },
  {
    verse:
      "Habite ricamente em vós a palavra de Cristo, em toda a sabedoria, ensinando-vos e admoestando-vos uns aos outros.",
    reference: "Colossenses 3:16",
    theme: "Sacerdócio Universal",
  },
]

export default function Home() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [homeGroup, setHomeGroup] = useState<HomeGroup | null>(null)
  const [groupMembers, setGroupMembers] = useState<ProfileSummary[]>([])
  const [discipler, setDiscipler] = useState<ProfileSummary | null>(null)
  const [disciples, setDisciples] = useState<ProfileSummary[]>([])
  const [fellows, setFellows] = useState<ProfileSummary[]>([])
  const [studyInfo, setStudyInfo] = useState<ActiveStudyInfo | null>(null)
  const [loading, setLoading] = useState(true)

  // Seleciona um versículo do dia baseado no dia do ano
  const todaysVerse = useMemo(() => {
    const dayOfYear = Math.floor(
      (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) /
        1000 /
        60 /
        60 /
        24
    )
    return dailyVerses[dayOfYear % dailyVerses.length]
  }, [])

  useEffect(() => {
    let isMounted = true

    async function loadDashboardData() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()

        if (!session?.user) {
          if (isMounted) setLoading(false)
          return
        }

        // 1. Carrega o perfil do discípulo logado
        const { data: userProfile } = await supabase
          .from("profiles")
          .select("*")
          .eq("user_id", session.user.id)
          .maybeSingle()

        if (!userProfile) {
          if (isMounted) setLoading(false)
          return
        }

        if (isMounted) setProfile(userProfile)

        // 2. Carrega dados do Grupo Caseiro e dos seus irmãos (via diretório não-sensível)
        if (userProfile.home_group_id) {
          const { data: hgData } = await supabase
            .from("home_groups")
            .select(`
              *,
              sectors (*)
            `)
            .eq("id", userProfile.home_group_id)
            .maybeSingle()

          const { data: membersData } = await supabase
            .from("profile_directory")
            .select("id, full_name, avatar_url, phone")
            .eq("home_group_id", userProfile.home_group_id)
            .eq("account_type", "disciple")
            .order("full_name")

          const dirMembers = membersData || []
          if (isMounted) {
            setGroupMembers(dirMembers)
          }

          if (hgData) {
            const leaderIds = [hgData.leader_1_id, hgData.leader_2_id].filter(
              (id): id is string => Boolean(id)
            )
            const leaderMap = new Map<string, ProfileSummary>()
            if (leaderIds.length > 0) {
              const { data: leaderRows } = await supabase
                .from("profile_directory")
                .select("id, full_name, avatar_url, phone")
                .in("id", leaderIds)
              leaderRows?.forEach((l) => leaderMap.set(l.id, l))
            }

            if (isMounted) {
              setHomeGroup({
                ...hgData,
                leader_1: hgData.leader_1_id ? leaderMap.get(hgData.leader_1_id) ?? null : null,
                leader_2: hgData.leader_2_id ? leaderMap.get(hgData.leader_2_id) ?? null : null,
              } as unknown as HomeGroup)
            }
          }
        }

        // 3. Carrega Juntas e Ligamentos (Discipulador, Discípulos e Fellows)
        if (userProfile.discipler_id) {
          const { data: disciplerData } = await supabase
            .from("profile_directory")
            .select("id, full_name, avatar_url, phone")
            .eq("id", userProfile.discipler_id)
            .maybeSingle()

          if (isMounted && disciplerData) {
            setDiscipler(disciplerData)
          }
        } else if (userProfile.custom_discipler_name) {
          if (isMounted) {
            setDiscipler({
              id: "custom",
              full_name: `${userProfile.custom_discipler_name} (Não cadastrado)`,
              avatar_url: null,
              phone: null,
            })
          }
        }

        // Discípulos que eu acompanho
        const { data: disciplesData } = await supabase
          .from("profile_directory")
          .select("id, full_name, avatar_url, phone")
          .eq("discipler_id", userProfile.id)
          .eq("account_type", "disciple")

        if (isMounted && disciplesData) {
          setDisciples(disciplesData)
        }

        // Companheiros de Jugo (fellowships)
        const [fellowsARes, fellowsBRes] = await Promise.all([
          supabase
            .from("fellowships")
            .select("member_b_id")
            .eq("member_a_id", userProfile.id),
          supabase
            .from("fellowships")
            .select("member_a_id")
            .eq("member_b_id", userProfile.id),
        ])

        const fellowIds = Array.from(
          new Set([
            ...(fellowsARes.data?.map((f) => f.member_b_id) || []),
            ...(fellowsBRes.data?.map((f) => f.member_a_id) || []),
          ])
        )

        const combinedFellows: ProfileSummary[] = []
        if (fellowIds.length > 0) {
          const { data: fellowProfiles } = await supabase
            .from("profile_directory")
            .select("id, full_name, avatar_url, phone")
            .in("id", fellowIds)
          if (fellowProfiles) {
            combinedFellows.push(...fellowProfiles)
          }
        }

        if (isMounted) {
          setFellows(combinedFellows)
        }

        // 4. Carrega Progresso de Estudos / Catequese
        const { data: allStudies } = await supabase
          .from("studies")
          .select(`
            id,
            title,
            study_steps (
              id,
              sort_order,
              media_resources (
                id,
                title
              )
            )
          `)
          .order("created_at", { ascending: true })

        const { data: userProgress } = await supabase
          .from("user_study_progress")
          .select("step_id")
          .eq("profile_id", userProfile.id)

        if (allStudies && allStudies.length > 0) {
          const completedStepIds = new Set(userProgress?.map((p) => p.step_id) || [])

          // Encontra o primeiro estudo ainda não 100% concluído, ou o último
          let activeStudy = allStudies[0]
          let activeNextStepTitle: string | null = null
          let completedInActive = 0
          let totalInActive = 0

          for (const study of allStudies) {
            const steps = study.study_steps || []
            const completedCount = steps.filter((s: { id: string }) => completedStepIds.has(s.id)).length
            if (completedCount < steps.length) {
              activeStudy = study
              completedInActive = completedCount
              totalInActive = steps.length
              const nextStep = steps.find((s: { id: string }) => !completedStepIds.has(s.id))
              const mediaRes = nextStep?.media_resources as { id: string; title: string } | null
              activeNextStepTitle = mediaRes?.title || null
              break
            }
          }

          // Se concluiu todos os estudos
          if (totalInActive === 0 && activeStudy.study_steps) {
            totalInActive = activeStudy.study_steps.length
            completedInActive = totalInActive
          }

          if (isMounted) {
            setStudyInfo({
              studyId: activeStudy.id,
              studyTitle: activeStudy.title,
              totalSteps: totalInActive || 1,
              completedSteps: completedInActive,
              nextStepTitle: activeNextStepTitle,
            })
          }
        }
      } catch (err) {
        console.error("Erro ao carregar dashboard:", err)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadDashboardData()

    return () => {
      isMounted = false
    }
  }, [])

  const firstName = profile?.full_name ? profile.full_name.split(" ")[0] : ""
  const accountType = normalizeAccountType(
    profile?.account_type,
    profile?.is_church_linked
  )
  const isChurchLinked = accountType === "disciple"
  const isStudyOnly = accountType === "study"
  const accountBadge = ACCOUNT_TYPE_BADGE_CONFIG[accountType]

  return (
    <div className="mx-auto max-w-6xl animate-in space-y-8 pb-12 duration-500 fade-in slide-in-from-bottom-4">
      {/* 1. Header Fraternal & Versículo do Dia */}
      <header className="space-y-4 border-b border-border/60 pb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
              {profile ? `Bem-vindo(a), ${firstName}` : "Bem-vindo(a)"}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
              Igreja em Belo Horizonte • Comunhão e edificação
            </p>
          </div>

          {!loading && !isChurchLinked && (
            <Badge
              variant="outline"
              className={`self-start sm:self-auto px-2.5 py-1 text-xs font-semibold ${accountBadge.className}`}
            >
              {accountBadge.label}
            </Badge>
          )}
        </div>

        {/* Card Sutil do Versículo do Dia (Propósito Eterno) */}
        <div className="rounded-xl border border-border/70 border-l-4 border-l-primary bg-card/60 p-4 shadow-2xs backdrop-blur-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary">
              <BookOpen className="h-3.5 w-3.5 text-primary" />
              Versículo do Dia • {todaysVerse.theme}
            </span>
            <Badge variant="outline" className="border-border text-[10px] font-semibold text-muted-foreground">
              {todaysVerse.reference}
            </Badge>
          </div>
          <p className="mt-2 text-xs italic leading-relaxed text-muted-foreground sm:text-sm">
            &ldquo;{todaysVerse.verse}&rdquo;
          </p>
        </div>
      </header>

      {/* 2. Conteúdo Central: Discípulos Vinculados recebem painel lateral de vínculos; Usuários de Estudo recebem layout focado */}
      {isChurchLinked ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
          {/* Coluna Principal (Esquerda - lg:col-span-8) */}
          <div className="lg:col-span-8 flex flex-col gap-6">
            <StudyProgressCard
              studyInfo={studyInfo}
              loading={loading}
            />

            <CommunityCalendarCard
              loading={loading}
              isChurchLinked={true}
            />
          </div>

          {/* Coluna Lateral (Direita - lg:col-span-4): Informações Rápidas e Simples de Visualizar (Juntas & Oikos) */}
          <aside aria-label="Vínculos e Comunhão no Corpo" className="lg:col-span-4 flex flex-col gap-6">
            <HomeGroupSideCard
              homeGroup={homeGroup}
              members={groupMembers}
              loading={loading}
              isChurchLinked={true}
            />

            <DiscipleshipSideCard
              discipler={discipler}
              disciples={disciples}
              fellows={fellows}
              loading={loading}
              isChurchLinked={true}
            />
          </aside>
        </div>
      ) : (
        /* Para usuários não vinculados, oculta vínculos do Corpo; Estudo também oculta calendário de eventos até participar */
        <div className="flex flex-col gap-6">
          <StudyProgressCard
            studyInfo={studyInfo}
            loading={loading}
          />

          {!isStudyOnly && (
            <CommunityCalendarCard
              loading={loading}
              isChurchLinked={false}
            />
          )}
        </div>
      )}

      {/* 3. Rodapé: Timeline de Avisos da Comunidade (Full Width - 100% da largura, sem espaço em branco lateral) */}
      <section id="mural" aria-label="Avisos e Comunicados" className="w-full pt-4 border-t border-border/50">
        <NewsTimeline />
      </section>
    </div>
  )
}
