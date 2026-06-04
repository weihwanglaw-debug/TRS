import { motion } from "framer-motion";
import { ExternalLink } from "lucide-react";
import { useLiveConfig } from "@/contexts/LiveConfigContext";
import defaultAdBg from "@/assets/court-booking-ad.jpg";

export default function AdvertiseSection() {
  const { cfg } = useLiveConfig();

  if (cfg.adEnabled === "false" || (!cfg.adTitle && !cfg.adUrl)) return null;

  const bgImage = cfg.adImageUrl || defaultAdBg;

  return (
    <section className="py-16 px-8" style={{ backgroundColor: "var(--color-page-bg)" }}>
      <div className="max-w-6xl mx-auto">
        <motion.a
          href={cfg.adUrl || "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="block relative overflow-hidden group cursor-pointer"
          style={{ border: "1px solid var(--color-table-border)" }}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          {/* Background image */}
          <div
            className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-105"
            style={{ backgroundImage: `url(${bgImage})` }}
          />

          {/* Overlay */}
          <div
            className="absolute inset-0 transition-all duration-500"
            style={{
              background: "linear-gradient(90deg, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.5) 60%, rgba(0,0,0,0.3) 100%)",
            }}
          />

          {/* Content */}
          <div className="relative z-10 flex items-center justify-between px-10 py-14 md:py-16">
            <div className="max-w-lg">
              {cfg.adTag && (
                <p
                  className="text-xs font-bold uppercase tracking-widest mb-3"
                  style={{ color: "var(--color-primary)" }}
                >
                  {cfg.adTag}
                </p>
              )}
              <h3
                className="font-bold text-2xl md:text-3xl mb-3"
                style={{ color: "#ffffff" }}
              >
                {cfg.adTitle}
              </h3>
              {cfg.adBody && (
                <p
                  className="text-sm md:text-base mb-6"
                  style={{ color: "rgba(255,255,255,0.75)" }}
                >
                  {cfg.adBody}
                </p>
              )}
              <span
                className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold transition-all duration-300 group-hover:gap-3"
                style={{
                  backgroundColor: "var(--color-primary)",
                  color: "var(--color-hero-text)",
                }}
              >
                {cfg.adButtonLabel || "Learn More"} <ExternalLink className="h-4 w-4" />
              </span>
            </div>

            <motion.div
              className="hidden md:flex items-center justify-center w-16 h-16 flex-shrink-0"
              style={{
                border: "2px solid var(--color-primary)",
                color: "var(--color-primary)",
              }}
              whileHover={{ scale: 1.1 }}
            >
              <ExternalLink className="h-6 w-6" />
            </motion.div>
          </div>
        </motion.a>
      </div>
    </section>
  );
}