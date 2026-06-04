/**
 * Dashboard.tsx — updated
 *
 * Changes from original:
 *   1. Imports apiGetReconciliationStats (new)
 *   2. Fetches reconciliation stats alongside existing stats call
 *   3. "Pending Payments" card renamed to "Payment Reconciliation"
 *      — count is reconciliationTotal (caseA + caseB + caseC)
 *      — navigates to /admin/payments (new page) instead of /admin/registrations
 *   4. Everything else unchanged
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { TournamentEvent } from "@/types/config";
import type { RegistrationStats } from "@/lib/api";
import {
  apiGetEvents,
  apiGetRegistrationStats,
  apiGetReconciliationStats,
  apiExportRegistrations,
} from "@/lib/api";
import { exportRegistrationsCsv } from "@/lib/exportCsv";
import { apiGetFixtureStatus } from "@/lib/fixtureApi";
import { computeFixtureDashboardStats, FixtureDashboardStats } from "@/lib/fixtureStatus";
import { CalendarCheck, CalendarDays, CreditCard, Zap, ClipboardList, FileDown } from "lucide-react";
import { PageLoader } from "@/components/ui/LoadingSpinner";

export default function Dashboard() {
  const navigate = useNavigate();

  const [events,  setEvents]  = useState<TournamentEvent[]>([]);
  const [stats,   setStats]   = useState<RegistrationStats | null>(null);
  const [reconcTotal, setReconcTotal] = useState(0);
  const [fx,      setFx]      = useState<FixtureDashboardStats>({
    pendingPayments: 0, pendingFixture: 0, pendingResults: 0,
  });
  const [loading, setLoading] = useState(true);

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

  const today        = new Date().toISOString().slice(0, 10);
  const openCount    = events.filter(e => e.openDate <= today && today <= e.closeDate).length;
  const upcomingCount = events.filter(e => e.openDate > today).length;

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
      // CHANGED: was "Pending Payments" → "Payment Reconciliation"
      // CHANGED: count is reconcTotal (caseA+B+C) not just pendingPayments
      // CHANGED: navigates to /admin/payments instead of /admin/registrations
      label:  "Payment Reconciliation",
      value:  reconcTotal,
      icon:   CreditCard,
      color:  "var(--badge-closed-text)",
      bg:     reconcTotal > 0 ? "var(--badge-closed-bg)" : "var(--color-row-hover)",
      border: reconcTotal > 0 ? "var(--badge-closed-text)" : "var(--color-table-border)",
      sub:    "Payments needing attention",
      action: "/admin/payments",   // NEW route
    },
    {
      label:  "Pending Fixture Setup",
      value:  fx.pendingFixture,
      icon:   Zap,
      color:  "var(--badge-closed-text)",
      bg:     fx.pendingFixture > 0 ? "var(--badge-closed-bg)" : "var(--color-row-hover)",
      border: fx.pendingFixture > 0 ? "var(--badge-closed-text)" : "var(--color-table-border)",
      sub:    "Reg. closed — no fixture generated",
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
    const r = await apiExportRegistrations("all");
    if (!r.data) return;
    exportRegistrationsCsv("All Events", "", r.data);
  };

  const reports = [
    "Event Summary",
    "Program Registration",
    "Participant Details",
    "Payment Summary",
  ];

  if (loading) return <PageLoader label="Loading dashboard…" />;

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
          <div key={report} className="p-5 flex items-center justify-between"
            style={{ border: "1px solid var(--color-table-border)" }}>
            <span className="text-sm font-medium">{report}</span>
            <button onClick={handleExport}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5"
              style={{ color: "var(--color-primary)" }}>
              <FileDown className="h-3 w-3" /> Export CSV
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}