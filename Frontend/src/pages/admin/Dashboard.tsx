
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { TournamentEvent } from "@/types/config";
import type { Registration, RegistrationStats } from "@/lib/api";
import type { PaymentStatus, RegStatus } from "@/types/registration";
import type { RegistrationFilters } from "@/lib/api";
import {
  apiGetEvents,
  apiGetRegistrationStats,
  apiGetReconciliationStats,
  apiExportRegistrations,
  apiGetRegistration,
  apiGetRefunds,
  apiGetUsers,
} from "@/lib/api";
import { PAYMENT_STATUS_LABEL, REG_STATUS_LABEL } from "@/types/registration";
import { exportRegistrationsCsv } from "@/lib/exportCsv";
import { exportPaymentSummaryWorkbook } from "@/lib/exportPaymentSummaryWorkbook";
import { exportParticipantDetailsWorkbook } from "@/lib/exportParticipantDetailsWorkbook";
import { exportEventSummaryWorkbook } from "@/lib/exportEventSummaryWorkbook";
import { exportUserAccessWorkbook } from "@/lib/exportUserAccessWorkbook";
import { apiGetFixtureStatus } from "@/lib/fixtureApi";
import { computeFixtureDashboardStats, FixtureDashboardStats } from "@/lib/fixtureStatus";
import { singaporeDateKey } from "@/lib/eventUtils";
import { ArchiveRestore, CalendarCheck, CalendarDays, CreditCard, Zap, ClipboardList, FileText, Loader2 } from "lucide-react";
import { PageLoader } from "@/components/ui/LoadingSpinner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function Dashboard() {
  const navigate = useNavigate();

  const [events,  setEvents]  = useState<TournamentEvent[]>([]);
  const [stats,   setStats]   = useState<RegistrationStats | null>(null);
  const [reconcTotal, setReconcTotal] = useState(0);
  const [fx,      setFx]      = useState<FixtureDashboardStats>({
    pendingPayments: 0, pendingFixture: 0, pendingResults: 0,
  });
  const [loading, setLoading] = useState(true);
  const [reportFilters, setReportFilters] = useState<RegistrationFilters>({});
  const [exportingPaymentSummary, setExportingPaymentSummary] = useState(false);
  const [paymentReportOpen, setPaymentReportOpen] = useState(false);
  const [participantReportOpen, setParticipantReportOpen] = useState(false);
  const [participantFilters, setParticipantFilters] = useState<RegistrationFilters & { regNo?: string; status?: string }>({});
  const [exportingParticipantDetails, setExportingParticipantDetails] = useState(false);
  const [exportingEventSummary, setExportingEventSummary] = useState(false);
  const [exportingUserAccess, setExportingUserAccess] = useState(false);

  useEffect(() => {
    Promise.all([
      apiGetEvents({ includeInactive: false }),
      apiGetRegistrationStats(),
      apiGetReconciliationStats(),   // NEW
    ])
      .then(async ([evR, stR, rcR]) => {
        const evs = evR.data ?? [];
        setEvents(evs);
        if (stR.data) setStats(stR.data);
        if (rcR.data) setReconcTotal(rcR.data.total);

        const sportProgIds = evs
          .filter(e => e.isSports && e.fixtureMode === "internal")
          .flatMap(e => e.programs.map(p => p.id));

        if (sportProgIds.length > 0) {
          const fxR = await apiGetFixtureStatus(sportProgIds);
          if (fxR.data) setFx(computeFixtureDashboardStats(evs, fxR.data));
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const today        = singaporeDateKey();
  const openCount    = events.filter(e => e.openDate <= today && today <= e.closeDate).length;
  const upcomingCount = events.filter(e => e.openDate > today).length;
  const selectedReportEvent = events.find(event => String(event.id) === reportFilters.eventId);
  const reportPrograms = useMemo(
    () => selectedReportEvent
      ? selectedReportEvent.programs
      : events.flatMap(event => event.programs),
    [events, selectedReportEvent],
  );
  const selectedParticipantEvent = events.find(event => String(event.id) === participantFilters.eventId);
  const participantPrograms = useMemo(
    () => selectedParticipantEvent
      ? selectedParticipantEvent.programs
      : events.flatMap(event => event.programs),
    [events, selectedParticipantEvent],
  );

  const metrics = [
    {
      label:  "Open Events",
      value:  openCount,
      icon:   CalendarCheck,
      color:  "var(--badge-open-text)",
      bg:     "var(--badge-open-bg)",
      border: openCount > 0 ? "var(--badge-open-text)" : "var(--color-table-border)",
      sub:    "Accepting registrations",
      action: null,
    },
    {
      label:  "Upcoming Events",
      value:  upcomingCount,
      icon:   CalendarDays,
      color:  "var(--badge-soon-text)",
      bg:     "var(--badge-soon-bg)",
      border: upcomingCount > 0 ? "var(--badge-soon-text)" : "var(--color-table-border)",
      sub:    "Registration not yet open",
      action: null,
    },
    {
  // CHANGED: was "Pending Payments" -> "Payment Reconciliation"
  // CHANGED: count is reconcTotal (caseA+B+C) not just pendingPayments
  // CHANGED: navigates to /admin/payments instead of /admin/registrations
      label:  "Payment Reconciliation",
      value:  reconcTotal,
      icon:   CreditCard,
      color:  reconcTotal > 0 ? "var(--badge-open-text)" : "var(--badge-closed-text)",
      bg:     reconcTotal > 0 ? "var(--badge-open-bg)" : "var(--color-row-hover)",
      border: reconcTotal > 0 ? "var(--badge-open-text)" : "var(--color-table-border)",
      sub:    "Payments needing attention",
      action: "/admin/payment-reconciliation",
    },
    {
      label:  "Pending Fixture Setup",
      value:  fx.pendingFixture,
      icon:   Zap,
      color:  "var(--badge-closed-text)",
      bg:     fx.pendingFixture > 0 ? "var(--badge-closed-bg)" : "var(--color-row-hover)",
      border: fx.pendingFixture > 0 ? "var(--badge-closed-text)" : "var(--color-table-border)",
      sub:    "Reg. closed - no fixture generated",
      action: "/admin/fixtures",
    },
    {
      label:  "Pending Result Input",
      value:  fx.pendingResults,
      icon:   ClipboardList,
      color:  "var(--badge-soon-text)",
      bg:     fx.pendingResults > 0 ? "var(--badge-soon-bg)" : "var(--color-row-hover)",
      border: fx.pendingResults > 0 ? "var(--badge-soon-text)" : "var(--color-table-border)",
      sub:    "Scheduled matches past due",
      action: "/admin/fixtures",
    },
  ];

  const handleExport = async () => {
    const r = await apiExportRegistrations({});
    if (!r.data) return;
    exportRegistrationsCsv("All Events", "", r.data);
  };

  const handleEventSummaryExport = async () => {
    setExportingEventSummary(true);
    try {
      const result = await apiExportRegistrations({});
      if (!result.data) {
        window.alert(result.error?.message ?? "Failed to export event summary.");
        return;
      }
      await exportEventSummaryWorkbook(events, result.data);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to export event summary.");
    } finally {
      setExportingEventSummary(false);
    }
  };

  const handleUserAccessExport = async () => {
    setExportingUserAccess(true);
    try {
      const result = await apiGetUsers();
      if (!result.data) {
        window.alert(result.error?.message ?? "Failed to export user access.");
        return;
      }
      await exportUserAccessWorkbook(result.data);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to export user access.");
    } finally {
      setExportingUserAccess(false);
    }
  };

  const updateReportFilter = (key: keyof RegistrationFilters, value: string) => {
    setReportFilters(prev => {
      const next = { ...prev, [key]: value || undefined };
      if (key === "eventId") next.programId = undefined;
      return next;
    });
  };

  const updateParticipantFilter = (key: keyof (RegistrationFilters & { regNo?: string; status?: string }), value: string) => {
    setParticipantFilters(prev => {
      const next = { ...prev, [key]: value || undefined };
      if (key === "eventId") next.programId = undefined;
      if (key === "regNo" && value) {
        next.eventId = undefined;
        next.programId = undefined;
      }
      return next;
    });
  };

  const paymentSummaryFilterText = () => {
    const program = reportPrograms.find(p => String(p.id) === reportFilters.programId);
    return [
      `Search: ${reportFilters.search?.trim() || "All"}`,
      `Event: ${selectedReportEvent?.name ?? "All Events"}`,
      `Program: ${program?.name ?? "All Programs"}`,
      `Reg. Status: ${reportFilters.regStatus ? REG_STATUS_LABEL[reportFilters.regStatus as RegStatus] ?? reportFilters.regStatus : "All"}`,
      `Payment: ${reportFilters.payStatus ? PAYMENT_STATUS_LABEL[reportFilters.payStatus as PaymentStatus] ?? reportFilters.payStatus : "All"}`,
    ].join(" | ");
  };

  const handlePaymentSummaryExport = async () => {
    setExportingPaymentSummary(true);
    try {
      const r = await apiExportRegistrations(reportFilters);
      if (!r.data) {
        window.alert(r.error?.message ?? "Failed to export payment summary.");
        return;
      }

      const refundResults = await Promise.all(
        r.data.map(async reg => {
          const result = await apiGetRefunds(reg.id);
          if (result.error) throw new Error(result.error.message);
          return [String(reg.id), result.data ?? []] as const;
        }),
      );

      await exportPaymentSummaryWorkbook(
        selectedReportEvent?.name ?? "All Events",
        r.data,
        Object.fromEntries(refundResults),
        paymentSummaryFilterText(),
      );
      setPaymentReportOpen(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to export payment summary.");
    } finally {
      setExportingPaymentSummary(false);
    }
  };

  const participantFilterText = () => {
    const program = participantPrograms.find(p => String(p.id) === participantFilters.programId);
    return [
      `Search: ${participantFilters.search?.trim() || "All"}`,
      `Event: ${selectedParticipantEvent?.name ?? "All Events"}`,
      `Program: ${program?.name ?? "All Programs"}`,
      `Reg No.: ${participantFilters.regNo?.trim() || "All"}`,
      `Status: ${participantFilters.status ? REG_STATUS_LABEL[participantFilters.status as RegStatus] ?? participantFilters.status : "All"}`,
    ].join(" | ");
  };

  const handleParticipantDetailsExport = async () => {
    setExportingParticipantDetails(true);
    try {
      let registrations: Registration[] = [];
      const regNo = participantFilters.regNo?.trim();
      if (regNo) {
        const result = await apiGetRegistration(regNo);
        if (!result.data) {
          window.alert(result.error?.message ?? "Registration could not be loaded.");
          return;
        }
        registrations = [result.data];
      } else {
        const result = await apiExportRegistrations({
          eventId: participantFilters.eventId,
          programId: participantFilters.programId,
        });
        if (!result.data) {
          window.alert(result.error?.message ?? "Failed to export participant details.");
          return;
        }
        registrations = result.data;
      }

      await exportParticipantDetailsWorkbook(
        selectedParticipantEvent?.name ?? "All Events",
        registrations,
        participantFilterText(),
        {
          statusFilter: participantFilters.status ?? "",
          search: participantFilters.search ?? "",
          programId: participantFilters.programId ?? "",
          programsById: Object.fromEntries(
            events.flatMap(event => event.programs.map(program => [String(program.id), program])),
          ),
        },
      );
      setParticipantReportOpen(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to export participant details.");
    } finally {
      setExportingParticipantDetails(false);
    }
  };

  const reports = [
    "Event and Program Summary",
    "User Access",
    "Participant Details",
    "Payment Summary",
  ];

  const reportMeta: Record<string, { caption: string }> = {
    "Event and Program Summary": { caption: "Event setup, program limits, status and counts" },
    "User Access": { caption: "Admin names, roles and login activity" },
    "Participant Details": { caption: "Participant primary, optional and custom fields" },
    "Payment Summary": { caption: "Line items, refunds and net totals" },
  };

  if (loading) return <PageLoader label="Loading dashboard..." />;

  return (
    <div>
      <div className="admin-page-title"><h1>Dashboard</h1></div>

      <div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-10">
        {metrics.map(m => {
          const inner = (
            <div className="p-5 h-full"
              style={{ border: `2px solid ${m.border}`, backgroundColor: m.bg }}>
              <div className="flex items-start gap-3 mb-3">
                <div className="p-2 flex-shrink-0" style={{ backgroundColor: m.color }}>
                  <m.icon className="h-4 w-4 text-white" />
                </div>
                <p className="text-xs font-medium opacity-70 leading-tight pt-1">{m.label}</p>
                {m.action && m.value > 0 && (
                  <span className="ml-auto text-xs font-bold px-2 py-0.5 flex-shrink-0"
                    style={{ backgroundColor: m.color, color: "white" }}>
                    ACTION
                  </span>
                )}
              </div>
              <p className="font-heading font-bold text-3xl mb-1" style={{ color: m.color }}>{m.value}</p>
              <p className="text-xs opacity-50">{m.sub}</p>
            </div>
          );
          return m.action ? (
            <button key={m.label} onClick={() => navigate(m.action!)}
              className="text-left transition-opacity hover:opacity-80">
              {inner}
            </button>
          ) : (
            <div key={m.label}>{inner}</div>
          );
        })}
      </div>

      <h2 className="font-heading font-bold text-lg mb-4">Reports</h2>
      <div className="grid sm:grid-cols-2 gap-4">
        {reports.map(report => (
          <div
            key={report}
            role={report === "Payment Summary" || report === "Participant Details" ? "button" : undefined}
            tabIndex={report === "Payment Summary" || report === "Participant Details" ? 0 : undefined}
            onClick={report === "Payment Summary"
              ? () => setPaymentReportOpen(true)
              : report === "Participant Details"
                ? () => setParticipantReportOpen(true)
                : undefined}
            onKeyDown={report === "Payment Summary" || report === "Participant Details" ? e => {
              if (e.key !== "Enter" && e.key !== " ") return;
              if (report === "Payment Summary") setPaymentReportOpen(true);
              if (report === "Participant Details") setParticipantReportOpen(true);
            } : undefined}
            className={`group p-5 flex items-center justify-between gap-4 transition-all ${report === "Payment Summary" || report === "Participant Details" ? "cursor-pointer" : ""}`}
            style={{
              border: "1px solid var(--color-table-border)",
              backgroundColor: "var(--color-row-hover)",
            }}>
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: "var(--color-page-bg)", color: "var(--color-primary)" }}>
                <FileText className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{report}</p>
                <p className="text-xs opacity-50 mt-1 truncate">{reportMeta[report]?.caption}</p>
              </div>
            </div>
            <button
              onClick={e => {
                e.stopPropagation();
                if (report === "Event and Program Summary") handleEventSummaryExport();
                else if (report === "User Access") handleUserAccessExport();
                else if (report === "Payment Summary") setPaymentReportOpen(true);
                else if (report === "Participant Details") setParticipantReportOpen(true);
                else handleExport();
              }}
              disabled={(report === "Payment Summary" && exportingPaymentSummary)
                || (report === "Participant Details" && exportingParticipantDetails)
                || (report === "Event and Program Summary" && exportingEventSummary)
                || (report === "User Access" && exportingUserAccess)}
              className="h-10 w-10 flex items-center justify-center flex-shrink-0 transition-opacity hover:opacity-80 disabled:opacity-50"
              title={report === "Payment Summary" || report === "Participant Details" ? "Configure report" : "Retrieve report"}
              aria-label={report === "Payment Summary" || report === "Participant Details" ? `Configure ${report}` : `Retrieve ${report}`}
              style={{ border: "1px solid var(--color-table-border)", color: "var(--color-primary)", backgroundColor: "var(--color-page-bg)" }}>
              {(report === "Payment Summary" && exportingPaymentSummary)
                || (report === "Participant Details" && exportingParticipantDetails)
                || (report === "Event and Program Summary" && exportingEventSummary)
                || (report === "User Access" && exportingUserAccess)
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <ArchiveRestore className="h-4 w-4" />}
            </button>
          </div>
        ))}
      </div>

      <Dialog open={paymentReportOpen} onOpenChange={setPaymentReportOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Payment Summary Report</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold mb-1.5 opacity-70">Search</label>
              <input
                value={reportFilters.search ?? ""}
                onChange={e => updateReportFilter("search", e.target.value)}
                placeholder="Reg no. or contact person"
                className="w-full px-3 py-2 text-sm"
                style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-surface)" }}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5 opacity-70">Event</label>
              <select
                value={reportFilters.eventId ?? ""}
                onChange={e => updateReportFilter("eventId", e.target.value)}
                className="w-full px-3 py-2 text-sm"
                style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-surface)" }}>
                <option value="">All Events</option>
                {events.map(event => <option key={event.id} value={event.id}>{event.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5 opacity-70">Program</label>
              <select
                value={reportFilters.programId ?? ""}
                onChange={e => updateReportFilter("programId", e.target.value)}
                className="w-full px-3 py-2 text-sm"
                style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-surface)" }}>
                <option value="">All Programs</option>
                {reportPrograms.map(program => <option key={program.id} value={program.id}>{program.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5 opacity-70">Reg. Status</label>
              <select
                value={reportFilters.regStatus ?? ""}
                onChange={e => updateReportFilter("regStatus", e.target.value)}
                className="w-full px-3 py-2 text-sm"
                style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-surface)" }}>
                <option value="">All</option>
                {(Object.entries(REG_STATUS_LABEL) as [RegStatus, string][]).map(([code, label]) => (
                  <option key={code} value={code}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5 opacity-70">Payment</label>
              <select
                value={reportFilters.payStatus ?? ""}
                onChange={e => updateReportFilter("payStatus", e.target.value)}
                className="w-full px-3 py-2 text-sm"
                style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-surface)" }}>
                <option value="">All</option>
                {(Object.entries(PAYMENT_STATUS_LABEL) as [PaymentStatus, string][]).map(([code, label]) => (
                  <option key={code} value={code}>{label}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setPaymentReportOpen(false)}
              className="px-5 py-2 text-sm font-semibold"
              style={{ border: "1px solid var(--color-table-border)" }}>
              Cancel
            </button>
            <button
              type="button"
              onClick={handlePaymentSummaryExport}
              disabled={exportingPaymentSummary}
              className="px-5 py-2 text-sm font-semibold text-white inline-flex items-center justify-center gap-2"
              style={{ backgroundColor: "var(--color-primary)" }}>
              {exportingPaymentSummary && <Loader2 className="h-4 w-4 animate-spin" />}
              Generate Report
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={participantReportOpen} onOpenChange={setParticipantReportOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Participant Details Report</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold mb-1.5 opacity-70">Search</label>
              <input
                value={participantFilters.search ?? ""}
                onChange={e => updateParticipantFilter("search", e.target.value)}
                placeholder="Name, SBA ID, team..."
                className="w-full px-3 py-2 text-sm"
                style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-surface)" }}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5 opacity-70">Event</label>
              <select
                value={participantFilters.eventId ?? ""}
                onChange={e => updateParticipantFilter("eventId", e.target.value)}
                disabled={!!participantFilters.regNo}
                className="w-full px-3 py-2 text-sm"
                style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-surface)" }}>
                <option value="">All Events</option>
                {events.map(event => <option key={event.id} value={event.id}>{event.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5 opacity-70">Program</label>
              <select
                value={participantFilters.programId ?? ""}
                onChange={e => updateParticipantFilter("programId", e.target.value)}
                disabled={!!participantFilters.regNo}
                className="w-full px-3 py-2 text-sm"
                style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-surface)" }}>
                <option value="">All Programs</option>
                {participantPrograms.map(program => <option key={program.id} value={program.id}>{program.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5 opacity-70">Reg No.</label>
              <input
                value={participantFilters.regNo ?? ""}
                onChange={e => updateParticipantFilter("regNo", e.target.value)}
                placeholder="e.g. 42"
                className="w-full px-3 py-2 text-sm"
                style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-surface)" }}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5 opacity-70">Status</label>
              <select
                value={participantFilters.status ?? ""}
                onChange={e => updateParticipantFilter("status", e.target.value)}
                className="w-full px-3 py-2 text-sm"
                style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-surface)" }}>
                <option value="">All</option>
                <option value="P">Pending</option>
                <option value="C">Confirmed</option>
                <option value="X">Cancelled</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setParticipantReportOpen(false)}
              className="px-5 py-2 text-sm font-semibold"
              style={{ border: "1px solid var(--color-table-border)" }}>
              Cancel
            </button>
            <button
              type="button"
              onClick={handleParticipantDetailsExport}
              disabled={exportingParticipantDetails}
              className="px-5 py-2 text-sm font-semibold text-white inline-flex items-center justify-center gap-2"
              style={{ backgroundColor: "var(--color-primary)" }}>
              {exportingParticipantDetails && <Loader2 className="h-4 w-4 animate-spin" />}
              Generate Report
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
