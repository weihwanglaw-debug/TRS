/**
 * ParticipantDetails.tsx - Admin participant list and edit modal.
 *
 * Uses ParticipantFieldsForm for all field rendering and validation,
 * keeping logic consistent with the public registration form.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Download, Loader2, Save, Search } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  apiGetRegistration, apiGetRegistrations,
  apiUpdateParticipant, apiGetEvents, apiUploadFile,
} from "@/lib/api";
import { apiGetFixtureStatus } from "@/lib/fixtureApi";
import { ActionFeedbackDialog, type ActionFeedbackVariant } from "@/components/ui/ActionFeedbackDialog";
import type { RegistrationParticipant, ParticipantGroup, Registration, PaymentItem, RegStatus, PaymentStatus, ItemStatus } from "@/types/registration";
import { REG_STATUS_LABEL, PAYMENT_STATUS_LABEL, ITEM_STATUS_LABEL } from "@/types/registration";
import type { TournamentEvent, ProgramFields, Program } from "@/types/config";
import { isTeamProgram } from "@/types/config";
import ParticipantFieldsForm, {
  ParticipantFormValues,
  validateParticipant, buildDobString, parseDobString,
} from "@/components/registration/ParticipantFieldsForm";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import { exportWorkbookSheet } from "@/lib/exportRegistrationPaymentsWorkbook";

// Types

interface ParticipantRow {
  participant:    RegistrationParticipant;
  group:          ParticipantGroup;
  registration:   Registration;
  eventName:      string;
  programName:    string;
  registrationId: string;
  program?:       Program;
  programType:    string;
  feeStructure:   "per_entry" | "per_player";
  fixtureExists:  boolean;
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

function PaymentBadge({ status }: { status?: string }) {
  const label =
    ITEM_STATUS_LABEL[status as ItemStatus] ??
    PAYMENT_STATUS_LABEL[status as PaymentStatus] ??
    status ??
    "-";

  const m: Record<string, [string, string]> = {
    S:  ["var(--badge-open-bg)",   "var(--badge-open-text)"],
    R:  ["var(--badge-open-bg)",   "var(--badge-open-text)"],
    FR: ["var(--badge-open-bg)",   "var(--badge-open-text)"],
    W:  ["var(--badge-soon-bg)",   "var(--badge-soon-text)"],
    PC: ["var(--badge-soon-bg)",   "var(--badge-soon-text)"],
    PR: ["var(--badge-soon-bg)",   "var(--badge-soon-text)"],
    P:  ["var(--badge-soon-bg)",   "var(--badge-soon-text)"],
    X:  ["var(--badge-closed-bg)", "var(--badge-closed-text)"],
    F:  ["var(--badge-closed-bg)", "var(--badge-closed-text)"],
  };
  const [bg, color] = m[status ?? ""] ?? ["var(--color-row-hover)", "var(--color-body-text)"];
  return (
    <span className="inline-flex px-2 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: bg, color }}>{label}</span>
  );
}

const GAME_TYPE_LABEL: Record<string, string> = {
  singles: "Singles / Individual",
  individual: "Individual",
  doubles: "Pairs / Doubles",
  mixed: "Custom / Mixed",
  team: "Team",
};

const PAYMENT_TYPE_LABEL: Record<"per_entry" | "per_player", string> = {
  per_entry: "Per Entry",
  per_player: "Per Headcount",
};

function gameTypeLabel(type: string): string {
  return GAME_TYPE_LABEL[type.toLowerCase()] ?? (type || "-");
}

function getRowRegistrationStatus(row: ParticipantRow): string {
  return row.participant.participantStatus === "X" ? "X" : row.group.groupStatus;
}

function getPaymentItemForRow(row: ParticipantRow): PaymentItem | undefined {
  const items = row.registration.payment?.items ?? [];

  if (row.feeStructure === "per_player") {
    return items.find(item => item.participantId === row.participant.id);
  }

  return items.find(item =>
    item.participantGroupId === row.group.id && !item.participantId
  ) ?? items.find(item => item.participantGroupId === row.group.id);
}

function getRowPaymentStatus(row: ParticipantRow): string | undefined {
  return getPaymentItemForRow(row)?.itemStatus ?? row.registration.payment?.paymentStatus;
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
  readOnly:      boolean;
  onClose:       () => void;
  onSaved:       (updated: Registration) => void;
}

function DetailModal({ row, programFields, eventType, teamMode, readOnly, onClose, onSaved }: DetailModalProps) {
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
    if (readOnly) return;

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

    const originalTeamName = (row.group.clubDisplay || p.clubSchoolCompany || "").trim();
    const nextTeamName = (form.clubSchoolCompany || "").trim();
    if (teamMode && originalTeamName !== nextTeamName) {
      const ok = window.confirm("This will update the team name for all participants in this group. Continue?");
      if (!ok) return;
    }

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
        } else if (r.error.code === "DUPLICATE_TEAM") {
          setErrors({ clubSchoolCompany: r.error.message });
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
            <StatusBadge status={getRowRegistrationStatus(row)} />
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
          {readOnly && (
            <div className="p-3 text-sm font-medium"
              style={{ backgroundColor: "var(--badge-soon-bg)", color: "var(--badge-soon-text)" }}>
              Participant details cannot be changed after fixtures have been generated. Reset the fixture first.
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
            disabled={readOnly}
          />
        </div>

        <DialogFooter className="p-8 pt-0"
          style={{ borderTop: "1px solid var(--color-table-border)" }}>
          <button onClick={onClose}
            className="btn-outline px-5 py-2.5 text-sm font-medium">Cancel</button>
          <button onClick={handleSave}
            disabled={readOnly || saving || !form.fullName.trim()}
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
  const [exportingExcel, setExportingExcel] = useState(false);
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

  const getProgramForGroup = useCallback((group: ParticipantGroup): Program | undefined => {
    for (const ev of events) {
      const prog = ev.programs.find(p => p.id === group.programId);
      if (prog) return prog;
    }
    return undefined;
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
      const programIds = Array.from(new Set(regs.flatMap(reg => reg.groups.map(g => g.programId))));
      const fixtureStatusResult = await apiGetFixtureStatus(programIds);
      const fixtureStatus = fixtureStatusResult.data ?? {};
      if (fixtureStatusResult.error) showLoadError(fixtureStatusResult.error.message);

      setRows(
        regs.flatMap(reg =>
          reg.groups
            .flatMap(g => {
              const program = getProgramForGroup(g);
              const programType = program?.type ?? "";
              const feeStructure = program?.feeStructure ?? "per_entry";
              return g.participants
                .map(p => ({
                  participant:    p,
                  group:          g,
                  registration:   reg,
                  eventName:      reg.eventName,
                  programName:    g.programName,
                  registrationId: reg.id,
                  program,
                  programType,
                  feeStructure,
                  fixtureExists:  fixtureStatus[g.programId] ?? false,
                }));
            })
        )
      );
    } catch {
      const message = "Please check your connection and try again.";
      setError(message);
      showLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [filterEvent, filterProgram, filterRegId, getProgramForGroup]);

  useEffect(() => { loadRows(); }, [loadRows]);

  const visibleRows = useMemo(() => {
    const q = filterSearch.trim().toLowerCase();
    return rows.filter(r => {
      if (filterStatus) {
        if (getRowRegistrationStatus(r) !== filterStatus) return false;
      }
      if (!q) return true;
      return r.participant.fullName.toLowerCase().includes(q) ||
        (r.participant.sbaId ?? "").toLowerCase().includes(q) ||
        r.registrationId.toLowerCase().includes(q) ||
        r.group.id.toLowerCase().includes(q) ||
        r.eventName.toLowerCase().includes(q) ||
        r.programName.toLowerCase().includes(q) ||
        (r.group.clubDisplay ?? "").toLowerCase().includes(q) ||
        (r.participant.clubSchoolCompany ?? "").toLowerCase().includes(q);
    });
  }, [rows, filterSearch, filterStatus]);

  const handleExportExcel = async () => {
    setExportingExcel(true);
    try {
      await exportWorkbookSheet({
        filename: "Participant Entries",
        headers: [
          "No.",
          "Reg No.",
          "Event",
          "Program",
          "Game Type",
          "Payment Type",
          "Group ID",
          "Club / Team / School",
          "Participant",
          "SBA ID",
          "Registration Status",
          "Payment Status",
        ],
        rows: visibleRows.map((row, index) => [
          { value: index + 1, align: "right" as const },
          row.registrationId,
          row.eventName,
          row.programName,
          gameTypeLabel(row.programType),
          PAYMENT_TYPE_LABEL[row.feeStructure],
          row.group.id,
          row.group.clubDisplay || row.participant.clubSchoolCompany || "-",
          row.participant.fullName,
          row.participant.sbaId || "",
          REG_STATUS_LABEL[getRowRegistrationStatus(row) as RegStatus] ?? getRowRegistrationStatus(row),
          ITEM_STATUS_LABEL[getRowPaymentStatus(row) as ItemStatus]
            ?? PAYMENT_STATUS_LABEL[getRowPaymentStatus(row) as PaymentStatus]
            ?? getRowPaymentStatus(row)
            ?? "-",
        ]),
        columns: [
          { width: 6 },
          { width: 10 },
          { width: 28 },
          { width: 24 },
          { width: 20 },
          { width: 18 },
          { width: 10 },
          { width: 30 },
          { width: 28 },
          { width: 14 },
          { width: 20 },
          { width: 18 },
        ],
      });
    } catch {
      showLoadError("Participants could not be exported. Please check your connection and try again.");
    } finally {
      setExportingExcel(false);
    }
  };

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
        <div className="admin-page-title" style={{ marginBottom: 0 }}><h1>Participant Entries</h1></div>
      </div>

  {/* Filters */}
      <div className="p-5 mb-6"
        style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
        <div className="grid grid-cols-2 md:flex md:flex-wrap items-end gap-4">
          <FG label="Search">
            <div className="relative">
              <input className="field-input with-right-icon w-56" placeholder="Name, SBA ID, team..."
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
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={loading || exportingExcel || visibleRows.length === 0}
            className="btn-outline h-[42px] px-4 text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Export participant entries matching the current filters to Excel"
          >
            {exportingExcel ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export Excel
          </button>
        </div>
      </div>

      <p className="text-xs opacity-50 mb-3">
        {loading ? <span className="inline-flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading...</span> : `${visibleRows.length} participant${visibleRows.length !== 1 ? "s" : ""}${
          rows.length !== visibleRows.length ? ` (filtered from ${rows.length})` : ""}`}
      </p>

  {/* Table */}
      {loading ? (
        <LoadingSpinner size="sm" label="Loading participants..." />
      ) : error ? (
        <div className="py-16 text-center text-sm opacity-60">{error}</div>
      ) : visibleRows.length === 0 ? (
        <div className="py-16 text-center text-sm opacity-40">No participants found.</div>
      ) : (
        <>
          <div className="hidden md:block overflow-x-auto"
                style={{ border: "1px solid var(--color-table-border)" }}>
                <table className="trs-table">
                  <thead>
                    <tr>
                      <th>Reg No.</th><th>Event</th><th>Program</th><th>Game Type</th>
                      <th>Payment Type</th><th>Group ID</th><th>Club / Team / School</th>
                      <th>Participant</th><th>Registration<br />Status</th><th>Payment<br />Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map(row => (
                      <tr key={`${row.group.id}-${row.participant.id}`}>
                        <td>
                          <button
                            type="button"
                            onClick={() => openRegistration(row.registrationId)}
                            className="font-mono text-xs font-semibold hover:underline"
                            style={{ color: "var(--color-primary)" }}
                          >
                            {row.registrationId}
                          </button>
                        </td>
                        <td className="text-sm">{row.eventName}</td>
                        <td className="text-sm">{row.programName}</td>
                        <td className="text-sm">{gameTypeLabel(row.programType)}</td>
                        <td className="text-sm">{PAYMENT_TYPE_LABEL[row.feeStructure]}</td>
                        <td className="font-mono text-xs">{row.group.id}</td>
                        <td className="text-sm">{row.group.clubDisplay || row.participant.clubSchoolCompany || "-"}</td>
                        <td>
                          <button type="button"
                            onClick={() => setDetailRow(row)}
                            className="flex items-center gap-2 text-left text-xs hover:opacity-70">
                            <span className="font-semibold">{row.participant.fullName}</span>
                            {row.participant.sbaId && <span className="font-mono opacity-40">{row.participant.sbaId}</span>}
                          </button>
                        </td>
                        <td><StatusBadge status={getRowRegistrationStatus(row)} /></td>
                        <td><PaymentBadge status={getRowPaymentStatus(row)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden space-y-3">
                {visibleRows.map(row => (
                  <div key={`${row.group.id}-${row.participant.id}`} className="p-4"
                    style={{ border: "1px solid var(--color-table-border)" }}>
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <p className="text-xs opacity-50">{row.programName} - {row.eventName}</p>
                        <button
                          type="button"
                          onClick={() => openRegistration(row.registrationId)}
                          className="text-xs font-mono mt-0.5 hover:underline"
                          style={{ color: "var(--color-primary)" }}
                        >
                          Reg {row.registrationId}
                        </button>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <StatusBadge status={getRowRegistrationStatus(row)} />
                        <PaymentBadge status={getRowPaymentStatus(row)} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                      <span className="opacity-50">Game</span><span>{gameTypeLabel(row.programType)}</span>
                      <span className="opacity-50">Payment Type</span><span>{PAYMENT_TYPE_LABEL[row.feeStructure]}</span>
                      <span className="opacity-50">Group</span><span className="font-mono">{row.group.id}</span>
                      <span className="opacity-50">Club / Team / School</span><span>{row.group.clubDisplay || row.participant.clubSchoolCompany || "-"}</span>
                    </div>
                    <button type="button"
                      onClick={() => setDetailRow(row)}
                      className="w-full flex items-center justify-between gap-3 text-left text-xs p-2"
                      style={{ backgroundColor: "var(--color-row-hover)" }}>
                      <span className="font-semibold">{row.participant.fullName}</span>
                      <span className="font-mono opacity-40">{row.participant.sbaId || "No SBA ID"}</span>
                    </button>
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
          teamMode={isTeamProgram(detailRow.programType)}
          readOnly={detailRow.fixtureExists}
          onClose={() => setDetailRow(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
