import { useState, useMemo, useEffect } from "react";
import { Plus, Edit2, Key, Trash2, Eye, EyeOff, Check, MoreVertical } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import ActionDropdownPortal from "@/components/ui/ActionDropdownPortal";
import {
  apiGetUsers, apiCreateUser, apiUpdateUser,
  apiDeleteUser, apiResetUserPassword,
} from "@/lib/api";
import type { AdminUser } from "@/types/config";

type ModalMode = "create" | "edit" | "reset" | null;

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const [users,   setUsers]   = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState("");

  const loadUsers = () =>
    apiGetUsers().then(r => { if (r.data) setUsers(r.data); }).finally(() => setLoading(false));

  useEffect(() => { loadUsers(); }, []);

  const [modal, setModal] = useState<ModalMode>(null);
  const [target, setTarget] = useState<AdminUser | null>(null);
  const [delConf, setDelConf] = useState<string | null>(null);
  const [openAction, setOpenAction] = useState<{ user: AdminUser; anchorEl: HTMLElement } | null>(null);

  const [fName, setFName] = useState("");
  const [fEmail, setFEmail] = useState("");
  const [fRole, setFRole] = useState<"superadmin" | "eventadmin">("eventadmin");
  const [fPass, setFPass] = useState("");
  const [fPass2, setFPass2] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const openCreate = () => { setTarget(null); setFName(""); setFEmail(""); setFRole("eventadmin"); setFPass(""); setFPass2(""); setErrors({}); setModal("create"); };
  const openEdit = (u: AdminUser) => { setTarget(u); setFName(u.name); setFEmail(u.email); setFRole(u.role); setFPass(""); setFPass2(""); setErrors({}); setModal("edit"); };
  const openReset = (u: AdminUser) => { setTarget(u); setFPass(""); setFPass2(""); setErrors({}); setModal("reset"); };

  const validate = (mode: ModalMode) => {
    const e: Record<string, string> = {};
    if (mode !== "reset") {
      if (!fName.trim()) e.name = "Required";
      if (!fEmail.trim()) e.email = "Required";
      else if (!/\S+@\S+\.\S+/.test(fEmail)) e.email = "Invalid email";
    }
    if (mode === "create" || mode === "reset") {
      if (!fPass.trim()) e.pass = "Required";
      else if (fPass.length < 8) e.pass = "Min 8 characters";
      if (fPass !== fPass2) e.pass2 = "Passwords do not match";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!validate(modal)) return;
    setSaving(true);
    setApiError("");
    try {
      if (modal === "create") {
        const r = await apiCreateUser({ name: fName, email: fEmail, role: fRole, password: fPass, mustChangePassword: false });
        if (r.error) {
          if (r.error.code === "EMAIL_TAKEN") setErrors(p => ({ ...p, email: "Email already in use" }));
          else setApiError(r.error.message);
          return;
        }
      } else if (modal === "edit" && target) {
        const r = await apiUpdateUser(target.id, { name: fName, email: fEmail, role: fRole });
        if (r.error) {
          if (r.error.code === "EMAIL_TAKEN") setErrors(p => ({ ...p, email: "Email already in use" }));
          else setApiError(r.error.message);
          return;
        }
      } else if (modal === "reset" && target) {
        const r = await apiResetUserPassword(target.id, fPass);
        if (r.error) { setApiError(r.error.message); return; }
      }
      await loadUsers();
      setModal(null);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!delConf || !currentUser) return;
    const r = await apiDeleteUser(delConf, currentUser.id);
    if (r.error) { setApiError(r.error.message); }
    else { await loadUsers(); }
    setDelConf(null);
  };

  const isSelf = (u: AdminUser) => u.id === currentUser?.id;
  const roleLabel = (r: string) => r === "superadmin" ? "Super Admin" : "Event Admin";
  const roleBadge = (r: string) => ({ bg: r === "superadmin" ? "var(--color-primary)" : "var(--badge-soon-bg)", text: r === "superadmin" ? "var(--color-hero-text)" : "var(--badge-soon-text)" });

  if (loading) return (
    <div className="flex items-center justify-center py-20 opacity-40 text-sm">Loading users…</div>
  );

  return (
    <div>
      {apiError && (
        <div className="mb-4 px-4 py-3 text-sm font-medium"
          style={{ backgroundColor: "var(--badge-closed-bg)", color: "var(--badge-closed-text)", border: "1px solid var(--badge-closed-text)" }}>
          {apiError}
        </div>
      )}
      <div className="flex items-center justify-between mb-8">
        <div className="admin-page-title" style={{ marginBottom: 0 }}><h1>User Management</h1></div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2 px-5 py-2.5 text-sm font-semibold"><Plus className="h-4 w-4" /> Add User</button>
      </div>

      {/* Role legend */}
      <div className="flex flex-wrap gap-4 mb-6 text-xs">
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: "var(--color-primary)", color: "var(--color-hero-text)" }}>Super Admin</span>
          <span className="opacity-60">Full access</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: "var(--badge-soon-bg)", color: "var(--badge-soon-text)" }}>Event Admin</span>
          <span className="opacity-60">Events, registrations, fixtures only</span>
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block" style={{ border: "1px solid var(--color-table-border)" }}>
        <table className="trs-table w-full">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last Login</th><th>Actions</th></tr></thead>
          <tbody>
            {users.map(u => {
              const rb = roleBadge(u.role);
              return (
                <tr key={u.id}>
                  <td className="font-medium text-sm">{u.name}{isSelf(u) && <span className="ml-2 text-xs opacity-40">(you)</span>}</td>
                  <td className="text-sm opacity-70 font-mono">{u.email}</td>
                  <td><span className="inline-flex px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: rb.bg, color: rb.text }}>{roleLabel(u.role)}</span></td>
                  <td className="text-xs opacity-50">{u.lastLogin || "Never"}</td>
                  <td>
                    <div className="relative">
                      <button
                        onClick={(e) =>
                          setOpenAction(openAction?.user.id === u.id ? null : { user: u, anchorEl: e.currentTarget })
                        }
                        className="p-2 hover:opacity-70 transition-opacity" style={{ color: "var(--color-primary)" }}>
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && <tr><td colSpan={5} className="text-center py-10 opacity-40">No users.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden space-y-3">
        {users.map(u => {
          const rb = roleBadge(u.role);
          return (
            <div key={u.id} className="p-5" style={{ border: "1px solid var(--color-table-border)" }}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-medium text-sm">{u.name}{isSelf(u) && <span className="ml-2 text-xs opacity-40">(you)</span>}</p>
                  <p className="text-xs opacity-60 font-mono">{u.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: rb.bg, color: rb.text }}>{roleLabel(u.role)}</span>
                  <div className="relative">
                    <button
                      onClick={(e) =>
                        setOpenAction(openAction?.user.id === u.id ? null : { user: u, anchorEl: e.currentTarget })
                      }
                      className="p-1.5 opacity-50"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-xs opacity-50">Last login: {u.lastLogin || "Never"}</p>
            </div>
          );
        })}
      </div>

      {/* FIX: wrap children in openAction guard — same pattern as EventEdit.tsx fix.
          disabled/style props that access openAction.user evaluate on every render,
          including the render triggered when onClose() sets openAction → null.
          Without this guard they crash with "Cannot read properties of null (reading 'user')". */}
      <ActionDropdownPortal
        open={!!openAction}
        anchorEl={openAction?.anchorEl ?? null}
        onClose={() => setOpenAction(null)}
      >
        {openAction && (
          <>
            <button onClick={() => { openEdit(openAction.user); setOpenAction(null); }}>
              <Edit2 className="h-4 w-4" /> Edit
            </button>
            <button onClick={() => { openReset(openAction.user); setOpenAction(null); }}>
              <Key className="h-4 w-4" /> Reset Password
            </button>
            <button
              disabled={isSelf(openAction.user)}
              onClick={() => {
                if (!isSelf(openAction.user)) setDelConf(openAction.user.id);
                setOpenAction(null);
              }}
              style={{ color: !isSelf(openAction.user) ? "var(--badge-open-text)" : undefined }}
            >
              <Trash2 className="h-4 w-4" /> {isSelf(openAction.user) ? "Cannot delete self" : "Delete"}
            </button>
          </>
        )}
      </ActionDropdownPortal>

      {/* Modals */}
      <Dialog open={modal === "create" || modal === "edit"} onOpenChange={v => { if (!v) setModal(null); }}>
        <DialogContent className="max-w-md p-0" style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)" }}>
          <DialogHeader className="p-8 pb-0"><DialogTitle className="font-bold text-xl">{modal === "create" ? "Add User" : `Edit User — ${target?.name}`}</DialogTitle></DialogHeader>
          <div className="p-8 pt-4 space-y-4">
            <FF label="Full Name *" error={errors.name}><input className="field-input" value={fName} onChange={e => setFName(e.target.value)} placeholder="e.g. Jane Tan" /></FF>
            <FF label="Email *" error={errors.email}><input className="field-input" type="email" value={fEmail} onChange={e => setFEmail(e.target.value)} placeholder="jane@example.com" /></FF>
            <FF label="Role"><select className="field-input" value={fRole} onChange={e => setFRole(e.target.value as "superadmin" | "eventadmin")}><option value="eventadmin">Event Admin</option><option value="superadmin">Super Admin</option></select></FF>
            {modal === "create" && (
              <><FF label="Password *" error={errors.pass}><div className="flex"><input className="field-input flex-1" type={showPass ? "text" : "password"} value={fPass} onChange={e => setFPass(e.target.value)} placeholder="Min. 8 characters" /><button type="button" onClick={() => setShowPass(!showPass)} className="field-input-icon px-3 opacity-60 hover:opacity-90" style={{ border: "1px solid var(--color-table-border)", borderLeft: "none" }}>{showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></FF>
              <FF label="Confirm Password *" error={errors.pass2}><input className="field-input" type={showPass ? "text" : "password"} value={fPass2} onChange={e => setFPass2(e.target.value)} placeholder="Re-enter" /></FF></>
            )}
          </div>
          <DialogFooter className="p-8 pt-0">
            <button onClick={() => setModal(null)} className="btn-outline px-5 py-2.5 text-sm font-medium">Cancel</button>
            <button onClick={handleSave} className="btn-primary px-5 py-2.5 text-sm font-semibold">{modal === "create" ? "Create User" : "Save Changes"}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modal === "reset"} onOpenChange={v => { if (!v) setModal(null); }}>
        <DialogContent className="max-w-md p-0" style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)" }}>
          <DialogHeader className="p-8 pb-0"><DialogTitle className="font-bold text-xl">Reset Password — {target?.name}</DialogTitle></DialogHeader>
          <div className="p-8 pt-4 space-y-4">
            <div className="p-3 text-sm" style={{ backgroundColor: "var(--badge-soon-bg)", color: "var(--badge-soon-text)" }}>Setting a new password will immediately invalidate the current one.</div>
            <FF label="New Password *" error={errors.pass}><div className="flex"><input className="field-input flex-1" type={showPass ? "text" : "password"} value={fPass} onChange={e => setFPass(e.target.value)} placeholder="Min. 8 characters" /><button type="button" onClick={() => setShowPass(!showPass)} className="field-input-icon px-3 opacity-60 hover:opacity-90" style={{ border: "1px solid var(--color-table-border)", borderLeft: "none" }}>{showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></FF>
            <FF label="Confirm *" error={errors.pass2}><input className="field-input" type={showPass ? "text" : "password"} value={fPass2} onChange={e => setFPass2(e.target.value)} placeholder="Re-enter" /></FF>
          </div>
          <DialogFooter className="p-8 pt-0">
            <button onClick={() => setModal(null)} className="btn-outline px-5 py-2.5 text-sm font-medium">Cancel</button>
            <button onClick={handleSave} className="btn-primary px-5 py-2.5 text-sm font-semibold">Reset Password</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!delConf} onOpenChange={v => { if (!v) setDelConf(null); }}>
        <DialogContent className="max-w-sm p-0" style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)" }}>
          <DialogHeader className="p-8 pb-0"><DialogTitle className="font-bold text-xl">Delete User?</DialogTitle></DialogHeader>
          <div className="p-8 pt-4"><p className="text-sm opacity-70">This will permanently delete <strong>{users.find(u => u.id === delConf)?.name}</strong>.</p></div>
          <DialogFooter className="p-8 pt-0">
            <button onClick={() => setDelConf(null)} className="btn-outline px-5 py-2.5 text-sm font-medium">Cancel</button>
            <button onClick={handleDelete} className="px-5 py-2.5 text-sm font-semibold" style={{ backgroundColor: "var(--badge-open-text)", color: "var(--color-hero-text)" }}>Delete User</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FF({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (<div><label className="block text-xs font-semibold mb-2 opacity-70">{label}</label>{children}{error && <p className="text-xs mt-1" style={{ color: "var(--badge-open-text)" }}>{error}</p>}</div>);
}