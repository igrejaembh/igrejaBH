import { useState, useMemo } from "react"
import { Link } from "react-router-dom"
import { Bell, Plus, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useNewsFeed, type PostCategory } from "@/hooks/useNewsFeed"
import { useCurrentUserProfile } from "@/hooks/useCurrentUserProfile"
import { NewsCategoryFilters } from "@/components/news/NewsCategoryFilters"
import { NewsCard } from "@/components/news/NewsCard"
import { PublisherRolesDialog } from "@/components/gestao/PublisherRolesDialog"

export function NewsTimeline() {
  const { feedItems, loading } = useNewsFeed()
  const [selectedCategory, setSelectedCategory] = useState<PostCategory | "todos">("todos")
  const [publishersDialogOpen, setPublishersDialogOpen] = useState(false)
  const { canPost, canAssignResourcePermissions } = useCurrentUserProfile()

  const filteredItems = useMemo(() => {
    if (selectedCategory === "todos") return feedItems
    return feedItems.filter((item) => item.category === selectedCategory)
  }, [feedItems, selectedCategory])

  return (
    <div className="space-y-6">
      {/* Header do Mural com Ação de Novo Aviso */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            <Bell className="h-6 w-6 text-primary shrink-0" />
            <span>Mural da Comunidade</span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Acompanhe comunicados, pedidos de oração, novos ensinos e a vida da Igreja em BH.
          </p>
        </div>

        {(canPost || canAssignResourcePermissions) && (
          <div className="flex flex-wrap items-center gap-2">
            {canAssignResourcePermissions && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPublishersDialogOpen(true)}
                className="min-h-[44px] shrink-0 gap-1.5 rounded-full font-semibold px-4"
              >
                <ShieldCheck className="h-4 w-4" />
                <span>Publicadores</span>
              </Button>
            )}
            {canPost && (
              <Button
                asChild
                size="sm"
                className="min-h-[44px] shrink-0 gap-1.5 rounded-full font-semibold px-4"
              >
                <Link to="/noticias/nova">
                  <Plus className="h-4 w-4" />
                  <span>Novo Comunicado</span>
                </Link>
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Barra de Filtros por Categoria */}
      <NewsCategoryFilters
        activeCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
      />

      {/* Conteúdo do Feed */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="flex flex-col justify-between rounded-2xl border border-border/50 bg-card p-5 space-y-4"
            >
              <div className="space-y-3">
                <Skeleton className="h-4 w-28 rounded-full" />
                <Skeleton className="h-6 w-full rounded" />
                <Skeleton className="h-4 w-3/4 rounded" />
                <Skeleton className="h-16 w-full rounded-xl" />
              </div>
              <Skeleton className="h-8 w-24 rounded" />
            </div>
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-card/40 p-8 text-center">
          <Bell className="h-8 w-8 text-muted-foreground/50 mb-2" />
          <p className="text-sm font-semibold text-foreground">
            Nenhuma publicação nesta categoria no momento.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Selecione "Todos" ou volte em breve para novas atualizações da comunidade.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredItems.map((item) => (
            <NewsCard key={item.id} post={item} />
          ))}
        </div>
      )}
      <PublisherRolesDialog
        open={publishersDialogOpen}
        onOpenChange={setPublishersDialogOpen}
      />
    </div>
  )
}
