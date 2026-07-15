/**
 * ParticipantDetails.tsx - Admin participant list and edit modal.
 *
 * Uses ParticipantFieldsForm for all field rendering and validation,
 * keeping logic consistent with the public registration form.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Loader2, Save, Search } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  apiGetRegistration, apiGetRegistrations,
  apiUpdateParticipant, apiGetEvents, apiUploadFile,
} from "@/lib/api";
import { ActionFeedbackDialog, type ActionFeedbackVariant } from "@/components/ui/ActionFeedbackDialog";
import type { RegistrationParticipant, ParticipantGroup, Registration, PaymentItem, RegStatus } from "@/types/registration";
import { REG_STATUS_LABEL } from "@/types/registration";
import type { TournamentEvent, ProgramFields } from "@/types/config";
import { isTeamProgram } from "@/types/config";
import ParticipantFieldsForm, {
  ParticipantFormValues,
  validateParticipant, buildDobString, parseDobString,
} from "@/components/registration/ParticipantFieldsForm";
import LoadingSpinner from "@/components/ui/LoadingSpinner";

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
  const label = REG_STATUS_LABEL[status as RegStatus] ?? status;
  const m: Record<string, [string, string]> = {
    C: ["var(--badge-open-bg)",   "var(--badge-open-text)"],
    P: ["var(--badge-soon-bg)",   "var(--badge-soon-text)"],
    X: ["var(--badge-closed-bg)", "var(--badge-closed-text)"],
  };
  const [bg, color] = m[status] ?? ["var(--color-row-hover)", "var(--color-body-text)"];
  return (
    <span className="inline-flex px-2 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: bg, color }}>{label}</span>
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
  teamMode:      boolean;
  onClose:       () => void;
  onSaved:       (updated: Registration) => void;
}

function PaymentBadge({ status }: { status?: string }) {
  const m: Record<string, [string, string, string]> = {
    S:  ["Paid", "var(--badge-open-bg)", "var(--badge-open-text)"],
    R:  ["Refunded", "var(--badge-open-bg)", "var(--badge-open-text)"],
    PR: ["Partially Refunded", "var(--badge-soon-bg)", "var(--badge-soon-text)"],
    FR: ["Refunded", "var(--badge-open-bg)", "var(--badge-open-text)"],
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

function DetailModal({ row, programFields, eventType, teamMode, onClose, onSaved }: DetailModalProps) {
  const p = row.participant;

  const [form,       setForm]       = useState<ParticipantFormValues>(() => toFormValues(p));
  const [newDocFile, setNewDocFile] = useState<File | null>(null);
  const [errors,     setErrors]     = useState<Record<string, string>>({});
  const [saving,     setSaving]     = useState(false);
  const [feedback, setFeedback] = useState<{
    open: boolean;
    variant: ActionFeedbackVariant;
    title: string;
    description?: string;
  }>({ open: false, variant: "info", title: "" });

  const showSaveError = (description: string) =>
    setFeedback({ open: true, variant: "error", title: "Participant could not be saved", description });

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
          showSaveError(`Document upload failed: ${uploadResult.error.message}`);
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
          showSaveError(r.error.message);
        }
        return;
      }

      if (r.data) onSaved(r.data);
      onClose();
    } catch {
      showSaveError("Please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <ActionFeedbackDialog
      open={feedback.open}
      variant={feedback.variant}
      title={feedback.title}
      description={feedback.description}
      onOpenChange={open => setFeedback(prev => ({ ...prev, open }))}
    />
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
          <ParticipantFieldsForm
            values={form}
            onChange={patch => setForm(prev => ({ ...prev, ...patch }))}
            programFields={fields}
            eventType={eventType}
            teamMode={teamMode}
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
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

function getPaymentItemsForEntry(entry: EntryRow): PaymentItem[] {
  const paymentItems = entry.registration.payment?.items ?? [];
  const participantIds = new Set(entry.participants.map(row => row.participant.id));

  const participantItems = paymentItems.filter(item =>
    item.participantId && participantIds.has(item.participantId)
  );
  if (participantItems.length > 0) return participantItems;

  return paymentItems.filter(item =>
    !item.participantId && item.participantGroupId === entry.group.id
  );
}

function getEntryPaymentStatus(entry: EntryRow): string | undefined {
  const items = getPaymentItemsForEntry(entry);
  if (items.length === 0) return entry.registration.payment?.paymentStatus;

  const statuses = new Set(items.map(item => item.itemStatus));
  if (statuses.size === 1) return items[0].itemStatus;
  if (statuses.has("R")) return "PR";
  if (statuses.has("S")) return "S";
  if (statuses.has("X")) return "X";
  return items[0].itemStatus;
}

// Main page

export default function ParticipantDetails() {
  const { regId }      = useParams<{ regId: string }>();
  const [searchParams] = useSearchParams();
  const navigate       = useNavigate();

  const initEventId   = searchParams.get("eventId")   ?? "";
  const initProgramId = searchParams.get("programId") ?? "";
  const initRegId     = regId ?? searchParams.get("regId") ?? "";

  const [filterSearch,  setFilterSearch]  = useState("");
  const [filterEvent,   setFilterEvent]   = useState(initEventId);
  const [filterProgram, setFilterProgram] = useState(initProgramId);
  const [filterRegId,   setFilterRegId]   = useState(initRegId);
  const [filterStatus,  setFilterStatus]  = useState("");
  const [rows,    setRows]    = useState<ParticipantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");
  const [events,  setEvents]  = useState<TournamentEvent[]>([]);
  const [feedback, setFeedback] = useState<{
    open: boolean;
    variant: ActionFeedbackVariant;
    title: string;
    description?: string;
  }>({ open: false, variant: "info", title: "" });

  const showLoadError = (description: string) =>
    setFeedback({ open: true, variant: "error", title: "Participants could not be loaded", description });

  const [detailRow, setDetailRow] = useState<ParticipantRow | null>(null);

  const openRegistration = (registrationId: string) => {
    navigate(`/admin/registrations?search=${encodeURIComponent(registrationId)}`);
  };

  useEffect(() => {
    apiGetEvents()
      .then(r => {
        if (r.data) setEvents(r.data);
        else if (r.error) showLoadError(r.error.message);
      })
      .catch(() => showLoadError("Events could not be loaded. Please check your connection and try again."));
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

  const getProgramTeamMode = useCallback((group: ParticipantGroup): boolean => {
    for (const ev of events) {
      const prog = ev.programs.find(p => p.id === group.programId);
      if (prog) return isTeamProgram(prog.type);
    }
    return false;
  }, [events]);

  const loadRows = useCallback(async () => {
    setLoading(true); setError("");
    try {
      let regs: Registration[] = [];
      if (filterRegId.trim()) {
        const r = await apiGetRegistration(filterRegId.trim());
        if (r.error) { setError(r.error.message); showLoadError(r.error.message); return; }
        regs = [r.data!];
      } else {
        const filters: Record<string, string> = {};
        if (filterEvent)   filters.eventId   = filterEvent;
        if (filterProgram) filters.programId = filterProgram;
        const r = await apiGetRegistrations(filters, { page: 1, pageSize: 500 });
        if (r.error) { setError(r.error.message); showLoadError(r.error.message); return; }
        regs = r.data!.items;
      }
      setRows(
        regs.flatMap(reg =>
          reg.groups
            .flatMap(g =>
            g.participants
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
    } catch {
      const message = "Please check your connection and try again.";
      setError(message);
      showLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [filterEvent, filterProgram, filterRegId]);

  useEffect(() => { loadRows(); }, [loadRows]);

  const visibleRows = useMemo(() => {
    const q = filterSearch.trim().toLowerCase();
    return rows.filter(r => {
      if (filterStatus) {
        const matchesGroupStatus = r.group.groupStatus === filterStatus;
        const matchesParticipantStatus = filterStatus === "X" &&
          r.participant.participantStatus === "X";
        if (!matchesGroupStatus && !matchesParticipantStatus) return false;
      }

      if (!q) return true;
      return r.participant.fullName.toLowerCase().includes(q) ||
        (r.participant.sbaId ?? "").toLowerCase().includes(q) ||
        r.programName.toLowerCase().includes(q);
    });
  }, [rows, filterSearch, filterStatus]);

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

  const handleSaved = useCallback((updated: Registration) => {
    const updatedByParticipantId = new Map<string, { participant: RegistrationParticipant; group: ParticipantGroup }>();
    updated.groups.forEach(group => {
      group.participants.forEach(participant => {
        updatedByParticipantId.set(participant.id, { participant, group });
      });
    });

    setRows(prev => prev.map(row => {
      if (row.registrationId !== updated.id) return row;
      const match = updatedByParticipantId.get(row.participant.id);
      return match
        ? { ...row, participant: match.participant, group: match.group, registration: updated }
        : row;
    }));
  }, []);

  return (
    <div>
      <ActionFeedbackDialog
        open={feedback.open}
        variant={feedback.variant}
        title={feedback.title}
        description={feedback.description}
        onOpenChange={open => setFeedback(prev => ({ ...prev, open }))}
      />
      <div className="flex items-center justify-between mb-8">
        <div className="admin-page-title" style={{ marginBottom: 0 }}><h1>Participant Details</h1></div>
      </div>

  {/* Filters */}
      <div className="p-5 mb-6"
        style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
        <div className="grid grid-cols-2 md:flex md:flex-wrap items-end gap-4">
          <FG label="Search">
            <div className="relative">
              <input className="field-input with-right-icon w-48" placeholder="Name, SBA ID..."
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
          <FG label="Status">
            <select className="field-input w-40" value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All</option>
              <option value="P">Pending</option>
              <option value="C">Confirmed</option>
              <option value="X">Cancelled</option>
            </select>
          </FG>
        </div>
      </div>

      <p className="text-xs opacity-50 mb-3">
        {loading ? <span className="inline-flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading...</span> : `${visibleEntries.length} entr${visibleEntries.length !== 1 ? "ies" : "y"} - ${visibleRows.length} participant${visibleRows.length !== 1 ? "s" : ""}${
          rows.length !== visibleRows.length ? ` (filtered from ${rows.length})` : ""}`}
      </p>

  {/* Table */}
      {loading ? (
        <LoadingSpinner size="sm" label="Loading participants..." />
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
                        <td>
                          <button
                            type="button"
                            onClick={() => openRegistration(entry.registrationId)}
                            className="font-mono text-xs font-semibold hover:underline"
                            style={{ color: "var(--color-primary)" }}
                          >
                            {entry.registrationId}
                          </button>
                        </td>
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
                        <td><PaymentBadge status={getEntryPaymentStatus(entry)} /></td>
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
                        <button
                          type="button"
                          onClick={() => openRegistration(entry.registrationId)}
                          className="text-xs font-mono mt-0.5 hover:underline"
                          style={{ color: "var(--color-primary)" }}
                        >
                          Reg {entry.registrationId}
                        </button>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <StatusBadge status={entry.group.groupStatus} />
                        <PaymentBadge status={getEntryPaymentStatus(entry)} />
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
          teamMode={getProgramTeamMode(detailRow.group)}
          onClose={() => setDetailRow(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
