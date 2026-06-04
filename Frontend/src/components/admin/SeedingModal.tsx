/**
 * SeedingModal.tsx
 *
 * Loads confirmed participants for a program via apiGetRegistrations(),
 * renders them for manual seeding, then persists via apiUpdateGroupSeed().
 *
 * Mock:  both API functions operate on in-memory stores
 * Real:  swap registrationsApi.ts bodies — no changes needed here
 */

import { useState, useEffect, useMemo } from "react";
import { Download, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { apiGetRegistrations, apiUpdateGroupSeed } from "@/lib/api";
import type { ParticipantGroup } from "@/lib/api";

interface SeedingModalProps {
  open:      boolean;
  onClose:   () => void;
  eventId:   string;   // needed to filter registrations
  programId: string;
}

interface SeedRow {
  registrationId: string;
  groupId:        string;
  namesDisplay:   string;
  clubDisplay:    string;
  currentSeed:    number | null;
  editSeed:       string;  // string for controlled input
}

export default function SeedingModal({ open, onClose, eventId, programId }: SeedingModalProps) {
  const [mode,      setMode]      = useState<"import" | "manual">("manual");
  const [finalized, setFinalized] = useState(false);
  const [rows,      setRows]      = useState<SeedRow[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState("");

  // Load participants when modal opens
  useEffect(() => {
    if (!open || !eventId || !programId) return;
    setLoading(true);
    setError("");
    setFinalized(false);

    apiGetRegistrations(
      { eventId, programId },  // include Pending + Confirmed; exclude Cancelled via groupStatus filter
      { page: 1, pageSize: 200 },
    ).then(r => {
      if (r.error) { setError(r.error.message); return; }
      const groups: ParticipantGroup[] = (r.data?.items ?? [])
        .flatMap(reg => reg.groups.filter(g => g.programId === programId && g.groupStatus !== "Cancelled"));
      setRows(groups.map(g => ({
        registrationId: g.registrationId,
        groupId:        g.id,
        namesDisplay:   g.namesDisplay,
        clubDisplay:    g.clubDisplay,
        currentSeed:    g.seed,
        editSeed:       g.seed != null ? String(g.seed) : "",
      })));
    }).finally(() => setLoading(false));
  }, [open, eventId, programId]);

  const setSeedVal = (groupId: string, val: string) =>
    setRows(prev => prev.map(r => r.groupId === groupId ? { ...r, editSeed: val } : r));

  const seedNums  = rows.map(r => parseInt(r.editSeed)).filter(n => !isNaN(n) && n > 0);
  const hasDups   = seedNums.length !== new Set(seedNums).size;
  const hasChange = rows.some(r => {
    const parsed = r.editSeed === "" ? null : parseInt(r.editSeed);
    return parsed !== r.currentSeed;
  });

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const changed = rows.filter(r => {
        const parsed = r.editSeed === "" ? null : parseInt(r.editSeed);
        return parsed !== r.currentSeed;
      });
      for (const row of changed) {
        const seed = row.editSeed === "" ? null : parseInt(row.editSeed);
        const result = await apiUpdateGroupSeed(row.registrationId, row.groupId, isNaN(seed as number) ? null : seed);
        if (result.error) { setError(result.error.message); return; }
        // update local state to reflect saved value
        setRows(prev => prev.map(r => r.groupId === row.groupId
          ? { ...r, currentSeed: seed, editSeed: seed != null ? String(seed) : "" }
          : r
        ));
      }
      toast.success("Seeding saved.");
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const canSave = finalized && !hasDups && !saving && hasChange;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg p-0"
        style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)" }}>
        <DialogHeader className="p-8 pb-0">
          <DialogTitle className="font-heading font-bold text-xl">Seeding Configuration</DialogTitle>
        </DialogHeader>

        <div className="p-8 pt-6">
          {/* Mode tabs */}
          <div className="flex gap-2 mb-6">
            {(["manual", "import"] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className="px-4 py-2.5 text-sm font-semibold transition-colors"
                style={{
                  backgroundColor: mode === m ? "var(--color-primary)" : "transparent",
                  color:  mode === m ? "var(--color-hero-text)" : "var(--color-body-text)",
                  border: `1px solid ${mode === m ? "var(--color-primary)" : "var(--color-table-border)"}`,
                }}>
                {m === "manual" ? "Manual Entry" : "File Import"}
              </button>
            ))}
          </div>

          {mode === "import" ? (
            <div className="space-y-5">
              <button className="btn-outline flex items-center gap-2 px-4 py-2.5 text-sm font-medium w-full justify-center">
                <Download className="h-4 w-4" /> Download Blank Template
              </button>
              <div>
                <label className="block text-xs font-semibold mb-2 opacity-70">Upload Completed File</label>
                <input type="file" accept=".xlsx,.csv" className="field-input" />
              </div>
            </div>
          ) : (
            <div>
              {loading && (
                <div className="flex items-center gap-2 py-8 justify-center opacity-40 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading participants…
                </div>
              )}
              {error && (
                <p className="text-xs px-3 py-2 mb-3 font-medium"
                  style={{ backgroundColor: "var(--badge-closed-bg)", color: "var(--badge-closed-text)" }}>
                  {error}
                </p>
              )}
              {!loading && rows.length === 0 && !error && (
                <div className="text-center py-8 opacity-40 text-sm">
                  No confirmed participants for this program.
                </div>
              )}
              {!loading && rows.length > 0 && (
                <>
                  {hasDups && (
                    <p className="text-xs px-3 py-2 mb-3 font-semibold"
                      style={{ backgroundColor: "var(--badge-closed-bg)", color: "var(--badge-closed-text)" }}>
                      ⚠ Duplicate seed numbers — each must be unique.
                    </p>
                  )}
                  <div className="overflow-auto" style={{ border: "1px solid var(--color-table-border)", maxHeight: 300 }}>
                    <table className="trs-table">
                      <thead style={{ position: "sticky", top: 0 }}>
                        <tr><th>Players</th><th>Club</th><th style={{ width: 100 }}>Seed</th></tr>
                      </thead>
                      <tbody>
                        {rows.map(row => {
                          const isDup = row.editSeed !== "" && rows.filter(r => r.editSeed === row.editSeed && r.editSeed !== "").length > 1;
                          return (
                            <tr key={row.groupId} style={isDup ? { backgroundColor: "var(--badge-closed-bg)" } : undefined}>
                              <td className="text-sm font-medium">{row.namesDisplay}</td>
                              <td className="text-xs opacity-60">{row.clubDisplay}</td>
                              <td>
                                <div className="flex items-center gap-1">
                                  <input type="number" min={1} className="field-input py-1 text-sm text-center"
                                    style={{ width: "3.5rem", borderColor: isDup ? "var(--badge-closed-text)" : undefined }}
                                    value={row.editSeed} placeholder="—"
                                    onChange={e => setSeedVal(row.groupId, e.target.value)} />
                                  {row.editSeed !== "" && (
                                    <button onClick={() => setSeedVal(row.groupId, "")}
                                      className="text-xs opacity-30 hover:opacity-70">✕</button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="mt-6 pt-5" style={{ borderTop: "1px solid var(--color-table-border)" }}>
            <label className="flex items-center justify-between gap-3 text-sm cursor-pointer p-3"
              style={{ border: "1px solid var(--color-table-border)" }}>
              <span>Finalize seeding (required before fixture generation)</span>
              <Switch checked={finalized} onCheckedChange={setFinalized} />
            </label>
          </div>
        </div>

        <DialogFooter className="p-8 pt-0">
          <button onClick={onClose} className="btn-outline px-5 py-2.5 text-sm font-medium">Cancel</button>
          <button onClick={handleSave} disabled={!canSave}
            className="btn-primary px-5 py-2.5 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? "Saving…" : "Save Seeding"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
