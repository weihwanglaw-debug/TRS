import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useLiveConfig } from "@/contexts/LiveConfigContext";

interface ConsentModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export default function ConsentModal({ open, onClose, onConfirm }: ConsentModalProps) {
  const { cfg } = useLiveConfig();
  const [agreed, setAgreed] = useState(false);

  const handleConfirm = () => {
    if (agreed) { onConfirm(); setAgreed(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setAgreed(false); } }}>
      <DialogContent className="max-w-lg p-0" style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)" }}>
        <DialogHeader className="p-8 pb-0">
          <DialogTitle className="font-heading font-bold text-xl">Consent & Acknowledgment</DialogTitle>
        </DialogHeader>
        <div className="p-8 pt-4 text-sm leading-relaxed" style={{ color: "var(--color-body-text)" }}>
          {cfg.consentText}
        </div>
        <div className="flex items-start gap-3 px-8 py-2">
          <Checkbox id="consent" checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} />
          <label htmlFor="consent" className="text-sm cursor-pointer leading-tight">
            I have read and agree to the above terms and conditions.
          </label>
        </div>
        <DialogFooter className="p-8 pt-4">
          <button onClick={onClose} className="btn-outline px-5 py-2.5 text-sm font-medium">Cancel</button>
          <button onClick={handleConfirm} disabled={!agreed}
            className="btn-primary px-5 py-2.5 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
            Confirm & Add to Cart
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
