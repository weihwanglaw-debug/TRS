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

import { useEffect, useMemo, useState } from "react";
import type { Program, CustomField, ProgramFields, BadmintonClub } from "@/types/config";
import { CheckCircle, XCircle, Paperclip } from "lucide-react";
import { apiGetBadmintonClubs, assetUrl } from "@/lib/api";
import { singaporeDateKey } from "@/lib/eventUtils";

// ── Constants (shared with both consumers) ────────────────────────────────────

export const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
export const DAYS  = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));
export const YEARS = Array.from({ length: 100 }, (_, i) => String(new Date().getFullYear() - i));
export const TSHIRT_SIZES = ["XS","S","M","L","XL","XXL","3XL"];
const CLUB_NO_CLUB_VALUE = "* No Club";
const LEGACY_CLUB_NA_VALUE = "NA";
const CLUB_OTHERS_VALUE = "__others__";
const ALLOWED_DOCUMENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 10 * 1024 * 1024;

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
  program:    Pick<Program, "minAge" | "maxAge" | "gender" | "fields">;
  /** All values in the same submission (for in-cart duplicate check). */
  allValues?: ParticipantFormValues[];
  /** Index of this participant within allValues — skipped in dupe check. */
  selfIndex?: number;
}

const normalizeName = (name: string) =>
  name.trim().replace(/\s+/g, " ").toLowerCase();

export function customFieldValueKey(cf: CustomField): string {
  const id = cf.customFieldId ?? cf.id;
  return id != null ? String(id) : "";
}

function customFieldValue(values: Record<string, string>, cf: CustomField): string {
  return values[customFieldValueKey(cf)] ?? "";
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

  if (!v.dobDay || !v.dobMonth || !v.dobYear) {
    errs.dob = "Complete date required";
  } else {
    const monthIdx = MONTHS.indexOf(v.dobMonth);

    if (monthIdx === -1) {
      errs.dob = "Invalid month";
    } else {
      const dob = new Date(+v.dobYear, monthIdx, +v.dobDay);
      const dobKey = `${v.dobYear}-${String(monthIdx + 1).padStart(2, "0")}-${v.dobDay}`;
      const todayKey = singaporeDateKey();

      const isValidDate =
        dob.getFullYear() === +v.dobYear &&
        dob.getMonth() === monthIdx &&
        dob.getDate() === +v.dobDay;

      if (!isValidDate) {
        errs.dob = "Invalid date";
      } else if (dobKey > todayKey) {
        errs.dob = "Date of birth cannot be in the future";
      } else {
        const [todayYear, todayMonth, todayDay] = todayKey.split("-").map(Number);
        let age = todayYear - +v.dobYear;

        const mDiff = todayMonth - (monthIdx + 1);

        if (
          mDiff < 0 ||
          (mDiff === 0 && todayDay < +v.dobDay)
        ) {
          age--;
        }

        if (
          (program.minAge > 0 || program.maxAge > 0) &&
          (age < program.minAge || age > program.maxAge)
        ) {
          errs.dob = `Age must be ${program.minAge}–${program.maxAge}`;
        }
      }
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
  if (program.fields.enableTshirt && program.fields.requireTshirt && !v.tshirtSize)
    errs.tshirtSize = "Required";
  if (program.fields.enableGuardianInfo && program.fields.requireGuardianInfo) {
    if (!v.guardianName?.trim())    errs.guardianName    = "Required";
    if (!v.guardianContact?.trim()) errs.guardianContact = "Required";
  }
  if (program.fields.enableSbaId && program.fields.requireSbaId && !v.sbaId?.trim())
    errs.sbaId = "Required";
  if (program.fields.enableDocumentUpload && program.fields.requireDocumentUpload && !v.documentFile)
    errs.documentUpload = "Required";
  if (program.fields.enableRemark && program.fields.requireRemark && !v.remark?.trim())
    errs.remark = "Required";

  // Required custom fields
  for (const cf of program.fields.customFields) {
    if (cf.required && !customFieldValue(v.customFieldValues, cf).trim())
      errs[`custom.${cf.label}`] = "Required";
  }

  // In-cart duplicate check (same fullName + DOB as another participant in this submission)
  if (allValues.length > 1) {
    const dupe = allValues.some((other, i) => {
      if (i === selfIndex) return false;
      return (
        normalizeName(other.fullName) === normalizeName(v.fullName) &&
        other.dobDay   === v.dobDay &&
        other.dobMonth === v.dobMonth &&
        other.dobYear  === v.dobYear
      );
    });
    if (dupe && !errs.fullName) errs.fullName = "Duplicate participant in this submission";
  }

  if (
    program.fields.enableDocumentUpload &&
    v.documentFile
  ) {
    if (!ALLOWED_DOCUMENT_TYPES.includes(v.documentFile.type)) {
      errs.documentUpload =
        "Only PDF, JPG, PNG and WEBP files are allowed";
    }

    const maxSizeBytes = v.documentFile.type === "application/pdf" ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;

    if (v.documentFile.size > maxSizeBytes) {
      errs.documentUpload =
        v.documentFile.type === "application/pdf" ? "Maximum PDF size is 10MB" : "Maximum image size is 5MB";
    }
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
    dobDay:   String(parseInt(parts[2], 10)).padStart(2, "0"),
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

export function FieldWrapper({
  label, error, children,
}: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className={error ? "registration-field-error" : undefined}>
      <label className="registration-form-label">{label}</label>
      {children}
      {error && (
        <p className="registration-form-error text-xs mt-1 font-semibold">
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

  eventType?: string;
}

export default function ParticipantFieldsForm({
  values, onChange, programFields, errors, disabled = false,
  onFileChange, existingDocUrl, newFile,
  sbaEnabled = false, sbaStatus = "idle", onSbaRetrieve, onSbaIdChange,
  suggestions, onApplySuggestion,
  nationalityOptions,
  eventType,
}: ParticipantFieldsFormProps) {

  const set = (patch: Partial<ParticipantFormValues>) => onChange(patch);
  const setCustom = (cf: CustomField, value: string) =>
    set({ customFieldValues: { ...values.customFieldValues, [customFieldValueKey(cf)]: value } });

  const sbaLocked = sbaStatus === "found";
  const isBadminton = eventType?.toLowerCase() === "badminton";
  const [badmintonClubs, setBadmintonClubs] = useState<BadmintonClub[]>([]);
  const [clubSelectValue, setClubSelectValue] = useState("");
  const [otherClubName, setOtherClubName] = useState("");

  useEffect(() => {
    if (!isBadminton) return;

    apiGetBadmintonClubs().then(r => {
      if (r.data) setBadmintonClubs(r.data);
    });
  }, [isBadminton]);

  const clubNames = useMemo(
    () => badmintonClubs.map(c => c.name),
    [badmintonClubs],
  );

  useEffect(() => {
    if (!isBadminton) return;

    const savedClub = values.clubSchoolCompany ?? "";
    if (!savedClub) {
      if (clubSelectValue === CLUB_OTHERS_VALUE) return;

      setClubSelectValue("");
      setOtherClubName("");
      return;
    }

    if (savedClub === CLUB_NO_CLUB_VALUE || savedClub === LEGACY_CLUB_NA_VALUE) {
      setClubSelectValue(CLUB_NO_CLUB_VALUE);
      setOtherClubName("");
      if (savedClub !== CLUB_NO_CLUB_VALUE) {
        set({ clubSchoolCompany: CLUB_NO_CLUB_VALUE });
      }
      return;
    }

    if (clubNames.includes(savedClub)) {
      setClubSelectValue(savedClub);
      setOtherClubName("");
      return;
    }

    setClubSelectValue(CLUB_OTHERS_VALUE);
    setOtherClubName(savedClub);
  }, [clubNames, isBadminton, values.clubSchoolCompany]);

  return (
    <div className="grid sm:grid-cols-2 gap-5">

      {/* ── SBA ID (conditional) ── */}
      {programFields.enableSbaId && (
        <div className="sm:col-span-2">
          <FieldWrapper label={`SBA ID${programFields.requireSbaId ? " *" : ""}`} error={errors.sbaId}>
            {sbaEnabled && onSbaRetrieve ? (
              // Registration flow: SBA lookup button
              <>
                <div className="flex gap-2">
                  <input
                    className="field-input flex-1 font-mono"
                    value={values.sbaId ?? ''}                   
                    disabled={disabled}
                    onChange={e => {
                      onSbaIdChange?.(e.target.value);
                      set({ sbaId: e.target.value });
                    }}
                    onKeyDown={e => {
                      if (e.key === "Enter" && !disabled && sbaStatus !== "loading") {
                        e.preventDefault();
                        onSbaRetrieve?.();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={onSbaRetrieve}
                    disabled={disabled || sbaStatus === "loading"}
                    className="btn-primary px-4 py-2 text-sm font-semibold"
                  >
                    {sbaStatus === "loading" ? "Loading…" : "Retrieve"}
                  </button>
                </div>
                {sbaStatus === "found" && (
                  <p className="text-xs mt-1 flex items-center gap-1"
                    style={{ color: "var(--badge-closed-text)" }}>
                    <CheckCircle className="h-3 w-3" />
                    Details auto-filled. Clear the SBA ID to edit manually.
                  </p>
                )}
                {sbaStatus === "not_found" && (
                  <p className="text-xs mt-1 flex items-center gap-1"
                    style={{ color: "var(--color-primary)" }}>
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
      <FieldWrapper label="Full Name (as per NRIC/Passport) *" error={errors.fullName}>
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
      <FieldWrapper label="Date of Birth *" error={errors.dob}>
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
      <FieldWrapper label="Gender *" error={errors.gender}>
        <select className="field-input" value={values.gender}
          disabled={disabled}
          style={sbaLocked ? { opacity: 0.6 } : undefined}
          onChange={e => set({ gender: e.target.value })}>
          <option value="">Select</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
        </select>
      </FieldWrapper>

      {/* ── Email ── */}
      <FieldWrapper label="Email *" error={errors.email}>
        <input type="email" className="field-input" value={values.email}
          disabled={disabled}
          onChange={e => set({ email: e.target.value })} />
      </FieldWrapper>

      {/* ── Contact Number ── */}
      <FieldWrapper label="Contact Number *" error={errors.contactNumber}>
        <input className="field-input" value={values.contactNumber}
          disabled={disabled}
          onChange={e => set({ contactNumber: e.target.value })} />
      </FieldWrapper>

      {/* ── Nationality ── */}
      <FieldWrapper label="Nationality *" error={errors.nationality}>
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
      <FieldWrapper label={`${isBadminton ? "Club" : "Club / School / Company"} *`} error={errors.clubSchoolCompany}>
        {isBadminton ? (
          <>
            <select className="field-input" value={clubSelectValue}
              disabled={disabled}
              onChange={e => {
                const next = e.target.value;
                setClubSelectValue(next);

                if (next === CLUB_OTHERS_VALUE) {
                  setOtherClubName("");
                  set({ clubSchoolCompany: "" });
                  return;
                }

                if (!next) {
                  setOtherClubName("");
                }

                set({ clubSchoolCompany: next });
              }}>
              <option value="">Select club</option>
              <option value={CLUB_NO_CLUB_VALUE}>{CLUB_NO_CLUB_VALUE}</option>
              {badmintonClubs.map(club => (
                <option key={club.clubId} value={club.name}>{club.name}</option>
              ))}
              <option value={CLUB_OTHERS_VALUE}>Others</option>
            </select>

            {clubSelectValue === CLUB_OTHERS_VALUE && (
              <input className="field-input mt-2" value={otherClubName}
                disabled={disabled}
                onChange={e => {
                  setOtherClubName(e.target.value);
                  set({ clubSchoolCompany: e.target.value });
                }} />
            )}
          </>
        ) : (
          <input className="field-input" value={values.clubSchoolCompany}
            disabled={disabled}
            onChange={e => set({ clubSchoolCompany: e.target.value })} />
        )}
      </FieldWrapper>

      {/* ── T-Shirt Size (conditional) ── */}
      {programFields.enableTshirt && (
        <FieldWrapper label={`T-Shirt Size${programFields.requireTshirt ? " *" : ""}`} error={errors.tshirtSize}>
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
          <FieldWrapper label={`Guardian Name${programFields.requireGuardianInfo ? " *" : ""}`} error={errors.guardianName}>
            <input className="field-input" value={values.guardianName ?? ''}
              disabled={disabled}
              onChange={e => set({ guardianName: e.target.value })} />
          </FieldWrapper>
          <FieldWrapper label={`Guardian Contact Number${programFields.requireGuardianInfo ? " *" : ""}`} error={errors.guardianContact}>
            <input className="field-input" value={values.guardianContact ?? ''}
              disabled={disabled}
              onChange={e => set({ guardianContact: e.target.value })} />
          </FieldWrapper>
        </>
      )}

      {/* ── Document Upload (conditional) ── */}
      {programFields.enableDocumentUpload && (
        <div className="sm:col-span-2">
          <FieldWrapper label={`Document Upload (PDF/JPG/PNG/WEBP)${programFields.requireDocumentUpload ? " *" : ""}`} error={errors.documentUpload}>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              className="field-input"
              disabled={disabled}
              onChange={e => {
                const file = e.target.files?.[0] ?? null;

                if (!file) {
                  onFileChange?.(null);
                  return;
                }

                if (!ALLOWED_DOCUMENT_TYPES.includes(file.type)) {
                  alert("Only PDF, JPG, PNG and WEBP files are allowed.");
                  e.target.value = "";
                  return;
                }

                const maxSizeBytes = file.type === "application/pdf" ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;

                if (file.size > maxSizeBytes) {
                  alert(file.type === "application/pdf" ? "Maximum PDF size is 10MB." : "Maximum image size is 5MB.");
                  e.target.value = "";
                  return;
                }

                onFileChange?.(file);
              }}
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
      {programFields.customFields.map((cf, index) => (
        <FieldWrapper
          key={`${cf.label}-${index}`}
          label={`${cf.label}${cf.required ? " *" : ""}`}
          error={errors[`custom.${cf.label}`]}
        >
          <CustomFieldInput
            cf={cf}
            value={customFieldValue(values.customFieldValues, cf)}
            onChange={v => setCustom(cf, v)}
            disabled={disabled}
          />
        </FieldWrapper>
      ))}

      {/* ── Remark (conditional) ── */}
      {programFields.enableRemark && (
        <div className="sm:col-span-2">
          <FieldWrapper label={`Remark${programFields.requireRemark ? " *" : ""}`} error={errors.remark}>
            <textarea className="field-input" rows={2} value={values.remark ?? ''}
              disabled={disabled}
              onChange={e => set({ remark: e.target.value })} />
          </FieldWrapper>
        </div>
      )}
    </div>
  );
}
