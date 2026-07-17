import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { TournamentEvent } from "@/types/config";
import { apiGetEvents } from "@/lib/api";
import { getEventStatus, formatDate } from "@/lib/eventUtils";
import StatusBadge from "@/components/events/StatusBadge";
import ActionDropdownPortal from "@/components/ui/ActionDropdownPortal";
import { PageLoader } from "@/components/ui/LoadingSpinner";
import { ActionFeedbackDialog, type ActionFeedbackVariant } from "@/components/ui/ActionFeedbackDialog";
import { Plus, Eye, Users, MoreVertical } from "lucide-react";

export default function AdminEvents() {
  const navigate = useNavigate();
  const [events,         setEvents]         = useState<TournamentEvent[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [filterStatus,   setFilterStatus]   = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo,   setFilterDateTo]   = useState("");
  const [filterRegStatus,setFilterRegStatus]= useState("");
  const [openAction,     setOpenAction]     = useState<{ id: string; anchorEl: HTMLElement } | null>(null);
  const [feedback, setFeedback] = useState<{
    open: boolean;
    variant: ActionFeedbackVariant;
    title: string;
    description?: string;
  }>({ open: false, variant: "info", title: "" });

  useEffect(() => {
    apiGetEvents({ includeInactive: true })
      .then(r => {
        if (r.data) setEvents(r.data);
        else if (r.error) setFeedback({ open: true, variant: "error", title: "Events could not be loaded", description: r.error.message });
      })
      .catch(() => setFeedback({
        open: true,
        variant: "error",
        title: "Events could not be loaded",
        description: "Please check your connection and try again.",
      }))
      .finally(() => setLoading(false));
  }, []);

  // close handled by ActionDropdownPortal

  const filtered = useMemo(() => events.filter(ev => {
    const regStatus = getEventStatus(ev);
    if (filterStatus && getEventStatus(ev) !== filterStatus) return false;
    if (filterRegStatus && regStatus !== filterRegStatus) return false;
    if (filterDateFrom) { const to = ev.eventEndDate || ev.eventStartDate; if (to < filterDateFrom) return false; }
    if (filterDateTo) { const from = ev.eventStartDate; if (from > filterDateTo) return false; }
    return true;
  }), [events, filterStatus, filterRegStatus, filterDateFrom, filterDateTo]);

  const clearFilters = () => { setFilterStatus(""); setFilterDateFrom(""); setFilterDateTo(""); setFilterRegStatus(""); };
  const hasFilter = filterStatus || filterDateFrom || filterDateTo || filterRegStatus;

  if (loading) return <PageLoader label="Loading events..." />;

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
        <div className="admin-page-title" style={{ marginBottom: 0 }}><h1>Events &amp; Programs</h1></div>
        <button onClick={() => navigate("/admin/events/new")}
          className="btn-primary flex items-center gap-2 px-5 py-2.5 text-sm font-semibold">
          <Plus className="h-4 w-4" /> Create Event
        </button>
      </div>

  {/* Filters */}
      <div className="p-5 mb-6" style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
        <div className="grid grid-cols-2 md:flex md:flex-wrap items-end gap-4">
          <FG label="Event Status">
            <select className="field-input w-full md:w-36" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All</option><option value="D">Draft</option><option value="O">Open</option><option value="PA">Paused</option><option value="U">Upcoming</option><option value="CL">Closed</option>
            </select>
          </FG>
          <FG label="Reg. Status">
            <select className="field-input w-full md:w-36" value={filterRegStatus} onChange={e => setFilterRegStatus(e.target.value)}>
              <option value="">All</option><option value="D">Draft</option><option value="O">Open</option><option value="PA">Paused</option><option value="U">Upcoming</option><option value="CL">Closed</option>
            </select>
          </FG>
          <FG label="From">
            <input type="date" className="field-input w-full md:w-40" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} />
          </FG>
          <FG label="To">
            <input type="date" className="field-input w-full md:w-40" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} />
          </FG>
          {hasFilter && (
            <button onClick={clearFilters} className="btn-outline px-4 py-2 text-xs font-medium col-span-2 md:col-span-1">Clear</button>
          )}
        </div>
        {hasFilter && <p className="text-xs mt-3 opacity-50">Showing {filtered.length} of {events.length} events</p>}
      </div>

  {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto" style={{ border: "1px solid var(--color-table-border)" }}>
        <table className="trs-table">
          <thead>
            <tr>
              <th>Event Name</th><th>Sport</th><th>Event Date</th><th>Reg. Period</th>
              <th>Reg. Status</th><th>Programs</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(event => {
              const status = getEventStatus(event);
              return (
                <tr key={event.id}>
                  <td className="font-medium">{event.name}</td>
                  <td className="text-sm opacity-70">{event.isSports ? event.sportType || "Sports" : "Non-sports"}</td>
                  <td className="text-sm">{formatDate(event.eventStartDate)} - {formatDate(event.eventEndDate)}</td>
                  <td className="text-sm opacity-70">{formatDate(event.openDate)} - {formatDate(event.closeDate)}</td>
                  <td><StatusBadge status={status} /></td>
                  <td className="text-sm">{event.programs.length}</td>
                  <td>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={(e) =>
                          setOpenAction(openAction?.id === event.id ? null : { id: event.id, anchorEl: e.currentTarget })
                        }
                        className="action-trigger"
                        aria-label={`Open actions for ${event.name}`}>
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="text-center py-10 opacity-40">No events found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

  {/* Mobile card list */}
      <div className="md:hidden space-y-3">
        {filtered.map(event => {
          const status = getEventStatus(event);
          return (
            <div key={event.id} className="p-5" style={{ border: "1px solid var(--color-table-border)" }}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{event.name}</p>
                  <p className="text-xs opacity-50 mt-0.5">{event.isSports ? event.sportType : "Non-sports"} - {event.programs.length} programs</p>
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <StatusBadge status={status} />
                  <div className="relative">
                    <button
                      type="button"
                      onClick={(e) =>
                        setOpenAction(openAction?.id === event.id ? null : { id: event.id, anchorEl: e.currentTarget })
                      }
                      className="action-trigger"
                      aria-label={`Open actions for ${event.name}`}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </div>

                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs opacity-70">
                <div><span className="opacity-50">Event: </span>{formatDate(event.eventStartDate)} - {formatDate(event.eventEndDate)}</div>
                <div><span className="opacity-50">Reg: </span>{formatDate(event.openDate)} - {formatDate(event.closeDate)}</div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <p className="text-center py-10 opacity-40">No events found.</p>}
      </div>

      <ActionDropdownPortal
        open={!!openAction}
        anchorEl={openAction?.anchorEl ?? null}
        onClose={() => setOpenAction(null)}
      >
        <button onClick={() => { if (!openAction) return; navigate(`/admin/events/${openAction.id}`); setOpenAction(null); }}>
          <Eye className="h-4 w-4" /> View / Edit
        </button>
        <button onClick={() => { if (!openAction) return; navigate(`/admin/registrations?event=${openAction.id}`); setOpenAction(null); }}>
          <Users className="h-4 w-4" /> Registrations
        </button>
      </ActionDropdownPortal>
    </div>
  );
}

function FG({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div><label className="block text-xs font-semibold mb-1.5 opacity-60">{label}</label>{children}</div>);
}
