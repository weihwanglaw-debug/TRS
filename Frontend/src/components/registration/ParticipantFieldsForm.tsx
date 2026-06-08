/**
 * ParticipantFieldsForm.tsx
 *
 * Shared participant field renderer used by:
 *   - EventDetail.tsx  (public registration form, one form per participant card)
 *   - ParticipantDetails.tsx  (admin edit modal, single participant)
 *
 * Responsibilities:
 *   - Render all fields controlled by ProgramFields config
 *   - Display per-field validation errors (passed in from parent)
 *   - Emit file selection via onFileChange (parent decides when/how to upload)
 *   - Show existing document URL when no new file is staged
 *   - SBA lookup UI (optional — only shown in registration flow)
 *
 * Does NOT own:
 *   - State (fully controlled via values + onChange)
 *   - API calls
 *   - Scroll / focus logic
 *   - Submit / save buttons
 */

import type { Program, CustomField, ProgramFields } from "@/types/config";
import { CheckCircle, XCircle, Paperclip } from "lucide-react";
import { assetUrl } from "@/lib/api";

// ── Constants (shared with both consumers) ────────────────────────────────────

export const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
export const DAYS  = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));
export const YEARS = Array.from({ length: 100 }, (_, i) => String(new Date().getFullYear() - i));
export const TSHIRT_SIZES = ["XS","S","M","L","XL","XXL","3XL"];

// ── Field values shape ────────────────────────────────────────────────────────
// Both consumers read/write this same shape.

export interface ParticipantFormValues {
  fullName:          string;
  dobDay:            string;
  dobMonth:          string;
  dobYear:           string;
  gender:            string;
  email:             string;
  contactNumber:     string;
  nationality:       string;
  clubSchoolCompany: string;
  tshirtSize:        string;
  sbaId?:            string;
  guardianName?:     string;
  guardianContact?:  string;
  remark?:           string;
  customFieldValues: Record<string, string>;
  // Transient — not persisted in DB, only used during registration flow
  documentFile?:     File | null;
}

export function blankParticipantFormValues(): ParticipantFormValues {
  return {
    fullName: "", dobDay: "", dobMonth: "", dobYear: "",
    gender: "", email: "", contactNumber: "", nationality: "",
    clubSchoolCompany: "", tshirtSize: "", sbaId: "",
    guardianName: "", guardianContact: "", remark: "",
    customFieldValues: {}, documentFile: null,
  };
}

// ── Validation ────────────────────────────────────────────────────────────────
// Single validate function used by both consumers.
// Returns a flat errors map keyed by field name.
// Caller passes the result into <ParticipantFieldsForm errors={...} />.

export interface ValidateParticipantOptions {
  program:    Pick<Program, "minAge" | "maxAge" | "gender" | "sbaRequired" | "fields">;
  /** All values in the same submission (for in-cart duplicate check). */
  allValues?: ParticipantFormValues[];
  /** Index of this participant within allValues — skipped in dupe check. */
  selfIndex?: number;
}

export function validateParticipant(
  v: ParticipantFormValues,
  opts: ValidateParticipantOptions,
): Record<string, string> {
  const errs: Record<string, string> = {};
  const { program, allValues = [], selfIndex } = opts;

  if (!v.fullName.trim())          errs.fullName = "Required";
  if (!v.gender)                   errs.gender   = "Required";
  if (!v.email.trim())             errs.email    = "Required";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) errs.email = "Invalid email";
  if (!v.contactNumber.trim())     errs.contactNumber = "Required";
  if (!v.nationality.trim())       errs.nationality   = "Required";
  if (!v.clubSchoolCompany.trim()) errs.clubSchoolCompany = "Required";

  // DOB — completeness
  if (!v.dobDay || !v.dobMonth || !v.dobYear) {
    errs.dob = "Complete date required";
  } else {
    // DOB — age range
    const monthIdx = MONTHS.indexOf(v.dobMonth);
    const dob = new Date(+v.dobYear, monthIdx, +v.dobDay);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const mDiff = today.getMonth() - dob.getMonth();
    if (mDiff < 0 || (mDiff === 0 && today.getDate() < dob.getDate())) age--;
    if (program.minAge > 0 || program.maxAge > 0) {
      if (age < program.minAge || age > program.maxAge)
        errs.dob = `Age must be ${program.minAge}–${program.maxAge}`;
    }
  }

  // Gender restriction (per-participant)
  if (v.gender) {
    if (program.gender === "Male"   && v.gender !== "Male")
      errs.gender = "This program is for Male players only.";
    if (program.gender === "Female" && v.gender !== "Female")
      errs.gender = "This program is for Female players only.";
  }

  // Conditional standard fields
  if (program.fields.enableTshirt && !v.tshirtSize)
    errs.tshirtSize = "Required";
  if (program.fields.enableSbaId && program.sbaRequired && !v.sbaId?.trim())
    errs.sbaId = "SBA ID is required for this program";
  if (program.fields.enableGuardianInfo) {
    if (!v.guardianName?.trim())    errs.guardianName    = "Required";
    if (!v.guardianContact?.trim()) errs.guardianContact = "Required";
  }

  // Required custom fields
  for (const cf of program.fields.customFields) {
    if (cf.required && !v.customFieldValues[cf.label]?.trim())
      errs[`custom.${cf.label}`] = "Required";
  }

  // In-cart duplicate check (same fullName + DOB as another participant in this submission)
  if (allValues.length > 1) {
    const dupe = allValues.some((other, i) => {
      if (i === selfIndex) return false;
      return (
        other.fullName.trim().toLowerCase() === v.fullName.trim().toLowerCase() &&
        other.dobDay   === v.dobDay &&
        other.dobMonth === v.dobMonth &&
        other.dobYear  === v.dobYear
      );
    });
    if (dupe && !errs.fullName) errs.fullName = "Duplicate participant in this submission";
  }

  return errs;
}

// ── Build DOB string from parts ───────────────────────────────────────────────

export function buildDobString(day: string, month: string, year: string): string {
  if (!day || !month || !year) return "";
  const monthIdx = MONTHS.indexOf(month);
  return `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseDobString(dob: string): { dobDay: string; dobMonth: string; dobYear: string } {
  if (!dob) return { dobDay: "", dobMonth: "", dobYear: "" };
  const parts = dob.split("-");
  if (parts.length !== 3) return { dobDay: "", dobMonth: "", dobYear: "" };
  return {
    dobYear:  parts[0],
    dobMonth: MONTHS[parseInt(parts[1], 10) - 1] ?? "",
    dobDay:   String(parseInt(parts[2], 10)),
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

export function FieldWrapper({
  label, error, children,
}: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1.5 opacity-70">{label}</label>
      {children}
      {error && (
        <p className="text-xs mt-1 font-medium" style={{ color: "var(--badge-closed-text)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

function CustomFieldInput({
  cf, value, onChange, disabled,
}: {
  cf: CustomField; value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  if (cf.type === "select" && cf.options) {
    const opts = cf.options.split(",").map((o: string) => o.trim()).filter(Boolean);
    return (
      <select className="field-input" value={value}
        disabled={disabled} onChange={e => onChange(e.target.value)}>
        <option value="">Select…</option>
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (cf.type === "date") {
    return (
      <input type="date" className="field-input" value={value}
        disabled={disabled} onChange={e => onChange(e.target.value)} />
    );
  }
  if (cf.type === "number") {
    return (
      <input type="number" className="field-input" value={value}
        disabled={disabled} onChange={e => onChange(e.target.value)} />
    );
  }
  return (
    <input className="field-input" value={value}
      disabled={disabled} onChange={e => onChange(e.target.value)} />
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface ParticipantFieldsFormProps {
  values:         ParticipantFormValues;
  onChange:       (patch: Partial<ParticipantFormValues>) => void;
  programFields:  ProgramFields;
  errors:         Record<string, string>;       // field → error message
  disabled?:      boolean;

  // Document upload
  onFileChange?:  (file: File | null) => void;  // called when user picks a file
  existingDocUrl?: string;                       // stored URL shown when no new file staged
  newFile?:        File | null;                  // new file staged (from parent state)

  // SBA lookup — only shown in registration flow
  sbaEnabled?:      boolean;
  sbaStatus?:       "idle" | "loading" | "found" | "not_found";
  onSbaRetrieve?:   () => void;
  onSbaIdChange?:   (v: string) => void;        // separate handler for SBA ID so parent
                                                 // can manage sbaStatus reset logic

  // Autofill suggestion dropdown — registration flow only
  suggestions?:    ParticipantFormValues[];
  onApplySuggestion?: (s: ParticipantFormValues) => void;

  // Nationality options — registration flow provides full country list
  nationalityOptions?: { code: string; label: string }[];
}

export default function ParticipantFieldsForm({
  values, onChange, programFields, errors, disabled = false,
  onFileChange, existingDocUrl, newFile,
  sbaEnabled = false, sbaStatus = "idle", onSbaRetrieve, onSbaIdChange,
  suggestions, onApplySuggestion,
  nationalityOptions,
}: ParticipantFieldsFormProps) {

  const set = (patch: Partial<ParticipantFormValues>) => onChange(patch);
  const setCustom = (label: string, value: string) =>
    set({ customFieldValues: { ...values.customFieldValues, [label]: value } });

  const sbaLocked = sbaStatus === "found";

  return (
    <div className="grid sm:grid-cols-2 gap-5">

      {/* ── SBA ID (conditional) ── */}
      {programFields.enableSbaId && (
        <div className="sm:col-span-2">
          <FieldWrapper label="SBA ID" error={errors.sbaId}>
            {sbaEnabled && onSbaRetrieve ? (
              // Registration flow: SBA lookup button
              <>
                <div className="flex gap-2">
                  <input
                    className="field-input flex-1 font-mono"
                    value={values.sbaId ?? ''}
                    placeholder="e.g. SBA-001"
                    disabled={disabled}
                    onChange={e => {
                      onSbaIdChange?.(e.target.value);
                      set({ sbaId: e.target.value });
                    }}
                  />
                  <button
                    type="button"
                    onClick={onSbaRetrieve}
                    disabled={disabled || sbaStatus === "loading"}
                    className="btn-primary px-4 py-2 text-xs font-semibold whitespace-nowrap disabled:opacity-60"
                  >
                    {sbaStatus === "loading" ? "Loading…" : "Retrieve →"}
                  </button>
                </div>
                {sbaStatus === "found" && (
                  <p className="text-xs mt-1 flex items-center gap-1"
                    style={{ color: "var(--badge-open-text)" }}>
                    <CheckCircle className="h-3 w-3" />
                    Details auto-filled. Clear the SBA ID to edit manually.
                  </p>
                )}
                {sbaStatus === "not_found" && (
                  <p className="text-xs mt-1 flex items-center gap-1"
                    style={{ color: "var(--badge-closed-text)" }}>
                    <XCircle className="h-3 w-3" /> SBA ID not found.
                  </p>
                )}
              </>
            ) : (
              // Admin edit: plain text input, no lookup button
              <input className="field-input font-mono" value={values.sbaId ?? ''}
                disabled={disabled}
                onChange={e => set({ sbaId: e.target.value })} />
            )}
          </FieldWrapper>
        </div>
      )}

      {/* ── Full Name ── */}
      <FieldWrapper label="Full Name (as per NRIC/Passport)" error={errors.fullName}>
        <div className="relative">
          <input
            className="field-input"
            value={values.fullName}
            disabled={disabled || sbaLocked}
            style={sbaLocked ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
            onChange={e => set({ fullName: e.target.value })}
            autoComplete="off"
          />
          {/* Autofill suggestion dropdown — registration only */}
          {suggestions && suggestions.length > 0 && onApplySuggestion && (
            <div
              className="absolute z-20 w-full shadow-lg"
              style={{
                backgroundColor: "var(--color-page-bg)",
                border: "1px solid var(--color-table-border)",
                top: "100%",
              }}
            >
              {suggestions.map((s, i) => (
                <button key={i} type="button" onClick={() => onApplySuggestion(s)}
                  className="w-full text-left px-3 py-2.5 text-xs hover:opacity-70 transition-opacity"
                  style={{ borderBottom: "1px solid var(--color-table-border)" }}>
                  <span className="font-semibold">{s.fullName}</span>
                  <span className="opacity-60 ml-2">{s.dobDay} {s.dobMonth} {s.dobYear}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </FieldWrapper>

      {/* ── Date of Birth ── */}
      <FieldWrapper label="Date of Birth" error={errors.dob}>
        <div className="flex gap-2">
          <select className="field-input flex-1" value={values.dobDay}
            disabled={disabled || sbaLocked}
            style={sbaLocked ? { opacity: 0.6 } : undefined}
            onChange={e => set({ dobDay: e.target.value })}>
            <option value="">Day</option>
            {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className="field-input flex-1" value={values.dobMonth}
            disabled={disabled || sbaLocked}
            style={sbaLocked ? { opacity: 0.6 } : undefined}
            onChange={e => set({ dobMonth: e.target.value })}>
            <option value="">Month</option>
            {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <select className="field-input flex-1" value={values.dobYear}
            disabled={disabled || sbaLocked}
            style={sbaLocked ? { opacity: 0.6 } : undefined}
            onChange={e => set({ dobYear: e.target.value })}>
            <option value="">Year</option>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </FieldWrapper>

      {/* ── Gender ── */}
      <FieldWrapper label="Gender" error={errors.gender}>
        <select className="field-input" value={values.gender}
          disabled={disabled || sbaLocked}
          style={sbaLocked ? { opacity: 0.6 } : undefined}
          onChange={e => set({ gender: e.target.value })}>
          <option value="">Select</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
        </select>
      </FieldWrapper>

      {/* ── Email ── */}
      <FieldWrapper label="Email" error={errors.email}>
        <input type="email" className="field-input" value={values.email}
          disabled={disabled}
          onChange={e => set({ email: e.target.value })} />
      </FieldWrapper>

      {/* ── Contact Number ── */}
      <FieldWrapper label="Contact Number" error={errors.contactNumber}>
        <input className="field-input" value={values.contactNumber}
          disabled={disabled}
          onChange={e => set({ contactNumber: e.target.value })} />
      </FieldWrapper>

      {/* ── Nationality ── */}
      <FieldWrapper label="Nationality" error={errors.nationality}>
        {nationalityOptions ? (
          <select className="field-input" value={values.nationality}
            disabled={disabled}
            onChange={e => set({ nationality: e.target.value })}>
            <option value="">Select nationality</option>
            {nationalityOptions.map(c => (
              <option key={c.code} value={c.code}>{c.label} ({c.code})</option>
            ))}
          </select>
        ) : (
          <input className="field-input" value={values.nationality}
            disabled={disabled}
            onChange={e => set({ nationality: e.target.value })} />
        )}
      </FieldWrapper>

      {/* ── Club / School / Company ── */}
      <FieldWrapper label="Club / School / Company" error={errors.clubSchoolCompany}>
        <input className="field-input" value={values.clubSchoolCompany}
          disabled={disabled}
          onChange={e => set({ clubSchoolCompany: e.target.value })} />
      </FieldWrapper>

      {/* ── T-Shirt Size (conditional) ── */}
      {programFields.enableTshirt && (
        <FieldWrapper label="T-Shirt Size" error={errors.tshirtSize}>
          <select className="field-input" value={values.tshirtSize}
            disabled={disabled}
            onChange={e => set({ tshirtSize: e.target.value })}>
            <option value="">Select</option>
            {TSHIRT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </FieldWrapper>
      )}

      {/* ── Guardian Info (conditional) ── */}
      {programFields.enableGuardianInfo && (
        <>
          <FieldWrapper label="Guardian Name" error={errors.guardianName}>
            <input className="field-input" value={values.guardianName ?? ''}
              disabled={disabled}
              onChange={e => set({ guardianName: e.target.value })} />
          </FieldWrapper>
          <FieldWrapper label="Guardian Contact Number" error={errors.guardianContact}>
            <input className="field-input" value={values.guardianContact ?? ''}
              disabled={disabled}
              onChange={e => set({ guardianContact: e.target.value })} />
          </FieldWrapper>
        </>
      )}

      {/* ── Document Upload (conditional) ── */}
      {programFields.enableDocumentUpload && (
        <div className="sm:col-span-2">
          <FieldWrapper label="Document Upload (PDF/JPG/PNG)" error={errors.documentUpload}>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              className="field-input"
              disabled={disabled}
              onChange={e => onFileChange?.(e.target.files?.[0] ?? null)}
            />
            {/* Show staged new file name */}
            {newFile && (
              <p className="text-xs mt-1 opacity-60">
                Staged: <span className="font-medium">{newFile.name}</span>
                {existingDocUrl && " — will replace current file on save"}
              </p>
            )}
            {/* Show existing file link when no new file staged */}
            {!newFile && existingDocUrl && (
              <div className="flex items-center gap-2 mt-1 text-xs opacity-60">
                <Paperclip className="h-3.5 w-3.5 flex-shrink-0" />
                <span>Current: </span>
                <a
                  href={assetUrl(existingDocUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:opacity-80 truncate"
                  style={{ color: "var(--color-primary)" }}
                >
                  {existingDocUrl.split("/").pop()}
                </a>
                <span className="opacity-50">(select a file above to replace)</span>
              </div>
            )}
          </FieldWrapper>
        </div>
      )}

      {/* ── Custom Fields ── */}
      {programFields.customFields.map(cf => (
        <FieldWrapper
          key={cf.label}
          label={`${cf.label}${cf.required ? " *" : ""}`}
          error={errors[`custom.${cf.label}`]}
        >
          <CustomFieldInput
            cf={cf}
            value={values.customFieldValues[cf.label] ?? ""}
            onChange={v => setCustom(cf.label, v)}
            disabled={disabled}
          />
        </FieldWrapper>
      ))}

      {/* ── Remark (conditional) ── */}
      {programFields.enableRemark && (
        <div className="sm:col-span-2">
          <FieldWrapper label="Remark" error={errors.remark}>
            <textarea className="field-input" rows={2} value={values.remark ?? ''}
              disabled={disabled}
              onChange={e => set({ remark: e.target.value })} />
          </FieldWrapper>
        </div>
      )}
    </div>
  );
}