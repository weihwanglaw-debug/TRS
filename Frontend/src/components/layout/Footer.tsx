import config from "@/data/config.json";
import { useLiveConfig } from "@/contexts/LiveConfigContext";
import { Facebook, Instagram, Linkedin, Mail, Music2, Youtube } from "lucide-react";

const iconMap: Record<string, React.ElementType> = {
  Facebook,
  Instagram,
  YouTube: Youtube,
  LinkedIn: Linkedin,
  TikTok: Music2,
};

export default function Footer() {
  const { cfg } = useLiveConfig();
  const socialLinks = [
    { platform: "Instagram", url: cfg.socialInstagramUrl },
    { platform: "YouTube", url: cfg.socialYoutubeUrl },
    { platform: "Facebook", url: cfg.socialFacebookUrl },
    { platform: "LinkedIn", url: cfg.socialLinkedInUrl },
    { platform: "TikTok", url: cfg.socialTiktokUrl },
  ].filter(link => link.url.trim());

  return (
    <footer
      id="receipt"
      className="trs-footer py-12 px-8"
      style={{ background: "var(--color-hero-bg)", color: "var(--color-hero-text)" }}
    >
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
  {/* Social icons - from live master config. Blank URLs are hidden. */}
        <div className="flex items-center gap-4">
          {socialLinks.map((link) => {
            const Icon = iconMap[link.platform] || Mail;
            return (
              <a
                key={link.platform}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="social-link p-2 hover:bg-white/10 transition-colors"
                aria-label={link.platform}
              >
                <Icon className="h-5 w-5" />
              </a>
            );
          })}
        </div>

  {/* Contact email - from live config */}
        <a
          href={`mailto:${cfg.contactEmail}`}
          className="text-sm hover:underline opacity-80"
        >
          {cfg.contactEmail}
        </a>

        {config.footer.extraLinks && config.footer.extraLinks.length > 0 && (
          <div className="flex items-center gap-4">
            {config.footer.extraLinks.map((link) => (
              <a key={link.label} href={link.href} className="text-sm hover:underline opacity-80">
                {link.label}
              </a>
            ))}
          </div>
        )}
      </div>

  {/* Copyright - from live config */}
      <div className="max-w-6xl mx-auto mt-8 pt-4 border-t border-white/20 text-center text-xs opacity-60">
        {cfg.copyrightText}
      </div>
    </footer>
  );
}
