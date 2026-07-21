import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Calendar, Home, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import type { TournamentEvent } from "@/types/config";
import { apiGetEvents } from "@/lib/api";
import { getEventStatus } from "@/lib/eventUtils";
import { useLiveConfig } from "@/contexts/LiveConfigContext";
import { formatConfiguredDateTime } from "@/lib/dateTime";

function eventYear(event: TournamentEvent) {
  return event.eventStartDate.slice(0, 4);
}

function statusLabel(event: TournamentEvent) {
  const status = getEventStatus(event);
  if (status === "O") return "Open";
  if (status === "U") return "Upcoming";
  return "Closed";
}

function dateOnlyPattern(pattern: string) {
  return (pattern || "dd/MM/yyyy").split(/\s+/)[0] || "dd/MM/yyyy";
}

export default function EventsArchive() {
  const navigate = useNavigate();
  const { cfg } = useLiveConfig();
  const [events, setEvents] = useState<TournamentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [year, setYear] = useState("all");

  useEffect(() => {
    apiGetEvents({ publicArchive: true })
      .then((result) => {
        if (result.data) setEvents(result.data);
      })
      .finally(() => setLoading(false));
  }, []);

  const years = useMemo(() => {
    return Array.from(new Set(events.map(eventYear))).sort((a, b) => b.localeCompare(a));
  }, [events]);

  const filteredEvents = useMemo(() => {
    const term = search.trim().toLowerCase();
    return events
      .filter((event) => year === "all" || eventYear(event) === year)
      .filter((event) => {
        if (!term) return true;
        return event.name.toLowerCase().includes(term) || event.venue.toLowerCase().includes(term);
      })
      .sort((a, b) => {
        const statusA = getEventStatus(a);
        const statusB = getEventStatus(b);
        if (statusA === "O" && statusB !== "O") return -1;
        if (statusA !== "O" && statusB === "O") return 1;
        if (statusA === "U" && statusB === "CL") return -1;
        if (statusA === "CL" && statusB === "U") return 1;
        return new Date(b.eventStartDate).getTime() - new Date(a.eventStartDate).getTime();
      });
  }, [events, search, year]);

  const configuredDate = (value: string) =>
    formatConfiguredDateTime(value, cfg.displayTimeZone, dateOnlyPattern(cfg.displayDateTimeFormat));

  return (
    <div className="landing-shell min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        <section className="landing-section white section-anchor trs-events-archive">
          <div className="landing-section-inner">
            <div className="trs-events-archive-header">
              <div>
                <p className="landing-section-label" style={{ textAlign: "left" }}>Events archive /</p>
                <h1 className="landing-section-title" style={{ marginLeft: 0, textAlign: "left" }}>
                  All Events
                </h1>
              </div>
              <button type="button" className="landing-button secondary" onClick={() => navigate("/")}>
                <Home className="h-4 w-4" /> Back to Home
              </button>
            </div>

            <div className="trs-events-filter">
              <div className="trs-field">
                <label htmlFor="events-archive-search">Search</label>
                <div className="trs-events-search">
                  <Search className="h-4 w-4" />
                  <input
                    id="events-archive-search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Event name or venue"
                  />
                </div>
              </div>
              <div className="trs-field">
                <label htmlFor="events-archive-year">Year</label>
                <select id="events-archive-year" value={year} onChange={(event) => setYear(event.target.value)}>
                  <option value="all">All Years</option>
                  {years.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>
            </div>

            {loading ? (
              <div className="trs-events-empty">
                <p className="landing-display text-xl font-bold uppercase">Loading Events</p>
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="trs-events-empty">
                <Calendar className="h-8 w-8 opacity-30" />
                <p className="landing-display text-xl font-bold uppercase">No Events Found</p>
                <p className="text-sm opacity-60">Try a different search term or year.</p>
              </div>
            ) : (
              <div className="trs-events-table-wrap">
                <div className="trs-events-table-head">
                  <span>Event</span>
                  <span>Event Date</span>
                  <span>Registration Date</span>
                  <span>Status</span>
                  <span></span>
                </div>
                <div className="trs-events-table-body">
                  {filteredEvents.map((event) => {
                  const eventDateLabel = `${configuredDate(event.eventStartDate)} - ${configuredDate(event.eventEndDate)}`;
                  const registrationDateLabel = `${configuredDate(event.openDate)} - ${configuredDate(event.closeDate)}`;
                  return (
                    <button
                      key={event.id}
                      type="button"
                      className="trs-events-row"
                      onClick={() => navigate(`/event/${event.id}`)}
                    >
                      <div className="trs-events-row-main">
                        <span className="trs-events-row-title">{event.name}</span>
                        <span className="trs-events-row-type">{event.isSports ? "Sports Event" : "Non Sports Event"}</span>
                      </div>
                      <div className="trs-events-row-cell">
                        <Calendar className="h-4 w-4" />
                        <span>{eventDateLabel}</span>
                      </div>
                      <div className="trs-events-row-cell">
                        <Calendar className="h-4 w-4" />
                        <span>{registrationDateLabel}</span>
                      </div>
                      <span className={`trs-events-row-status is-${getEventStatus(event).toLowerCase()}`}>
                        {statusLabel(event)}
                      </span>
                      <span className="trs-events-row-action">
                        View <ArrowRight className="h-4 w-4" />
                      </span>
                    </button>
                  );
                })}
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
