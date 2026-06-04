import { Info } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface NoticeDialogProps {
  open: boolean;
  title: string;
  description: string;
  actionLabel?: string;
  onOpenChange: (open: boolean) => void;
}

export function NoticeDialog({
  open,
  title,
  description,
  actionLabel = "OK",
  onOpenChange,
}: NoticeDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        className="max-w-md gap-0 p-0 sm:rounded-none"
        style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)" }}
      >
        <AlertDialogHeader className="p-7 pb-4" style={{ borderBottom: "1px solid var(--color-table-border)" }}>
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center"
              style={{ backgroundColor: "var(--badge-soon-bg)", color: "var(--badge-soon-text)" }}
            >
              <Info className="h-5 w-5" />
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
          <AlertDialogAction className="btn-primary px-5 py-2.5 text-sm font-semibold">
            {actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
