import { useState, useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { apiGetSbaRankingTypes } from "@/lib/api";
import type { Program, SbaRankingType } from "@/types/config";

// ── Program type definitions ─────────────────────────────────────────────────

/**
 * Canonical program type values stored in Programs.Type.
 *   singles  – 1 player per entry  (racket sports: individual events)
 *   doubles  – 2 players per entry (racket sports: pair events)
 *   team     – N players per entry (team sports: basketball, football, etc.)
 *   individual – 1 player per entry, no head-to-head (swimming heats, athletics, etc.)
 *   mixed    – catch-all for non-sports or custom programs
 */
export type ProgramType = "singles" | "doubles" | "team" | "individual" | "mixed";

interface ProgramTypeOption {
  value: ProgramType;
  label: string;
  minPlayers: number;
  maxPlayers: number;
}

/** Types available for racket sports (badminton, tennis, squash, etc.) */
const RACKET_PROGRAM_TYPES: ProgramTypeOption[] = [
  { value: "singles",  label: "Singles",       minPlayers: 1, maxPlayers: 1 },
  { value: "doubles",  label: "Doubles",        minPlayers: 2, maxPlayers: 2 },
];

/** Types available for team sports (basketball, football, etc.) */
const TEAM_PROGRAM_TYPES: ProgramTypeOption[] = [
  { value: "team", label: "Team", minPlayers: 5, maxPlayers: 15 },
];

/** Types available for individual/other sports (swimming, athletics, gymnastics, etc.) */
const INDIVIDUAL_PROGRAM_TYPES: ProgramTypeOption[] = [
  { value: "individual", label: "Individual", minPlayers: 1, maxPlayers: 1 },
  { value: "team",       label: "Team Relay", minPlayers: 2, maxPlayers: 8 },
];

/** Fallback types for non-sports or unknown */
const DEFAULT_PROGRAM_TYPES: ProgramTypeOption[] = [
  { value: "singles",    label: "Singles / Individual", minPlayers: 1, maxPlayers: 1 },
  { value: "doubles",    label: "Pairs",                minPlayers: 2, maxPlayers: 2 },
  { value: "team",       label: "Team",                 minPlayers: 2, maxPlayers: 20 },
  { value: "mixed",      label: "Other / Mixed",        minPlayers: 1, maxPlayers: 99 },
];

function getProgramTypes(isRacketSport: boolean, isTeamSport: boolean): ProgramTypeOption[] {
  if (isRacketSport) return RACKET_PROGRAM_TYPES;
  if (isTeamSport)   return TEAM_PROGRAM_TYPES;
  return INDIVIDUAL_PROGRAM_TYPES.length ? INDIVIDUAL_PROGRAM_TYPES : DEFAULT_PROGRAM_TYPES;
}

/** Derive ProgramType from SBA ranking type label (badminton-specific shortcut). */
function sbaTypeToProgType(sbaType: SbaRankingType | undefined): ProgramType {
  if (!sbaType) return "singles";
  return sbaType.players === 2 ? "doubles" : "singles";
}

// ── Supporting types ─────────────────────────────────────────────────────────

const FIELD_TYPES = [
  { value: "text",   label: "Text" },
  { value: "number", label: "Number" },
  { value: "date",   label: "Date (Calendar)" },
  { value: "select", label: "Dropdown (Options)" },
];

type CF = { label: string; type: string; mandatory: boolean; options: string };

interface Props {
  open:          boolean;
  onClose:       () => void;
  onSave:        (program: Program) => void;
  program:       Program | null;
  isBadminton?:  boolean;   // true → show SBA ranking type dropdown + SBA ID field
  isRacketSport?: boolean;  // true → singles/doubles type selection
  isTeamSport?:  boolean;   // true → team type, configurable squad size
  sportType?:    string;    // display label only (e.g. "Basketball")
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ProgramModal({
  open, onClose, onSave, program,
  isBadminton  = false,
  isRacketSport = false,
  isTeamSport  = false,
  sportType    = "",
}: Props) {
  const isEdit = !!program;
  const programTypes = getProgramTypes(isRacketSport, isTeamSport);
  const defaultType  = programTypes[0];

  const [form, setForm] = useState({
    name:            "",
    type:            defaultType.value as ProgramType,
    sbaRankingType:  "",
    gender:          "Mixed",
    minAge:          18,
    maxAge:          45,
    fee:             "0.00",
    paymentRequired: true,
    feeStructure:    "per_entry" as "per_entry" | "per_player",
    minPlayers:      defaultType.minPlayers,
    maxPlayers:      defaultType.maxPlayers,
    minParticipants: 4,
    maxParticipants: 32,
    enableSbaId:          false,
    enableDocumentUpload: false,
    enableGuardianInfo:   false,
    enableRemark:         false,
    enableTshirt:         true,
    customFields:         [] as CF[],
  });

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [sbaTypes,   setSbaTypes]   = useState<SbaRankingType[]>([]);

  // Load SBA types once when modal opens for a badminton event
  useEffect(() => {
    if (!open || !isBadminton) return;
    apiGetSbaRankingTypes().then(r => { if (r.data) setSbaTypes(r.data); });
  }, [open, isBadminton]);

  // Populate form when modal opens (create or edit)
  useEffect(() => {
    if (!open) return;
    if (program) {
      // Edit: restore saved values
      setForm({
        name:            program.name,
        type:            (program.type as ProgramType) || defaultType.value,
        sbaRankingType:  program.sbaRankingType ?? "",
        gender:          program.gender,
        minAge:          program.minAge,
        maxAge:          program.maxAge,
        fee:             program.fee.toFixed(2),
        paymentRequired: program.paymentRequired ?? true,
        feeStructure:    program.feeStructure ?? "per_entry",
        minPlayers:      program.minPlayers,
        maxPlayers:      program.maxPlayers,
        minParticipants: program.minParticipants ?? 4,
        maxParticipants: program.maxParticipants,
        enableSbaId:          isBadminton ? program.fields.enableSbaId : false,
        enableDocumentUpload: program.fields.enableDocumentUpload,
        enableGuardianInfo:   program.fields.enableGuardianInfo,
        enableRemark:         program.fields.enableRemark ?? false,
        enableTshirt:         program.fields.enableTshirt ?? true,
        customFields: program.fields.customFields.map(cf => ({
          label:     cf.label,
          type:      (cf as any).fieldType ?? cf.type,     // backend may return fieldType
          mandatory: (cf as any).isRequired ?? cf.required, // backend may return isRequired
          options:   cf.options || "",
        })),
      });
    } else {
      // Create: reset to defaults for current sport context
      setForm({
        name: "", type: defaultType.value, sbaRankingType: "",
        gender: "Mixed", minAge: 18, maxAge: 45,
        fee: "0.00", paymentRequired: true, feeStructure: "per_entry",
        minPlayers: defaultType.minPlayers, maxPlayers: defaultType.maxPlayers,
        minParticipants: 4, maxParticipants: isTeamSport ? 16 : 32,
        enableSbaId: false, enableDocumentUpload: false,
        enableGuardianInfo: false, enableRemark: false, enableTshirt: true,
        customFields: [],
      });
    }
    setFormErrors({});
  }, [program, open, isBadminton, isTeamSport]);

  const s = (k: string, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  /** Called when user picks a program type from the type selector (non-badminton). */
  const selectProgramType = (value: ProgramType) => {
    const opt = programTypes.find(t => t.value === value) ?? defaultType;
    setForm(p => ({
      ...p,
      type:       opt.value,
      minPlayers: opt.minPlayers,
      maxPlayers: opt.maxPlayers,
    }));
  };

  /** Called when user picks an SBA ranking type (badminton only).
   *  Derives program type, player count, gender, and age from SBA metadata. */
  const selectSbaType = (value: string) => {
    const selected = sbaTypes.find(t => t.value === value);
    const progType = sbaTypeToProgType(selected);
    setForm(p => ({
      ...p,
      sbaRankingType: value,
      name:           value,
      type:           progType,
      gender:         selected?.gender  ?? p.gender,
      minAge:         selected?.minAge  ?? p.minAge,
      maxAge:         selected?.maxAge  ?? p.maxAge,
      minPlayers:     selected?.players ?? p.minPlayers,
      maxPlayers:     selected?.players ?? p.maxPlayers,
      enableSbaId:    true,
    }));
  };

  const addCF = () => s("customFields", [...form.customFields, { label: "", type: "text", mandatory: false, options: "" }]);
  const upCF  = (i: number, k: string, v: unknown) =>
    s("customFields", form.customFields.map((cf, idx) => idx === i ? { ...cf, [k]: v } : cf));
  const delCF = (i: number) => s("customFields", form.customFields.filter((_, idx) => idx !== i));

  const handleSave = () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim())                           errs.name     = "Program name is required";
    if (isBadminton && !form.sbaRankingType.trim())  errs.sbaType  = "SBA ranking type is required";
    if (!form.type)                                  errs.type     = "Program type is required";
    if (form.gender === "Mixed" && (form.minPlayers !== 2 || form.maxPlayers !== 2))
                               errs.players  = "Mixed gender requires exactly 2 players per entry (1 Male + 1 Female).";
    if (form.minAge > form.maxAge)                   errs.ageRange = "Min age must be ≤ max age";
    if (form.minPlayers > form.maxPlayers)           errs.players  = "Min players must be ≤ max players";
    if (form.minParticipants > form.maxParticipants) errs.parts    = "Min participants must be ≤ max";
    if (parseFloat(form.fee) < 0)                    errs.fee      = "Fee cannot be negative";
    setFormErrors(errs);
    if (Object.keys(errs).length > 0) return;

    onSave({
      id:             program?.id || "",
      name:           form.name,
      type:           form.type,                          // ← fixed: actual type value, not form.name
      sbaRankingType: form.sbaRankingType || null,
      gender:         form.gender,
      minAge:         form.minAge,
      maxAge:         form.maxAge,
      fee:            parseFloat(form.fee) || 0,
      paymentRequired: form.paymentRequired,
      feeStructure:   form.paymentRequired ? form.feeStructure : "per_entry",
      minPlayers:     form.minPlayers,
      maxPlayers:     form.maxPlayers,
      minParticipants:    form.minParticipants,
      maxParticipants:    form.maxParticipants,
      currentParticipants: program?.currentParticipants ?? 0,
      status:         program?.status ?? "open",
      sbaRequired:    false,
      fields: {
        enableSbaId:          form.enableSbaId,
        enableDocumentUpload: form.enableDocumentUpload,
        enableGuardianInfo:   form.enableGuardianInfo,
        enableRemark:         form.enableRemark,
        enableTshirt:         form.enableTshirt,
        customFields: form.customFields.map(cf => ({
          label:    cf.label,
          type:     cf.type,
          required: cf.mandatory,
          options:  cf.options || undefined,
        })),
      },
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto p-0"
        style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)" }}>
        <DialogHeader className="p-8 pb-4">
          <DialogTitle className="font-bold text-xl">{isEdit ? "Edit Program" : "Create Program"}</DialogTitle>
          <p className="text-xs opacity-50 mt-1">
            Fixture format (Knockout, Round Robin, etc.) is chosen when generating the draw — not here.
            Fixture mode is configured at the event level.
          </p>
        </DialogHeader>

        <div className="px-8 pb-8 space-y-7">

          {/* Basic info */}
          <Sec title="Basic Info">
            <div className="grid sm:grid-cols-2 gap-5">

              {/* Program Name — for badminton: SBA category picker drives the name */}
              <div className="sm:col-span-2">
                <Lbl>Program Name *</Lbl>
                {isBadminton ? (
                  <select className="field-input" value={form.sbaRankingType} onChange={e => selectSbaType(e.target.value)}>
                    <option value="">Select SBA ranking type</option>
                    {sbaTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                ) : (
                  <input className="field-input" value={form.name} onChange={e => s("name", e.target.value)}
                    placeholder={isTeamSport ? `e.g. Men's Open ${sportType || "Team"}` : "Program name"} />
                )}
                {formErrors.name    && <Err>{formErrors.name}</Err>}
                {formErrors.sbaType && <Err>{formErrors.sbaType}</Err>}
              </div>

              {/* Program Type — hidden for badminton (auto-derived from SBA type) */}
              {!isBadminton && (
                <div>
                  <Lbl>Program Type *</Lbl>
                  {programTypes.length === 1 ? (
                    // Only one option (e.g. pure team sports) — show as read-only chip
                    <div className="field-input opacity-60 cursor-default select-none">
                      {programTypes[0].label}
                    </div>
                  ) : (
                    <select className="field-input" value={form.type}
                      onChange={e => selectProgramType(e.target.value as ProgramType)}>
                      {programTypes.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  )}
                  {formErrors.type && <Err>{formErrors.type}</Err>}
                </div>
              )}

              {/* Gender */}
              <div>
                <Lbl>Gender</Lbl>
                <select className="field-input" value={form.gender} onChange={e => {
                    const g = e.target.value;
                    setForm(p => ({
                      ...p,
                      gender:     g,
                      // Mixed doubles must be exactly 2 players — enforce immediately
                      minPlayers: g === "Mixed" ? 2 : p.minPlayers,
                      maxPlayers: g === "Mixed" ? 2 : p.maxPlayers,
                    }));
                  }}>
                  <option value="Male">Male only</option>
                  <option value="Female">Female only</option>
                  <option value="Mixed">Mixed (1 Male + 1 Female, doubles only)</option>
                  <option value="Open">Open (no gender restriction)</option>
                </select>
              </div>
            </div>
          </Sec>

          {/* Age */}
          <Sec title="Age Eligibility">
            <div className="grid grid-cols-2 gap-5">
              <div>
                <Lbl>Min Age</Lbl>
                <input type="number" className="field-input" value={form.minAge}
                  onChange={e => s("minAge", +e.target.value)} />
              </div>
              <div>
                <Lbl>Max Age</Lbl>
                <input type="number" className="field-input" value={form.maxAge}
                  onChange={e => s("maxAge", +e.target.value)} />
              </div>
            </div>
            {formErrors.ageRange && <Err>{formErrors.ageRange}</Err>}
          </Sec>

          {/* Capacity */}
          <Sec title="Capacity">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <div><Lbl>Min Entries</Lbl><input type="number" className="field-input" value={form.minParticipants} onChange={e => s("minParticipants", +e.target.value)} /></div>
              <div><Lbl>Max Entries</Lbl><input type="number" className="field-input" value={form.maxParticipants} onChange={e => s("maxParticipants", +e.target.value)} /></div>
              <div>
                <Lbl>Min Players / Entry</Lbl>
                {/* For racket sports with a fixed type, these are auto-set and read-only */}
                <input type="number" className="field-input"
                  value={form.minPlayers}
                  readOnly={isRacketSport || isBadminton}
                  style={{ opacity: (isRacketSport || isBadminton) ? 0.6 : 1 }}
                  onChange={e => s("minPlayers", +e.target.value)} />
              </div>
              <div>
                <Lbl>Max Players / Entry</Lbl>
                <input type="number" className="field-input"
                  value={form.maxPlayers}
                  readOnly={isRacketSport || isBadminton}
                  style={{ opacity: (isRacketSport || isBadminton) ? 0.6 : 1 }}
                  onChange={e => s("maxPlayers", +e.target.value)} />
              </div>
            </div>
            {(isRacketSport || isBadminton) && (
              <p className="text-xs opacity-40 mt-2">
                Players per entry is fixed by program type ({form.type}).
              </p>
            )}
            {formErrors.players && <Err>{formErrors.players}</Err>}
            {formErrors.parts   && <Err>{formErrors.parts}</Err>}
          </Sec>

          {/* Fee */}
          <Sec title="Fee">
            <label className="flex items-center justify-between gap-3 text-sm cursor-pointer p-3 mb-4"
              style={{ border: "1px solid var(--color-table-border)" }}>
              <span className="font-semibold">Payment Required</span>
              <Switch checked={form.paymentRequired}
                onCheckedChange={v => { s("paymentRequired", v); if (!v) s("fee", "0.00"); }} />
            </label>
            {form.paymentRequired ? (
              <div className="space-y-4">
                <div>
                  <Lbl>Registration Fee (SGD)</Lbl>
                  <div className="flex">
                    <span className="px-3 flex items-center text-sm font-semibold opacity-60"
                      style={{ border: "1px solid var(--color-table-border)", borderRight: "none" }}>$</span>
                    <input type="number" step="0.01" min="0" className="field-input w-36"
                      style={{ borderLeft: "none" }} value={form.fee}
                      onChange={e => s("fee", e.target.value)}
                      onBlur={e => s("fee", parseFloat(e.target.value || "0").toFixed(2))} />
                  </div>
                  {formErrors.fee && <Err>{formErrors.fee}</Err>}
                </div>
                <div>
                  <Lbl>Fee Structure</Lbl>
                  <div className="flex gap-0">
                    {([
                      { value: "per_entry",  label: "Per Entry",  desc: "One flat fee for the whole group/team" },
                      { value: "per_player", label: "Per Player", desc: "Fee × each player in the entry" },
                    ] as const).map(opt => (
                      <button key={opt.value} type="button"
                        onClick={() => s("feeStructure", opt.value)}
                        className="flex-1 px-4 py-3 text-left transition-colors"
                        style={{
                          border: `1px solid ${form.feeStructure === opt.value ? "var(--color-primary)" : "var(--color-table-border)"}`,
                          backgroundColor: form.feeStructure === opt.value ? "var(--color-primary)" : "transparent",
                          color: form.feeStructure === opt.value ? "var(--color-hero-text)" : "var(--color-body-text)",
                          marginRight: opt.value === "per_entry" ? "-1px" : 0,
                        }}>
                        <p className="text-sm font-semibold">{opt.label}</p>
                        <p className="text-xs mt-0.5 opacity-70">{opt.desc}</p>
                      </button>
                    ))}
                  </div>
                  {form.feeStructure === "per_player" && form.maxPlayers > 1 && (
                    <p className="text-xs mt-2 opacity-60">
                      e.g. {form.maxPlayers} players × ${parseFloat(form.fee || "0").toFixed(2)} = ${(form.maxPlayers * parseFloat(form.fee || "0")).toFixed(2)} per entry
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs opacity-50">Free entry — no payment will be collected.</p>
            )}
          </Sec>

          {/* Optional fields */}
          <Sec title="Optional Fields">
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                { key: "enableTshirt",        label: "T-Shirt Size" },
                { key: "enableDocumentUpload", label: "Document Upload" },
                { key: "enableGuardianInfo",   label: "Guardian Info" },
                { key: "enableRemark",         label: "Remark Field" },
                // SBA ID lookup — only for badminton events
                ...(isBadminton ? [{ key: "enableSbaId", label: "SBA ID Lookup" }] : []),
              ].map(opt => (
                <label key={opt.key}
                  className="flex items-center justify-between gap-3 text-sm cursor-pointer p-3"
                  style={{ border: "1px solid var(--color-table-border)" }}>
                  <span>{opt.label}</span>
                  <Switch checked={form[opt.key as keyof typeof form] as boolean}
                    onCheckedChange={v => s(opt.key, v)} />
                </label>
              ))}
            </div>
          </Sec>

          {/* Custom fields */}
          <Sec title="Custom Fields">
            <div className="space-y-3">
              {form.customFields.map((cf, idx) => (
                <div key={idx} className="p-4 space-y-3 relative"
                  style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
                  {/* Delete button — top-right of the card */}
                  <button onClick={() => delCF(idx)}
                    className="absolute top-3 right-3 opacity-30 hover:opacity-70 transition-opacity"
                    title="Remove field">
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <div className="flex flex-wrap gap-3 items-end pr-6">
                    <div className="flex-1 min-w-[200px]">
                      <Lbl>Field Label</Lbl>
                      <input className="field-input" placeholder="e.g. Emergency Contact"
                        value={cf.label} onChange={e => upCF(idx, "label", e.target.value)} />
                    </div>
                    <div className="w-48">
                      <Lbl>Column Type</Lbl>
                      <select className="field-input" value={cf.type}
                        onChange={e => upCF(idx, "type", e.target.value)}>
                        {FIELD_TYPES.map(ft => <option key={ft.value} value={ft.value}>{ft.label}</option>)}
                      </select>
                    </div>
                    <div className="flex items-end pb-2">
                      <label className="flex items-center gap-3 text-sm cursor-pointer whitespace-nowrap">
                        <span>Mandatory</span>
                        <Switch checked={cf.mandatory} onCheckedChange={v => upCF(idx, "mandatory", v)} />
                      </label>
                    </div>
                  </div>
                  {cf.type === "select" && (
                    <div>
                      <Lbl>Options <span className="font-normal opacity-50">(comma-separated)</span></Lbl>
                      <input className="field-input" placeholder="XS, S, M, L, XL"
                        value={cf.options} onChange={e => upCF(idx, "options", e.target.value)} />
                      {cf.options && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {cf.options.split(",").map(o => o.trim()).filter(Boolean).map(o => (
                            <span key={o} className="px-2 py-0.5 text-xs font-medium"
                              style={{ backgroundColor: "var(--color-primary)", color: "var(--color-hero-text)" }}>{o}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button onClick={addCF} className="flex items-center gap-1.5 text-sm font-medium mt-3"
              style={{ color: "var(--color-primary)" }}>
              <Plus className="h-4 w-4" /> Add Custom Field
            </button>
          </Sec>
        </div>

        {Object.keys(formErrors).length > 0 && (
          <div className="px-8 pb-2 space-y-1">
            {Object.values(formErrors).map((e, i) => (
              <p key={i} className="text-xs" style={{ color: "var(--badge-open-text)" }}>• {e}</p>
            ))}
          </div>
        )}

        <DialogFooter className="p-8 pt-0">
          <button onClick={onClose} className="btn-outline px-5 py-2.5 text-sm font-medium">Cancel</button>
          <button onClick={handleSave} className="btn-primary px-5 py-2.5 text-sm font-semibold">
            {isEdit ? "Update Program" : "Create Program"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Small layout helpers ──────────────────────────────────────────────────────

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider mb-4 pb-2"
        style={{ borderBottom: "1px solid var(--color-table-border)", color: "var(--color-primary)" }}>
        {title}
      </p>
      {children}
    </div>
  );
}
function Lbl({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-semibold mb-2 opacity-70">{children}</label>;
}
function Err({ children }: { children: React.ReactNode }) {
  return <p className="text-xs mt-1" style={{ color: "var(--badge-open-text)" }}>{children}</p>;
}