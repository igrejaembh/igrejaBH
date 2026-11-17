import { useState, useEffect } from "react";
import { Plus, Trash2, RotateCcw, ListChecks, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import supabase from "@/lib/supabase";
import type { Json } from "@/lib/database.types";
import {
  CHECKIN_CHECKLIST_PRESETS,
  DEFAULT_CHECKIN_CHECKLIST,
  slugifyChecklistKey,
  type CheckinChecklistItem,
} from "@/lib/checkinFlags";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";

interface CheckinChecklistConfigEditorProps {
  value: CheckinChecklistItem[];
  onChange: (next: CheckinChecklistItem[]) => void;
  disabled?: boolean;
  inputId?: string;
}

export function CheckinChecklistConfigEditor({
  value,
  onChange,
  disabled = false,
  inputId = "custom-checklist-item-input",
}: CheckinChecklistConfigEditorProps) {
  const [customLabel, setCustomLabel] = useState("");

  const existingKeys = value.map((item) => item.key);
  const existingLabelsLower = new Set(
    value.map((item) => item.label.trim().toLowerCase())
  );

  const availablePresets = CHECKIN_CHECKLIST_PRESETS.filter(
    (preset) =>
      !existingKeys.includes(preset.key) &&
      !existingLabelsLower.has(preset.label.trim().toLowerCase())
  );

  const handleAddCustom = () => {
    const trimmed = customLabel.trim();
    if (!trimmed) return;
    if (existingLabelsLower.has(trimmed.toLowerCase())) {
      toast.info("Este item já está na checklist.");
      return;
    }
    const key = slugifyChecklistKey(trimmed, existingKeys);
    onChange([...value, { key, label: trimmed }]);
    setCustomLabel("");
  };

  const handleAddPreset = (preset: CheckinChecklistItem) => {
    if (existingKeys.includes(preset.key)) return;
    onChange([...value, preset]);
  };

  const handleRemove = (key: string) => {
    onChange(value.filter((item) => item.key !== key));
  };

  const handleRestoreDefaults = () => {
    onChange([...DEFAULT_CHECKIN_CHECKLIST]);
  };

  return (
    <FieldSet className="rounded-xl border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FieldLegend className="mb-0 flex items-center gap-2 text-sm font-bold text-foreground">
          <ListChecks className="size-4 text-primary" />
          <span>Checklist de Controle na Portaria</span>
        </FieldLegend>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={handleRestoreDefaults}
          className="min-h-[44px] px-3 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <RotateCcw data-icon="inline-start" />
          <span>Restaurar padrão</span>
        </Button>
      </div>

      <FieldDescription>
        Defina os itens de conferência que os diáconos poderão marcar no check-in de cada irmão (ex: entrega de camisa, pagamento em espécie ou entrega de crachá).
      </FieldDescription>

      <FieldGroup className="gap-3">
        {/* Lista de itens ativos */}
        {value.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-background/60 px-3 py-4 text-center text-xs text-muted-foreground">
            Nenhum item configurado. Adicione opções sugeridas ou crie um item personalizado abaixo.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {value.map((item, idx) => (
              <div
                key={item.key}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-1.5"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Badge variant="secondary" className="shrink-0 font-mono">
                    {idx + 1}
                  </Badge>
                  <span className="truncate text-xs sm:text-sm font-medium text-foreground">
                    {item.label}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  onClick={() => handleRemove(item.key)}
                  aria-label={`Remover ${item.label}`}
                  className="min-h-[44px] min-w-[44px] shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive cursor-pointer"
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Adicionar item customizado */}
        <Field>
          <FieldLabel htmlFor={inputId} className="text-xs font-semibold">
            Adicionar item personalizado
          </FieldLabel>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <Input
              id={inputId}
              value={customLabel}
              disabled={disabled}
              onChange={(e) => setCustomLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddCustom();
                }
              }}
              placeholder="Ex: Já entregou camisa, Pagou em dinheiro..."
              className="min-h-[44px] flex-1"
            />
            <Button
              type="button"
              variant="secondary"
              disabled={disabled || !customLabel.trim()}
              onClick={handleAddCustom}
              className="min-h-[44px] px-4 text-xs font-bold cursor-pointer shrink-0"
            >
              <Plus data-icon="inline-start" />
              <span>Adicionar</span>
            </Button>
          </div>
        </Field>

        {/* Sugestões rápidas */}
        {availablePresets.length > 0 && (
          <div className="flex flex-col gap-2 pt-1">
            <span className="text-xs font-semibold text-muted-foreground">
              Sugestões rápidas:
            </span>
            <div className="flex flex-wrap gap-2">
              {availablePresets.map((preset) => (
                <Button
                  key={preset.key}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => handleAddPreset(preset)}
                  className="min-h-[44px] px-3 text-xs font-medium cursor-pointer"
                >
                  <Plus data-icon="inline-start" />
                  <span>{preset.label}</span>
                </Button>
              ))}
            </div>
          </div>
        )}
      </FieldGroup>
    </FieldSet>
  );
}

interface CheckinChecklistConfigDialogProps {
  isOpen: boolean;
  onClose: () => void;
  retreatId?: string;
  retreatTitle: string;
  initialConfig: CheckinChecklistItem[];
  onSaved: (nextConfig: CheckinChecklistItem[]) => void;
}

export function CheckinChecklistConfigDialog({
  isOpen,
  onClose,
  retreatId,
  retreatTitle,
  initialConfig,
  onSaved,
}: CheckinChecklistConfigDialogProps) {
  const [items, setItems] = useState<CheckinChecklistItem[]>(initialConfig);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setItems(initialConfig);
    }
  }, [isOpen, initialConfig]);

  const handleSave = async () => {
    if (!retreatId) {
      onSaved(items);
      onClose();
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("retreats")
        .update({ checkin_checklist_config: items as unknown as Json })
        .eq("id", retreatId);

      if (error) throw error;

      onSaved(items);
      toast.success("Checklist de portaria atualizada com sucesso!");
      onClose();
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Não foi possível salvar a checklist.";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg" className="p-5 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="size-5 text-primary shrink-0" />
            <span>Configurar Checklist de Portaria</span>
          </DialogTitle>
          <DialogDescription>
            Personalize os controles de recebimento e entregas para{" "}
            <strong>{retreatTitle}</strong>.
          </DialogDescription>
        </DialogHeader>

        <CheckinChecklistConfigEditor
          value={items}
          onChange={setItems}
          disabled={saving}
          inputId="quick-checklist-item-input"
        />

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={saving}
            className="min-h-[44px] cursor-pointer"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="min-h-[44px] font-bold cursor-pointer"
          >
            {saving ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <Check data-icon="inline-start" />
            )}
            <span>{saving ? "Salvando..." : "Salvar Checklist"}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
