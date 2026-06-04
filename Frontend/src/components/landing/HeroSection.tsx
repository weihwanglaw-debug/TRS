import { motion } from "framer-motion";
import { useLiveConfig } from "@/contexts/LiveConfigContext";
import { ChevronDown } from "lucide-react";
import defaultHeroBg from "@/assets/hero-bg.jpg";

export default function HeroSection() {
  const { cfg } = useLiveConfig();
  const bgImage = cfg.heroImageUrl || defaultHeroBg;

  const scrollToEvents = () => {
    const el = document.getElementById("events-section");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section
      className="relative flex items-end overflow-hidden group cursor-default"
      style={{ minHeight: "600px", paddingTop: "6rem" }}
    >
      {/* Background image — scales on hover like AdvertiseSection */}
      <motion.div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-transform duration-700 group-hover:scale-105"
        style={{ backgroundImage: `url(${bgImage})` }}
        initial={{ scale: 1.1 }}
        animate={{ scale: 1 }}
        transition={{ duration: 12, ease: "easeOut" }}
      />

      {/* Dark overlay */}
      <div
        className="absolute inset-0 transition-all duration-500"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.55) 50%, rgba(0,0,0,0.85) 100%)",
        }}
      />

      {/* Animated accent line at bottom */}
      <motion.div
        className="absolute bottom-0 left-0 h-1"
        style={{ backgroundColor: "var(--color-primary)" }}
        initial={{ width: "0%" }}
        animate={{ width: "100%" }}
        transition={{ duration: 1.5, ease: "easeOut", delay: 0.5 }}
      />

      {/* Content */}
      <div className="relative z-10 max-w-6xl w-full mx-auto px-8 pb-16">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
        >
          <p
            className="text-xs font-bold uppercase tracking-widest mb-4"
            style={{ color: "var(--color-primary)" }}
          >
            Tournament Registration
          </p>
          <h1
            className="font-heading font-bold text-4xl md:text-5xl lg:text-6xl leading-tight mb-5"
            style={{ color: "#ffffff", maxWidth: "700px" }}
          >
            {cfg.heroTitle}
          </h1>
          <p
            className="text-base md:text-lg mb-8"
            style={{ color: "rgba(255,255,255,0.75)", maxWidth: "520px" }}
          >
            {cfg.heroSubtitle}
          </p>
          <button
            onClick={scrollToEvents}
            className="inline-flex items-center gap-2 px-7 py-3 text-sm font-semibold transition-all duration-300 hover:gap-3"
            style={{
              backgroundColor: "var(--color-primary)",
              color: "var(--color-hero-text)",
            }}
          >
            View Events <ChevronDown className="h-4 w-4" />
          </button>
        </motion.div>

        {/* Decorative floating particles */}
        <div className="absolute right-8 bottom-16 pointer-events-none hidden lg:block">
          {[...Array(6)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute w-1.5 h-1.5"
              style={{
                backgroundColor: "var(--color-primary)",
                opacity: 0.3,
                right: `${i * 40}px`,
                bottom: `${(i % 3) * 60}px`,
              }}
              animate={{
                y: [0, -15, 0],
                opacity: [0.15, 0.5, 0.15],
              }}
              transition={{
                duration: 3 + i * 0.4,
                repeat: Infinity,
                ease: "easeInOut",
                delay: i * 0.3,
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}