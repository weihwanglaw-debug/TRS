import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight, MapPin, Calendar } from "lucide-react";
import { motion } from "framer-motion";
import type { TournamentEvent } from "@/types/config";
import { apiGetEvents, assetUrl } from "@/lib/api";
import { getEventStatus, formatDate } from "@/lib/eventUtils";
import StatusBadge from "@/components/events/StatusBadge";
import eventBanner1 from "@/assets/event-banner-1.jpg";
import eventBanner2 from "@/assets/event-banner-2.jpg";
import eventBanner3 from "@/assets/event-banner-3.jpg";

const FALLBACK_BANNERS = [eventBanner1, eventBanner2, eventBanner3];

export default function EventCarousel() {
  const navigate = useNavigate();
  const [visibleEvents, setVisibleEvents] = useState<TournamentEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGetEvents().then(r => {
      if (!r.data) return;
      setVisibleEvents(
        r.data
          .filter(e => { const s = getEventStatus(e); return s === "open" || s === "upcoming"; })
          .sort((a, b) => {
            const sA = getEventStatus(a), sB = getEventStatus(b);
            if (sA === "open" && sB !== "open") return -1;
            if (sA !== "open" && sB === "open") return 1;
            return new Date(a.eventStartDate).getTime() - new Date(b.eventStartDate).getTime();
          })
      );
    }).finally(() => setLoading(false));
  }, []);

  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
    slidesToScroll: 1,
  });

  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setCanPrev(emblaApi.canScrollPrev());
    setCanNext(emblaApi.canScrollNext());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", onSelect);
    return () => {
      emblaApi.off("select", onSelect);
      emblaApi.off("reInit", onSelect);
    };
  }, [emblaApi, onSelect]);

  return (
    <section id="events-section" className="py-20 px-8" style={{ backgroundColor: "var(--color-page-bg)" }}>
      <div className="max-w-6xl mx-auto">
        <h2 className="font-heading font-bold text-2xl md:text-3xl mb-10">
          Current & Upcoming Events
        </h2>

        {/* Empty / loading state */}
        {!loading && visibleEvents.length === 0 && (
          <motion.div
            className="flex flex-col items-center justify-center py-24 text-center"
            style={{ border: "1px solid var(--color-table-border)" }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div
              className="w-16 h-16 flex items-center justify-center mb-6"
              style={{ border: "2px solid var(--color-table-border)" }}
            >
              <Calendar className="h-7 w-7 opacity-30" />
            </div>
            <p className="font-heading font-bold text-xl mb-2">No Events Scheduled</p>
            <p className="text-sm opacity-50 max-w-sm">
              There are no open or upcoming events at the moment. Check back soon for new tournaments.
            </p>
          </motion.div>
        )}

        {/* Carousel */}
        {visibleEvents.length > 0 && (
          <div className="relative">
            {canPrev && (
              <button
                onClick={() => emblaApi?.scrollPrev()}
                className="absolute -left-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center shadow-lg"
                style={{ backgroundColor: "var(--color-primary)", color: "var(--color-hero-text)" }}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            {canNext && (
              <button
                onClick={() => emblaApi?.scrollNext()}
                className="absolute -right-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center shadow-lg"
                style={{ backgroundColor: "var(--color-primary)", color: "var(--color-hero-text)" }}
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            )}

            <div className="overflow-hidden" ref={emblaRef}>
              <div className="flex gap-6">
                {visibleEvents.map((event, i) => {
                  const status = getEventStatus(event);
                  const bannerImage = event.bannerUrl ? assetUrl(event.bannerUrl) : FALLBACK_BANNERS[i % FALLBACK_BANNERS.length];
                  return (
                    <motion.div
                      key={event.id}
                      className="flex-none w-full sm:w-[calc(50%-12px)] lg:w-[calc(33.333%-16px)] cursor-pointer group"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.1 }}
                      onClick={() => navigate(`/event/${event.id}`)}
                    >
                      <div
                        className="overflow-hidden h-full transition-all duration-300 group-hover:shadow-xl group-hover:-translate-y-1"
                        style={{
                          backgroundColor: "var(--color-row-hover)",
                          border: "1px solid var(--color-table-border)",
                        }}
                      >
                        {/* Banner image */}
                        <div className="relative h-44 overflow-hidden">
                          <div
                            className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-110"
                            style={{ backgroundImage: `url(${bannerImage})` }}
                          />
                          <div
                            className="absolute inset-0 transition-opacity duration-300"
                            style={{
                              background: "linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.6) 100%)",
                            }}
                          />
                          <div className="absolute top-3 right-3">
                            <StatusBadge status={status} />
                          </div>
                        </div>

                        <div className="p-6">
                          <h3 className="font-heading font-bold text-lg leading-tight line-clamp-2 mb-3">
                            {event.name}
                          </h3>
                          <p
                            className="text-sm mb-5 line-clamp-2 opacity-70"
                            style={{ color: "var(--color-body-text)" }}
                          >
                            {event.description}
                          </p>
                          <div className="space-y-2 text-sm" style={{ color: "var(--color-body-text)" }}>
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4 opacity-60" />
                              <span>
                                {formatDate(event.eventStartDate)} – {formatDate(event.eventEndDate)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <MapPin className="h-4 w-4 opacity-60" />
                              <span>{event.venue}</span>
                            </div>
                          </div>
                          <div
                            className="mt-5 text-sm font-semibold flex items-center gap-1 transition-all duration-300 group-hover:gap-2"
                            style={{ color: "var(--color-primary)" }}
                          >
                            {event.programs.length} program{event.programs.length !== 1 ? "s" : ""} available →
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}