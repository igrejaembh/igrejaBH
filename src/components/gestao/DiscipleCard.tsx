import { CornerDownLeft, ArrowLeftRight, Heart, Pencil, Users } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import type { Database } from "@/lib/database.types"
import { THEME_CLASSES } from "@/constants/colors"

type Profile = Database["public"]["Tables"]["profiles"]["Row"]

export interface DiscipleCardProps {
  disciple: Profile
  isLeader?: boolean
  isNucleus?: boolean
  disciplerName?: string | null
  spouseName?: string | null
  fatherName?: string | null
  motherName?: string | null
  fellowshipNames?: string[]
  onEdit: (disciple: Profile) => void
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
}

export function DiscipleCard({
  disciple,
  isLeader = false,
  isNucleus = false,
  disciplerName,
  spouseName,
  fatherName,
  motherName,
  fellowshipNames = [],
  onEdit,
}: DiscipleCardProps) {
  const hasCompanions = fellowshipNames.length > 0
  const hasRelationshipMetadata = Boolean(disciplerName || hasCompanions || spouseName)
  const parentsNames = [fatherName, motherName].filter(Boolean).join(" & ")
  const showParents = !hasRelationshipMetadata && Boolean(parentsNames)
  const hasMetadata = hasRelationshipMetadata || showParents

  return (
    <button
      type="button"
      onClick={() => onEdit(disciple)}
      aria-label={`Editar informações de ${disciple.full_name}`}
      className="group flex h-full min-h-[44px] w-full cursor-pointer items-start gap-3 rounded-2xl border border-border/80 bg-card p-3.5 text-left shadow-xs transition-colors hover:border-primary/40 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:p-4"
    >
      {/* a. Avatar */}
      <Avatar className="size-11 shrink-0 border border-border">
        <AvatarImage
          src={disciple.avatar_url || undefined}
          alt={disciple.full_name}
        />
        <AvatarFallback className="bg-muted text-xs font-semibold text-foreground">
          {getInitials(disciple.full_name)}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        {/* b. Nome + tags (Líder / Núcleo) + ícone discreto de edição */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <h3 className="min-w-0 truncate text-sm font-semibold leading-snug tracking-tight text-foreground sm:text-base">
              {disciple.full_name}
            </h3>
            {isLeader && (
              <Badge variant="outline" className={THEME_CLASSES.badgeGroupLeader}>
                Líder
              </Badge>
            )}
            {isNucleus && (
              <Badge variant="outline" className={THEME_CLASSES.badgeGroupNucleus}>
                Núcleo
              </Badge>
            )}
          </div>
          <Pencil
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground"
          />
        </div>

        {/* c, d, e: Discipulador, Companheiro e Cônjuge (ou Pais na ausência destes) */}
        {hasMetadata && (
          <div className="mt-2 flex flex-col gap-1 text-xs font-normal text-muted-foreground">
            {disciplerName && (
              <div className="flex items-center gap-1.5 min-w-0">
                <CornerDownLeft
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-muted-foreground/80"
                />
                <span className="sr-only">Discipulador: </span>
                <span className="truncate">{disciplerName}</span>
              </div>
            )}

            {hasCompanions && (
              <div className="flex items-center gap-1.5 min-w-0">
                <ArrowLeftRight
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-muted-foreground/80"
                />
                <span className="sr-only">Companheiro: </span>
                <span className="truncate">{fellowshipNames.join(", ")}</span>
              </div>
            )}

            {spouseName && (
              <div className="flex items-center gap-1.5 min-w-0">
                <Heart
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-muted-foreground/80"
                />
                <span className="sr-only">Cônjuge: </span>
                <span className="truncate">{spouseName}</span>
              </div>
            )}

            {showParents && (
              <div className="flex items-center gap-1.5 min-w-0">
                <Users
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-muted-foreground/80"
                />
                <span className="sr-only">Pais: </span>
                <span className="truncate">{parentsNames}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </button>
  )
}
