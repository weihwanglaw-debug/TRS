import { useEffect, useState } from "react";
import { Calendar, MapPin } from "lucide-react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import type { TournamentEvent } from "@/types/config";
import { apiGetEvents, assetUrl } from "@/lib/api";
import { formatDate, getEventStatus } from "@/lib/eventUtils";
import eventBanner1 from "@/assets/event-banner-1.jpg";
import eventBanner2 from "@/assets/event-banner-2.jpg";
import eventBanner3 from "@/assets/event-banner-3.jpg";

const FALLBACK_BANNERS = [eventBanner1, eventBanner2, eventBanner3];

export default function EventCarousel() {
  const navigate = useNavigate();
  const [visibleEvents, setVisibleEvents] = useState<TournamentEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGetEvents()
      .then((r) => {
        if (!r.data) return;
        setVisibleEvents(
          r.data
            .filter((event) => {
              const status = getEventStatus(event);
              return status === "open" || status === "upcoming";
            })
            .sort((a, b) => {
              const statusA = getEventStatus(a);
              const statusB = getEventStatus(b);
              if (statusA === "open" && statusB !== "open") return -1;
              if (statusA !== "open" && statusB === "open") return 1;
              return new Date(a.eventStartDate).getTime() - new Date(b.eventStartDate).getTime();
            }),
        );
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <section id="events-section" className="landing-section white section-anchor">
      <div className="landing-section-inner">
        <motion.p
          className="landing-section-label"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
        >
          Featured events /
        </motion.p>
        <motion.h2
          className="landing-section-title"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ delay: 0.06 }}
        >
          Choose your tournament and continue registration
        </motion.h2>

        {!loading && visibleEvents.length === 0 && (
          <motion.div
            className="flex flex-col items-center justify-center py-24 text-center"
            style={{ border: "1px solid var(--landing-line)" }}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="mb-6 flex h-16 w-16 items-center justify-center" style={{ border: "2px solid var(--landing-line)" }}>
              <Calendar className="h-7 w-7 opacity-30" />
            </div>
            <p className="landing-display mb-2 text-xl font-bold uppercase">No Events Scheduled</p>
            <p className="max-w-sm text-sm opacity-60">
              There are no open or upcoming events at the moment. Check back soon for new tournaments.
            </p>
          </motion.div>
        )}

        {visibleEvents.length > 0 && (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {visibleEvents.map((event, index) => {
              const status = getEventStatus(event);
              const bannerImage = event.bannerUrl ? assetUrl(event.bannerUrl) : FALLBACK_BANNERS[index % FALLBACK_BANNERS.length];
              const dateLabel = `${formatDate(event.eventStartDate)} - ${formatDate(event.eventEndDate)}`;
              const statusLabel = status === "open" ? "Open" : "Upcoming";

              return (
                <motion.article
                  key={event.id}
                  className="trs-event-card"
                  initial={{ opacity: 0, y: 22 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ delay: index * 0.08 }}
                  onClick={() => navigate(`/event/${event.id}`)}
                >
                  <div className="trs-event-image-wrap">
                    <div
                      className="trs-event-image"
                      style={{
                        backgroundImage: `linear-gradient(rgb(196 43 43 / 20%), rgb(47 46 46 / 14%)), url(${bannerImage})`,
                      }}
                    />
                    <span className="trs-event-status">{statusLabel}</span>
                    <span className="trs-event-date-badge">{dateLabel}</span>
                  </div>
                  <div className="trs-ticket-tear">
                    <span className="trs-tear-hole left" />
                    <span className="trs-tear-hole right" />
                  </div>
                  <div className="trs-event-card-body">
                    <h3>{event.name}</h3>
                    <p className="line-clamp-2 text-sm opacity-75">{event.description}</p>
                    <div className="grid gap-2 text-sm opacity-75">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        <span>{dateLabel}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4" />
                        <span className="line-clamp-1">{event.venue}</span>
                      </div>
                    </div>
                    <button type="button" className="landing-button secondary justify-self-start">
                      View Event <span aria-hidden="true">-&gt;</span>
                    </button>
                  </div>
                </motion.article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
