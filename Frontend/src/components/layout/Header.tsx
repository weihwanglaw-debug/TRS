import { useState, useEffect, useRef } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useLiveConfig } from "@/contexts/LiveConfigContext";
import config from "@/data/config.json";
import { LogOut, ChevronDown, Sun, Moon, Trophy } from "lucide-react";
import LoginModal from "@/components/auth/LoginModal";

export default function Header() {
  const { isAuthenticated, user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { cfg } = useLiveConfig();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);

  // Determine if on a page with hero (landing or event detail)
  const isHeroPage = location.pathname === "/" || location.pathname.startsWith("/event/");

  const handleLogout = () => {
    logout();
    setMenuOpen(false);
    navigate("/");
  };

  // Scroll listener for transparent → solid header
  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", handler, { passive: true });
    handler(); // initial check
    return () => window.removeEventListener("scroll", handler);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const showSolid = !isHeroPage || scrolled;

  return (
    <>
      <header
        className="fixed top-0 left-0 right-0 z-50 h-16 flex items-center justify-between px-8 transition-all duration-500"
        style={{
          background: showSolid ? "var(--color-hero-bg)" : "transparent",
          color: "var(--color-hero-text)",
          backdropFilter: showSolid ? "none" : "blur(8px)",
          boxShadow: showSolid ? "0 2px 12px rgba(0,0,0,0.15)" : "none",
        }}
      >
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 font-heading font-bold text-xl">
          {cfg.logoUrl ? (
            <img src={cfg.logoUrl} alt={cfg.appName} className="h-8" />
          ) : (
            <Trophy className="h-6 w-6" />
          )}
          <span>{cfg.appName}</span>
        </Link>

        {/* Right side */}
        <div className="flex items-center gap-3">
          <button
            onClick={toggleTheme}
            className="p-2 hover:bg-white/10 transition-colors"
            title="Toggle theme"
          >
            {theme === "a" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>

          {!isAuthenticated ? (
            <button
              onClick={() => setLoginOpen(true)}
              className="btn-primary px-5 py-2 text-sm font-semibold"
            >
              Admin Login
            </button>
          ) : (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex items-center gap-2 px-3 py-2 hover:bg-white/10 transition-colors text-sm font-medium"
              >
                {user?.name}
                <ChevronDown className="h-4 w-4" />
              </button>
              {menuOpen && (
                <div
                  className="absolute right-0 top-full mt-1 w-48 shadow-lg py-1 z-50"
                  style={{ background: "var(--color-page-bg)", color: "var(--color-body-text)" }}
                >
                  {config.nav.menuItems.map((item) => (
                    <Link
                      key={item.href}
                      to={item.href}
                      onClick={() => setMenuOpen(false)}
                      className="block px-4 py-2.5 text-sm hover:bg-black/5 transition-colors"
                    >
                      {item.label}
                    </Link>
                  ))}
                  <hr style={{ borderColor: "var(--color-table-border)" }} />
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-black/5 transition-colors flex items-center gap-2"
                  >
                    <LogOut className="h-4 w-4" /> Logout
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </>
  );
}
