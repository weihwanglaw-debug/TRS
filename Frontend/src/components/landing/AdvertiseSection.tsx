import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ExternalLink } from "lucide-react";
import { motion } from "framer-motion";
import { useLiveConfig } from "@/contexts/LiveConfigContext";
import { assetUrl } from "@/lib/api";
import defaultAdBg from "@/assets/court-booking-ad.jpg";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function overlayAlpha(progress: number) {
  const minAlpha = 0.2;
  const maxAlpha = 0.88;
  return minAlpha + progress * (maxAlpha - minAlpha);
}

export default function AdvertiseSection() {
  const { cfg } = useLiveConfig();
  const sectionRef = useRef<HTMLElement>(null);
  const [alpha, setAlpha] = useState(0.2);

  useEffect(() => {
    const update = () => {
      const el = sectionRef.current;
      if (!el) return;

      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const viewportHeight = window.innerHeight;
      const sectionTop = el.offsetTop;
      const sectionHeight = el.offsetHeight || 1;
      const start = sectionTop - viewportHeight;
      const end = Math.max(start + 1, sectionTop + sectionHeight - viewportHeight);
      const progress = clamp((scrollTop - start) / Math.max(end - start, 1), 0, 1);
      setAlpha(overlayAlpha(progress));
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  if (cfg.adEnabled === "false" || (!cfg.adTitle && !cfg.adUrl && !cfg.adBody)) return null;

  const adImage = cfg.adImageUrl ? assetUrl(cfg.adImageUrl) : defaultAdBg;
  const adTitle = cfg.adTitle || "Book a Badminton Court";
  const adBody =
    cfg.adBody ||
    "Need to practice before the tournament? Book courts at Wyse Active Hub - flexible scheduling, professional facilities, and competitive rates.";
  const adTag = cfg.adTag || "Partner Venue";
  const buttonLabel = cfg.adButtonLabel || "Book Now";

  return (
    <section
      ref={sectionRef}
      id="details"
      className="trs-ad-section section-anchor"
      style={{
        "--ad-bg": `url(${adImage})`,
        "--ad-overlay-alpha": alpha.toFixed(3),
      } as CSSProperties}
    >
      <div className="trs-ad-layout">
        <motion.figure
          className="trs-ad-media"
          aria-label="Partner venue image"
          initial={{ opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
        >
          <img src={adImage} alt={adTitle} />
        </motion.figure>

        <motion.div
          className="trs-ad-copy"
          initial={{ opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ delay: 0.1 }}
        >
          <p className="landing-eyebrow">{adTag} /</p>
          <h2>{adTitle}</h2>
          <p>{adBody}</p>
          <a
            className="landing-button mt-8"
            href={cfg.adUrl || "#register"}
            target={cfg.adUrl ? "_blank" : undefined}
            rel={cfg.adUrl ? "noopener noreferrer" : undefined}
            style={{
              background: "rgb(0 0 0 / 0%)",
              border: "2px solid rgb(233 233 233 / 50%)",
            }}
          >
            {buttonLabel} {cfg.adUrl && <ExternalLink className="ml-2 h-4 w-4" />}
          </a>
        </motion.div>
      </div>
    </section>
  );
}
