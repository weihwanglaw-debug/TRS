import { motion } from "framer-motion";
import { useLiveConfig } from "@/contexts/LiveConfigContext";
import { assetUrl } from "@/lib/api";
import defaultHeroBg from "@/assets/hero-bg-4k.jpg";

export default function HeroSection() {
  const { cfg } = useLiveConfig();
  const bgImage = cfg.heroImageUrl ? assetUrl(cfg.heroImageUrl) : defaultHeroBg;
  const heroTitle = cfg.heroTitle || "Singapore Badminton Tournament Registration";
  const heroSubtitle =
    cfg.heroSubtitle || "Register for upcoming tournaments, manage your entries, and stay updated on fixtures and results";

  const scrollToEvents = () => {
    const el = document.getElementById("events-section");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <>
      <section
        className="trs-hero"
        aria-labelledby="hero-title"
        style={{
          backgroundAttachment: "fixed",
          backgroundImage: `linear-gradient(90deg, var(--overlay-light-soft), var(--overlay-dark-soft)), url(${bgImage})`,
        }}
      >
        <motion.div
          className="trs-hero-content"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: -28 }}
          transition={{ duration: 0.7, ease: [0.22, 0.61, 0.36, 1] }}
        >
          <p className="trs-hero-kicker">Tournament Registration</p>
          <div className="trs-hero-panel">
            <h1 className="trs-hero-title" id="hero-title">
              {heroTitle}
            </h1>
            <div className="trs-hero-rule" />
            <p className="trs-hero-subtitle">{heroSubtitle}</p>
          </div>
        </motion.div>
      </section>

      <section className="trs-cta-band" aria-label="Primary action">
        <p>Please register now to secure your participation</p>
        <button type="button" onClick={scrollToEvents} className="landing-button">
          View Events
        </button>
      </section>
    </>
  );
}
