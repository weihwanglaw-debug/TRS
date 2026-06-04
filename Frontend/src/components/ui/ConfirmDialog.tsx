import { AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  destructive?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  loading = false,
  destructive = false,
  onOpenChange,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => !loading && onOpenChange(nextOpen)}>
      <AlertDialogContent
        className="max-w-md gap-0 p-0 sm:rounded-none"
        style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)" }}
      >
        <AlertDialogHeader className="p-7 pb-4" style={{ borderBottom: "1px solid var(--color-table-border)" }}>
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center"
              style={{
                backgroundColor: destructive ? "var(--badge-open-bg)" : "var(--badge-soon-bg)",
                color: destructive ? "var(--badge-open-text)" : "var(--badge-soon-text)",
              }}
            >
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div>
              <AlertDialogTitle className="font-bold text-lg" style={{ color: "var(--color-heading)" }}>
                {title}
              </AlertDialogTitle>
              <AlertDialogDescription className="mt-2 text-sm leading-relaxed" style={{ color: "var(--color-body-text)" }}>
                {description}
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter className="p-7 pt-5">
          <AlertDialogCancel className="btn-outline mt-0 px-5 py-2.5 text-sm font-medium" disabled={loading}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            className="btn-primary px-5 py-2.5 text-sm font-semibold disabled:opacity-50"
            disabled={loading}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            style={destructive ? { backgroundColor: "var(--badge-open-text)", color: "var(--color-hero-text)" } : undefined}
          >
            {loading ? "Working..." : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
