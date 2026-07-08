import { AlertTriangle, Check, Info, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ActionFeedbackVariant = "success" | "error" | "warning" | "info";

interface ActionFeedbackDialogProps {
  open: boolean;
  variant: ActionFeedbackVariant;
  title: string;
  description?: string;
  actionLabel?: string;
  onOpenChange: (open: boolean) => void;
}

const variantConfig: Record<ActionFeedbackVariant, { color: string; bg: string; Icon: LucideIcon }> = {
  success: { color: "var(--feedback-success)", bg: "var(--feedback-success-bg)", Icon: Check },
  error: { color: "var(--feedback-error)", bg: "var(--feedback-error-bg)", Icon: X },
  warning: { color: "var(--feedback-warning)", bg: "var(--feedback-warning-bg)", Icon: AlertTriangle },
  info: { color: "var(--feedback-info)", bg: "var(--feedback-info-bg)", Icon: Info },
};

export function ActionFeedbackDialog({
  open,
  variant,
  title,
  description,
  actionLabel = "OK",
  onOpenChange,
}: ActionFeedbackDialogProps) {
  const { color, bg, Icon } = variantConfig[variant];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-sm gap-0 p-0 sm:rounded-none"
        style={{
          backgroundColor: "var(--color-page-bg)",
          border: "1px solid var(--color-table-border)",
          borderTop: `4px solid ${color}`,
        }}
      >
        <DialogHeader className="items-center px-8 pb-0 pt-8 text-center">
          <span
            className="mb-5 flex h-14 w-14 items-center justify-center rounded-full"
            style={{ backgroundColor: bg, border: `2.5px solid ${color}`, color }}
          >
            <Icon className="h-7 w-7" />
          </span>
          <DialogTitle className="text-base font-bold" style={{ color: "var(--color-heading)" }}>
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription
              className="mt-3 text-xs leading-relaxed"
              style={{ color: "var(--color-body-text)" }}
            >
              {description}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="px-8 pb-8 pt-6 text-center">
          <button
            type="button"
            className="min-w-28 px-5 py-2.5 text-sm font-semibold"
            style={{ backgroundColor: color, color: "var(--color-hero-text)" }}
            onClick={() => onOpenChange(false)}
          >
            {actionLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
