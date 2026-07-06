import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useLiveConfig } from "@/contexts/LiveConfigContext";
import config from "@/data/config.json";
import { Sun, Moon, Trophy } from "lucide-react";
import LoginModal from "@/components/auth/LoginModal";

export default function Header() {
  const { isAuthenticated, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { cfg } = useLiveConfig();
  const navigate = useNavigate();
  const location = useLocation();
  const [loginOpen, setLoginOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Determine if on a page with hero (landing or event detail)
  const isHeroPage = location.pathname === "/" || location.pathname.startsWith("/event/");
  const isLandingPage = location.pathname === "/";
  const isPublicStyledPage = isLandingPage || location.pathname.startsWith("/event/");

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  // Scroll listener for transparent → solid header
  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", handler, { passive: true });
    handler(); // initial check
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const showSolid = !isHeroPage || scrolled;

  const navActionClass = isLandingPage
    ? "landing-nav-link"
    : "text-sm font-semibold uppercase tracking-[0.18em] hover:opacity-80 transition-opacity";

  const scrollToLandingSection = (id: string) => {
    if (!isLandingPage) {
      navigate("/");
      return;
    }
    if (id === "top") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <>
      <header
        className={[
          "fixed top-0 left-0 right-0 z-50 h-16 flex items-center justify-between px-8 transition-all duration-500",
          isPublicStyledPage ? `landing-topbar ${scrolled ? "is-scrolled" : ""}` : "",
        ].join(" ")}
        style={
          isPublicStyledPage
            ? undefined
            : {
                background: showSolid ? "var(--color-hero-bg)" : "transparent",
                color: "var(--color-hero-text)",
                backdropFilter: showSolid ? "none" : "blur(8px)",
                boxShadow: showSolid ? "0 2px 12px rgba(0,0,0,0.15)" : "none",
              }
        }
      >
        {/* Logo */}
        <Link
          to="/"
          onClick={(event) => {
            if (isLandingPage) {
              event.preventDefault();
              scrollToLandingSection("top");
            }
          }}
          className="flex items-center gap-2 font-heading font-bold text-xl"
        >
          {cfg.logoUrl ? (
            <img src={cfg.logoUrl} alt={cfg.appName} className="h-8" />
          ) : (
            <Trophy className="h-6 w-6" />
          )}
          <span>{cfg.appName}</span>
        </Link>

        {/* Right side */}
        <div className="flex items-center gap-3">
          <nav className="hidden items-center gap-8 md:flex" aria-label="Admin navigation">
            {!isAuthenticated ? (
              <button
                type="button"
                onClick={() => setLoginOpen(true)}
                className={navActionClass}
              >
                Admin Login
              </button>
            ) : (
              <>
                {config.nav.menuItems.map((item) => (
                  <Link key={item.href} to={item.href} className={navActionClass}>
                    {item.label}
                  </Link>
                ))}
                <button type="button" onClick={handleLogout} className={navActionClass}>
                  Logout
                </button>
              </>
            )}
          </nav>

          <button
            onClick={toggleTheme}
            className="p-2 hover:bg-white/10 transition-colors"
            title="Toggle theme"
          >
            {theme === "a" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>

          <div className="flex items-center gap-4 md:hidden">
            {!isAuthenticated ? (
              <button
                onClick={() => setLoginOpen(true)}
                className={navActionClass}
              >
                Admin Login
              </button>
            ) : (
              <>
                {config.nav.menuItems.map((item) => (
                  <Link key={item.href} to={item.href} className={navActionClass}>
                    {item.label}
                  </Link>
                ))}
                <button type="button" onClick={handleLogout} className={navActionClass}>
                  Logout
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </>
  );
}
