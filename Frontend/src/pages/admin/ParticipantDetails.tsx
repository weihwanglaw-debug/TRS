/**
 * ParticipantDetails.tsx - Admin participant list and edit modal.
 *
 * Uses ParticipantFieldsForm for all field rendering and validation,
 * keeping logic consistent with the public registration form.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Loader2, Save, Search } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  apiGetRegistration, apiGetRegistrations,
  apiUpdateParticipant, apiGetEvents, apiUploadFile,
} from "@/lib/api";
import type { RegistrationParticipant, ParticipantGroup, Registration } from "@/types/registration";
import type { TournamentEvent, ProgramFields } from "@/types/config";
import ParticipantFieldsForm, {
  ParticipantFormValues,
  validateParticipant, buildDobString, parseDobString,
} from "@/components/registration/ParticipantFieldsForm";

// Types

interface ParticipantRow {
  participant:    RegistrationParticipant;
  group:          ParticipantGroup;
  registration:   Registration;
  eventName:      string;
  programName:    string;
  registrationId: string;
}

interface EntryRow {
  key:            string;
  group:          ParticipantGroup;
  registration:   Registration;
  eventName:      string;
  programName:    string;
  registrationId: string;
  participants:   ParticipantRow[];
}

// Helpers


function FG({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1.5 opacity-60">{label}</label>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const m: Record<string, [string, string]> = {
    Confirmed: ["var(--badge-open-bg)",   "var(--badge-open-text)"],
    Pending:   ["var(--badge-soon-bg)",   "var(--badge-soon-text)"],
    Cancelled: ["var(--badge-closed-bg)", "var(--badge-closed-text)"],
  };
  const [bg, color] = m[status] ?? ["var(--color-row-hover)", "var(--color-body-text)"];
  return (
    <span className="inline-flex px-2 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: bg, color }}>{status}</span>
  );
}

// Convert RegistrationParticipant to ParticipantFormValues

function toFormValues(p: RegistrationParticipant): ParticipantFormValues {
  const { dobDay, dobMonth, dobYear } = parseDobString(p.dob);
  return {
    fullName:          p.fullName,
    dobDay, dobMonth, dobYear,
    gender:            p.gender            ?? "",
    nationality:       p.nationality       ?? "",
    clubSchoolCompany: p.clubSchoolCompany  ?? "",
    email:             p.email             ?? "",
    contactNumber:     p.contactNumber     ?? "",
    tshirtSize:        p.tshirtSize        ?? "",
    sbaId:             p.sbaId             ?? "",
    guardianName:      p.guardianName      ?? "",
    guardianContact:   p.guardianContact   ?? "",
    remark:            p.remark            ?? "",
    customFieldValues: { ...(p.customFieldValues ?? {}) },
    documentFile:      null,
  };
}

// Detail / Edit Modal

interface DetailModalProps {
  row:           ParticipantRow;
  programFields: ProgramFields | null;
  eventType?:    string;
  onClose:       () => void;
  onSaved:       (updated: RegistrationParticipant) => void;
}

function PaymentBadge({ status }: { status?: string }) {
  const m: Record<string, [string, string, string]> = {
    S:  ["Paid", "var(--badge-open-bg)", "var(--badge-open-text)"],
    W:  ["Waived", "var(--badge-soon-bg)", "var(--badge-soon-text)"],
    PC: ["Pending Collection", "var(--badge-soon-bg)", "var(--badge-soon-text)"],
    P:  ["Pending", "var(--badge-soon-bg)", "var(--badge-soon-text)"],
    X:  ["Cancelled", "var(--badge-closed-bg)", "var(--badge-closed-text)"],
    F:  ["Failed", "var(--badge-closed-bg)", "var(--badge-closed-text)"],
  };
  const [label, bg, color] = m[status ?? ""] ?? [status || "-", "var(--color-row-hover)", "var(--color-body-text)"];
  return (
    <span className="inline-flex px-2 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: bg, color }}>{label}</span>
  );
}

function DetailModal({ row, programFields, eventType, onClose, onSaved }: DetailModalProps) {
  const p = row.participant;

  const [form,       setForm]       = useState<ParticipantFormValues>(() => toFormValues(p));
  const [newDocFile, setNewDocFile] = useState<File | null>(null);
  const [errors,     setErrors]     = useState<Record<string, string>>({});
  const [saveError,  setSaveError]  = useState("");
  const [saving,     setSaving]     = useState(false);

  // Ref to scroll to first error
  const topRef = useRef<HTMLDivElement>(null);

  const fields: ProgramFields = programFields ?? {
    enableSbaId: true, enableDocumentUpload: false,
    enableGuardianInfo: false, enableRemark: false,
    enableTshirt: false,
    requireSbaId: false, requireDocumentUpload: false,
    requireGuardianInfo: false, requireRemark: false, requireTshirt: false,
    customFields: [],
  };

  const handleSave = async () => {
    setSaveError("");

    // Client-side validation - same rules as registration form
    // Admin gets no exemption: wrong data is wrong data
    const errs = validateParticipant(form, {
      program: {
        minAge: 0, maxAge: 0,        // age range not enforced on admin edit
        gender: "Open",              // gender rule only enforced at registration time
        fields,
      },
    });

    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      // Scroll to top of modal so errors are visible
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    setErrors({});
    setSaving(true);
    try {
      // Upload new document if chosen
      let finalDocumentUrl = p.documentUrl;
      if (newDocFile) {
        const uploadResult = await apiUploadFile(newDocFile, "participants");
        if (uploadResult.error) {
          setSaveError(`Document upload failed: ${uploadResult.error.message}`);
          return;
        }
        finalDocumentUrl = uploadResult.data;
      }

      const dob = buildDobString(form.dobDay, form.dobMonth, form.dobYear);

      const r = await apiUpdateParticipant(row.registrationId, p.id, {
        fullName:          form.fullName          || undefined,
        dob:               dob                   || undefined,
        gender:            form.gender            || undefined,
        nationality:       form.nationality       || undefined,
        clubSchoolCompany: form.clubSchoolCompany || undefined,
        email:             form.email             || undefined,
        contactNumber:     form.contactNumber     || undefined,
        tshirtSize:        form.tshirtSize        || undefined,
        sbaId:             form.sbaId             || undefined,
        guardianName:      form.guardianName      || undefined,
        guardianContact:   form.guardianContact   || undefined,
        remark:            form.remark            || undefined,
        documentUrl:       finalDocumentUrl       || undefined,
        customFieldValues: fields.customFields.length ? form.customFieldValues : undefined,
      });

      // Server-side duplicate check - map DUPLICATE_PARTICIPANT back to field error
      if (r.error) {
        if (r.error.code === "DUPLICATE_PARTICIPANT") {
          setErrors({ fullName: r.error.message });
          topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        } else {
          setSaveError(r.error.message);
        }
        return;
      }

      onSaved({
        ...p,
        fullName:          form.fullName,
        dob,
        gender:            form.gender,
        nationality:       form.nationality,
        clubSchoolCompany: form.clubSchoolCompany,
        email:             form.email,
        contactNumber:     form.contactNumber,
        tshirtSize:        form.tshirtSize,
        sbaId:             form.sbaId,
        guardianName:      form.guardianName,
        guardianContact:   form.guardianContact,
        remark:            form.remark,
        documentUrl:       finalDocumentUrl,
        customFieldValues: { ...form.customFieldValues },
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-2xl p-0"
        style={{
          backgroundColor: "var(--color-page-bg)",
          border: "1px solid var(--color-table-border)",
          maxHeight: "90vh",
          overflowY: "auto",
        }}>
        <div ref={topRef} />
        <DialogHeader className="p-8 pb-5"
          style={{ borderBottom: "1px solid var(--color-table-border)" }}>
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="font-bold text-xl">{p.fullName}</DialogTitle>
              <p className="text-xs opacity-50 mt-1">
                {row.eventName} - {row.programName} - Reg {row.registrationId}
              </p>
            </div>
            <StatusBadge status={row.group.groupStatus} />
          </div>
        </DialogHeader>

        <div className="p-8 space-y-5">
          {/* Summary error banner - shows when errors exist */}
          {Object.keys(errors).length > 0 && (
            <div className="p-3 text-sm font-medium"
              style={{ backgroundColor: "var(--badge-closed-bg)", color: "var(--badge-closed-text)" }}>
              Please fix the highlighted fields before saving.
            </div>
          )}
          {saveError && (
            <div className="p-3 text-sm"
              style={{ backgroundColor: "var(--badge-closed-bg)", color: "var(--badge-closed-text)" }}>
              {saveError}
            </div>
          )}

          <ParticipantFieldsForm
            values={form}
            onChange={patch => setForm(prev => ({ ...prev, ...patch }))}
            programFields={fields}
            eventType={eventType}
            errors={errors}
            onFileChange={file => { setNewDocFile(file); }}
            existingDocUrl={p.documentUrl}
            newFile={newDocFile}
            // No SBA lookup in admin edit - plain text input only
            sbaEnabled={false}
          />
        </div>

        <DialogFooter className="p-8 pt-0"
          style={{ borderTop: "1px solid var(--color-table-border)" }}>
          <button onClick={onClose}
            className="btn-outline px-5 py-2.5 text-sm font-medium">Cancel</button>
          <button onClick={handleSave}
            disabled={saving || !form.fullName.trim()}
            className="btn-primary px-5 py-2.5 text-sm font-semibold disabled:opacity-40 flex items-center gap-2">
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Main page

export default function ParticipantDetails() {
  const { regId }      = useParams<{ regId: string }>();
  const [searchParams] = useSearchParams();

  const initEventId   = searchParams.get("eventId")   ?? "";
  const initProgramId = searchParams.get("programId") ?? "";
  const initRegId     = regId ?? searchParams.get("regId") ?? "";

  const [filterSearch,  setFilterSearch]  = useState("");
  const [filterEvent,   setFilterEvent]   = useState(initEventId);
  const [filterProgram, setFilterProgram] = useState(initProgramId);
  const [filterRegId,   setFilterRegId]   = useState(initRegId);
  const [rows,    setRows]    = useState<ParticipantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");
  const [events,  setEvents]  = useState<TournamentEvent[]>([]);

  const [detailRow, setDetailRow] = useState<ParticipantRow | null>(null);

  useEffect(() => {
    apiGetEvents().then(r => { if (r.data) setEvents(r.data); });
  }, []);

  const programsForEvent = useMemo(
    () => events.find(e => e.id === filterEvent)?.programs ?? [],
    [events, filterEvent],
  );

  const getProgramFields = useCallback((group: ParticipantGroup): ProgramFields | null => {
    for (const ev of events) {
      const prog = ev.programs.find(p => p.id === group.programId);
      if (prog) return prog.fields;
    }
    return null;
  }, [events]);

  const getEventType = useCallback((group: ParticipantGroup): string | undefined => {
    for (const ev of events) {
      const prog = ev.programs.find(p => p.id === group.programId);
      if (prog) return ev.sportType;
    }
    return undefined;
  }, [events]);

  const loadRows = useCallback(async () => {
    setLoading(true); setError("");
    try {
      let regs: Registration[] = [];
      if (filterRegId.trim()) {
        const r = await apiGetRegistration(filterRegId.trim());
        if (r.error) { setError(r.error.message); return; }
        regs = [r.data!];
      } else {
        const filters: Record<string, string> = {};
        if (filterEvent)   filters.eventId   = filterEvent;
        if (filterProgram) filters.programId = filterProgram;
        const r = await apiGetRegistrations(filters, { page: 1, pageSize: 500 });
        if (r.error) { setError(r.error.message); return; }
        regs = r.data!.items;
      }
      setRows(
        regs.flatMap(reg =>
          reg.groups
            .filter(g => g.groupStatus !== "Cancelled")
            .flatMap(g =>
            g.participants
              .filter(p => p.participantStatus !== "Cancelled")
              .map(p => ({
              participant:    p,
              group:          g,
              registration:   reg,
              eventName:      reg.eventName,
              programName:    g.programName,
              registrationId: reg.id,
            }))
          )
        )
      );
    } finally {
      setLoading(false);
    }
  }, [filterEvent, filterProgram, filterRegId]);

  useEffect(() => { loadRows(); }, [loadRows]);

  const visibleRows = useMemo(() => {
    const q = filterSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.participant.fullName.toLowerCase().includes(q) ||
      (r.participant.sbaId ?? "").toLowerCase().includes(q) ||
      r.programName.toLowerCase().includes(q)
    );
  }, [rows, filterSearch]);

  const visibleEntries = useMemo(() => {
    const byEntry = new Map<string, EntryRow>();

    for (const row of visibleRows) {
      const key = row.group.id || `${row.registrationId}-${row.programName}-${row.group.namesDisplay}`;
      const existing = byEntry.get(key);
      if (existing) {
        existing.participants.push(row);
      } else {
        byEntry.set(key, {
          key,
          group: row.group,
          registration: row.registration,
          eventName: row.eventName,
          programName: row.programName,
          registrationId: row.registrationId,
          participants: [row],
        });
      }
    }

    return Array.from(byEntry.values());
  }, [visibleRows]);

  const handleSaved = useCallback((updated: RegistrationParticipant) => {
    setRows(prev => prev.map(r =>
      r.participant.id === updated.id ? { ...r, participant: updated } : r
    ));
  }, []);

  return (
    <div>
      <div className="sticky-header">
        <div className="admin-page-title"><h1>Participant Details</h1></div>
      </div>

      {/* Filters */}
      <div className="p-4 mb-5"
        style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
        <div className="flex flex-wrap items-end gap-3">
          <FG label="Search">
            <div className="relative">
              <input className="field-input w-48 pr-8" placeholder="Name, SBA ID..."
                value={filterSearch} onChange={e => setFilterSearch(e.target.value)} />
              {filterSearch && (
                <button onClick={() => setFilterSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-80">
                  <Search className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </FG>
          <FG label="Event">
            <select className="field-input w-52" value={filterEvent}
              onChange={e => { setFilterEvent(e.target.value); setFilterProgram(""); setFilterRegId(""); }}>
              <option value="">All Events</option>
              {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
            </select>
          </FG>
          <FG label="Program">
            <select className="field-input w-44" value={filterProgram}
              disabled={!filterEvent}
              onChange={e => { setFilterProgram(e.target.value); setFilterRegId(""); }}>
              <option value="">All Programs</option>
              {programsForEvent.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </FG>
          <FG label="Reg No.">
            <input className="field-input w-28" placeholder="e.g. 42" value={filterRegId}
              onChange={e => {
                setFilterRegId(e.target.value);
                if (e.target.value) { setFilterEvent(""); setFilterProgram(""); }
              }} />
          </FG>
        </div>
      </div>

      <p className="text-xs opacity-50 mb-3">
        {loading ? "Loading..." : `${visibleEntries.length} entr${visibleEntries.length !== 1 ? "ies" : "y"} - ${visibleRows.length} participant${visibleRows.length !== 1 ? "s" : ""}${
          rows.length !== visibleRows.length ? ` (filtered from ${rows.length})` : ""}`}
      </p>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20 gap-2 opacity-40 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading participants...
        </div>
      ) : error ? (
        <div className="py-16 text-center text-sm opacity-60">{error}</div>
      ) : visibleEntries.length === 0 ? (
        <div className="py-16 text-center text-sm opacity-40">No participants found.</div>
      ) : (
        <>
          <div className="hidden md:block overflow-x-auto"
                style={{ border: "1px solid var(--color-table-border)" }}>
                <table className="trs-table">
                  <thead>
                    <tr>
                      <th>Reg No.</th><th>Event</th><th>Program</th>
                      <th>Participants</th><th>Status</th><th>Payment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleEntries.map(entry => (
                      <tr key={entry.key}>
                        <td className="font-mono text-xs">{entry.registrationId}</td>
                        <td className="text-sm">{entry.eventName}</td>
                        <td className="text-sm">{entry.programName}</td>
                        <td>
                          <div className="space-y-1">
                            {entry.participants.map(row => (
                              <button key={row.participant.id} type="button"
                                onClick={() => setDetailRow(row)}
                                className="flex items-center gap-2 text-left text-xs hover:opacity-70">
                                <span className="font-semibold">{row.participant.fullName}</span>
                                {row.participant.sbaId && <span className="font-mono opacity-40">{row.participant.sbaId}</span>}
                              </button>
                            ))}
                          </div>
                        </td>
                        <td><StatusBadge status={entry.group.groupStatus} /></td>
                        <td><PaymentBadge status={entry.registration.payment?.paymentStatus} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden space-y-3">
                {visibleEntries.map(entry => (
                  <div key={entry.key} className="p-4"
                    style={{ border: "1px solid var(--color-table-border)" }}>
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <p className="text-xs opacity-50">{entry.programName} - {entry.eventName}</p>
                        <p className="text-xs opacity-40 font-mono mt-0.5">Reg {entry.registrationId}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <StatusBadge status={entry.group.groupStatus} />
                        <PaymentBadge status={entry.registration.payment?.paymentStatus} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      {entry.participants.map(row => (
                        <button key={row.participant.id} type="button"
                          onClick={() => setDetailRow(row)}
                          className="w-full flex items-center justify-between gap-3 text-left text-xs p-2"
                          style={{ backgroundColor: "var(--color-row-hover)" }}>
                          <span className="font-semibold">{row.participant.fullName}</span>
                          <span className="font-mono opacity-40">{row.participant.sbaId || "No SBA ID"}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
        </>
      )}

      {detailRow && (
        <DetailModal
          row={detailRow}
          programFields={getProgramFields(detailRow.group)}
          eventType={getEventType(detailRow.group)}
          onClose={() => setDetailRow(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
