import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, CalendarDays, Users, GitBranch, ListOrdered,
  LogOut, Trophy, Shield, Settings, ChevronLeft, Menu, Sun, Moon,
  Home, UserSquare, CreditCard,
} from "lucide-react";

export default function AdminLayout() {
  const { isAuthenticated, user, logout, mustChangePassword } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const isSuperAdmin = user?.role === "superadmin";
  const [collapsed, setCollapsed] = useState(true);
  const [hovered,   setHovered]   = useState(false);

  useEffect(() => {
    if (!isAuthenticated) { navigate("/login", { replace: true }); return; }
    if (mustChangePassword) navigate("/admin/change-password", { replace: true });
  }, [isAuthenticated, mustChangePassword, navigate]);

  if (!isAuthenticated) return null;

  const links = [
    { to: "/admin",                         label: "Dashboard",             icon: LayoutDashboard, end: true  },
    { to: "/admin/events",                  label: "Events & Programs",     icon: CalendarDays,    end: false },
    { to: "/admin/registrations",           label: "Registrations",         icon: Users,           end: false },
    { to: "/admin/payment-reconciliation",  label: "Payment Reconciliation",icon: CreditCard,      end: false },
    { to: "/admin/fixtures",                label: "Fixtures",              icon: GitBranch,       end: false },
    { to: "/admin/sba-rankings",            label: "SBA Rankings",          icon: ListOrdered,     end: false },
    { to: "/admin/participants",            label: "Participant Details",   icon: UserSquare,      end: false },
    ...(isSuperAdmin ? [
      { to: "/admin/users",  label: "User Management", icon: Shield,    end: false },
      { to: "/admin/config", label: "Master Config",   icon: Settings,  end: false },
    ] : []),
    { to: "/",             label: "Landing Page",      icon: Home,      end: true  },
  ];

  const expanded = !collapsed || hovered;
  const sidebarWidth = expanded ? "w-60" : "w-16";

  return (
    <div className="flex min-h-screen">
      <aside
        className={`${sidebarWidth} fixed top-0 bottom-0 flex flex-col overflow-y-auto overflow-x-hidden transition-all duration-300 z-40`}
        style={{ background: "var(--color-hero-bg)", color: "var(--color-hero-text)" }}
        onMouseEnter={() => collapsed && setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="flex items-center justify-between px-3 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          {expanded && (
            <div className="flex items-center gap-2 px-1">
              <Trophy className="h-5 w-5 flex-shrink-0" />
              <span className="font-bold text-sm whitespace-nowrap">Admin Panel</span>
            </div>
          )}
          <button
            onClick={() => { setCollapsed(!collapsed); setHovered(false); }}
            className="p-2 hover:bg-white/10 transition-colors flex-shrink-0"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed && !hovered ? <Menu className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        <nav className="flex-1 space-y-1 py-4">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              title={!expanded ? link.label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 py-3 text-sm font-medium transition-colors ${
                  expanded ? "px-4" : "px-0 justify-center"
                } ${isActive ? "bg-white/15" : "hover:bg-white/10"}`
              }
            >
              <link.icon className="h-4 w-4 flex-shrink-0" />
              {expanded && <span className="whitespace-nowrap">{link.label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className={`mt-auto ${expanded ? "px-4" : "px-2"} pb-4`}>
          <button
            onClick={toggleTheme}
            title="Toggle theme"
            className={`flex items-center gap-2 text-sm hover:bg-white/10 py-2.5 w-full transition-colors ${
              expanded ? "px-3 mb-2" : "justify-center px-0 mb-2"
            }`}
          >
            {theme === "a" ? <Moon className="h-4 w-4 flex-shrink-0" /> : <Sun className="h-4 w-4 flex-shrink-0" />}
            {expanded && (theme === "a" ? "Dark Mode" : "Light Mode")}
          </button>

          {expanded && (
            <>
              <p className="text-xs opacity-60 mb-1">{user?.name}</p>
              <p className="text-xs opacity-40 mb-3 capitalize">{user?.role}</p>
            </>
          )}
          <button
            onClick={async () => { await logout(); navigate("/login", { replace: true }); }}
            title="Logout"
            className={`flex items-center gap-2 text-sm hover:bg-white/10 py-2.5 w-full transition-colors ${
              expanded ? "px-3" : "justify-center px-0"
            }`}
          >
            <LogOut className="h-4 w-4 flex-shrink-0" />
            {expanded && "Logout"}
          </button>
        </div>
      </aside>

      <main
        className="flex-1 p-6 md:p-10 transition-all duration-300 ml-16"
        style={{ backgroundColor: "var(--color-page-bg)" }}
      >
        <Outlet />
      </main>
    </div>
  );
}