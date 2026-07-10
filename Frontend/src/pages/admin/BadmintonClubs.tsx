import { useEffect, useMemo, useState } from "react";
import { Edit2, Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  apiCreateBadmintonClub,
  apiDeleteBadmintonClub,
  apiGetBadmintonClubs,
  apiUpdateBadmintonClub,
} from "@/lib/api";
import type { BadmintonClub, BadmintonClubInput } from "@/types/config";
import { ActionFeedbackDialog, type ActionFeedbackVariant } from "@/components/ui/ActionFeedbackDialog";

type ModalMode = "create" | "edit" | null;

const emptyForm: BadmintonClubInput = {
  name: "",
  contactNumber: "",
  email: "",
  address: "",
  country: "",
};

export default function BadmintonClubs() {
  const [clubs, setClubs] = useState<BadmintonClub[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    open: boolean;
    variant: ActionFeedbackVariant;
    title: string;
    description?: string;
  }>({ open: false, variant: "info", title: "" });
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<ModalMode>(null);
  const [target, setTarget] = useState<BadmintonClub | null>(null);
  const [form, setForm] = useState<BadmintonClubInput>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<BadmintonClub | null>(null);

  const loadClubs = async () => {
    setLoading(true);
    const r = await apiGetBadmintonClubs();
    if (r.data) setClubs(r.data);
    if (r.error) setFeedback({ open: true, variant: "error", title: "Failed to load clubs", description: r.error.message });
    setLoading(false);
  };

  useEffect(() => {
    void loadClubs();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clubs;
    return clubs.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.country?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q)
    );
  }, [clubs, search]);

  const openCreate = () => {
    setTarget(null);
    setForm(emptyForm);
    setErrors({});
    setModal("create");
  };

  const openEdit = (club: BadmintonClub) => {
    setTarget(club);
    setForm({
      name: club.name,
      contactNumber: club.contactNumber ?? "",
      email: club.email ?? "",
      address: club.address ?? "",
      country: club.country ?? "",
    });
    setErrors({});
    setModal("edit");
  };

  const updateField = (key: keyof BadmintonClubInput, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setErrors(prev => ({ ...prev, [key]: "" }));
  };

  const validate = () => {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = "Club name is required.";
    if (form.email?.trim() && !/\S+@\S+\.\S+/.test(form.email)) next.email = "Enter a valid email.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const clean = (): BadmintonClubInput => ({
    name: form.name.trim(),
    contactNumber: form.contactNumber?.trim() || null,
    email: form.email?.trim() || null,
    address: form.address?.trim() || null,
    country: form.country?.trim() || null,
  });

  const saveClub = async () => {
    if (!validate()) return;
    setSaving(true);
    const r = modal === "edit" && target
      ? await apiUpdateBadmintonClub(target.clubId, clean())
      : await apiCreateBadmintonClub(clean());
    setSaving(false);

    if (r.error) {
      setFeedback({ open: true, variant: "error", title: "Club could not be saved", description: r.error.message });
      return;
    }

    const wasEdit = modal === "edit";
    setModal(null);
    await loadClubs();
    setFeedback({ open: true, variant: "success", title: wasEdit ? "Club updated" : "Club added", description: "The club list has been updated." });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    const r = await apiDeleteBadmintonClub(deleteTarget.clubId);
    setSaving(false);

    if (r.error) {
      setFeedback({ open: true, variant: "error", title: "Club could not be deleted", description: r.error.message });
      return;
    }

    setDeleteTarget(null);
    await loadClubs();
    setFeedback({ open: true, variant: "success", title: "Club deleted", description: "The club has been removed from the master list." });
  };

  return (
    <div>
      <ActionFeedbackDialog
        open={feedback.open}
        variant={feedback.variant}
        title={feedback.title}
        description={feedback.description}
        onOpenChange={open => setFeedback(prev => ({ ...prev, open }))}
      />

      <div className="flex items-center justify-between mb-8">
        <div className="admin-page-title" style={{ marginBottom: 0 }}>
          <h1>Badminton Clubs</h1>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2 px-5 py-2.5 text-sm font-semibold">
          <Plus className="h-4 w-4" /> Add Club
        </button>
      </div>

      <div className="p-5 mb-6" style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
        <div className="grid grid-cols-1 md:flex md:flex-wrap items-end gap-4">
          <FG label="Search">
            <div className="relative w-full md:w-80">
              <input
                className="field-input with-right-icon w-full"
                placeholder="Search club, country, or email..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search ? (
                <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-80">
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 opacity-40 pointer-events-none" />
              )}
            </div>
          </FG>
          <div className="flex items-center text-sm opacity-50 whitespace-nowrap px-1 pb-2">
            {loading ? "Loading..." : `${filtered.length.toLocaleString()} ${filtered.length === 1 ? "club" : "clubs"}`}
          </div>
        </div>
      </div>

      <div className="hidden md:block" style={{ border: "1px solid var(--color-table-border)" }}>
        <table className="trs-table w-full">
          <thead>
            <tr>
              <th>Name</th>
              <th>Contact</th>
              <th>Email</th>
              <th>Country</th>
              <th style={{ width: 110 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="text-center py-12 opacity-40">
                  <Loader2 className="h-5 w-5 animate-spin inline" />
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-12 opacity-40">
                  {clubs.length === 0 ? "No clubs have been added yet." : "No clubs match your search."}
                </td>
              </tr>
            ) : filtered.map(club => (
              <tr key={club.clubId}>
                <td>
                  <p className="font-medium text-sm">{club.name}</p>
                  {club.address && <p className="text-xs opacity-40 mt-0.5">{club.address}</p>}
                </td>
                <td className="text-sm opacity-70">{club.contactNumber || "-"}</td>
                <td className="text-sm opacity-70 font-mono">{club.email || "-"}</td>
                <td className="text-sm opacity-70">{club.country || "-"}</td>
                <td>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEdit(club)}
                      title="Edit club"
                      className="p-2 transition-opacity hover:opacity-70"
                      style={{ color: "var(--color-primary)" }}
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(club)}
                      title="Delete club"
                      className="p-2 transition-opacity hover:opacity-70"
                      style={{ color: "var(--badge-open-text)" }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="text-center py-12 opacity-40">
            <Loader2 className="h-5 w-5 animate-spin inline" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 opacity-40 text-sm">
            {clubs.length === 0 ? "No clubs have been added yet." : "No clubs match your search."}
          </div>
        ) : filtered.map(club => (
          <div key={club.clubId} className="p-5" style={{ border: "1px solid var(--color-table-border)" }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-sm">{club.name}</p>
                <p className="text-xs opacity-50 mt-1">{club.country || "No country set"}</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => openEdit(club)} className="p-1.5" style={{ color: "var(--color-primary)" }}>
                  <Edit2 className="h-4 w-4" />
                </button>
                <button onClick={() => setDeleteTarget(club)} className="p-1.5" style={{ color: "var(--badge-open-text)" }}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="mt-3 space-y-1 text-xs opacity-60">
              <p>{club.contactNumber || "No contact number"}</p>
              <p className="font-mono">{club.email || "No email"}</p>
              {club.address && <p>{club.address}</p>}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={modal === "create" || modal === "edit"} onOpenChange={v => { if (!v) setModal(null); }}>
        <DialogContent className="max-w-lg p-0" style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)" }}>
          <DialogHeader className="p-8 pb-0">
            <DialogTitle className="font-bold text-xl">
              {modal === "create" ? "Add Club" : `Edit Club - ${target?.name}`}
            </DialogTitle>
          </DialogHeader>
          <div className="p-8 pt-4 space-y-4">
            <FF label="Club Name *" error={errors.name}>
              <input className="field-input" value={form.name} onChange={e => updateField("name", e.target.value)} autoFocus />
            </FF>
            <div className="grid gap-4 md:grid-cols-2">
              <FF label="Contact Number">
                <input className="field-input" value={form.contactNumber ?? ""} onChange={e => updateField("contactNumber", e.target.value)} />
              </FF>
              <FF label="Email" error={errors.email}>
                <input className="field-input" type="email" value={form.email ?? ""} onChange={e => updateField("email", e.target.value)} />
              </FF>
            </div>
            <FF label="Address">
              <textarea className="field-input" rows={3} value={form.address ?? ""} onChange={e => updateField("address", e.target.value)} />
            </FF>
            <FF label="Country">
              <input className="field-input" value={form.country ?? ""} onChange={e => updateField("country", e.target.value)} />
            </FF>
          </div>
          <DialogFooter className="p-8 pt-0">
            <button onClick={() => setModal(null)} className="btn-outline px-5 py-2.5 text-sm font-medium">Cancel</button>
            <button onClick={saveClub} disabled={saving} className="btn-primary px-5 py-2.5 text-sm font-semibold">
              {saving ? "Saving..." : "Save Club"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={v => { if (!v) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm p-0" style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)" }}>
          <DialogHeader className="p-8 pb-0">
            <DialogTitle className="font-bold text-xl">Delete Club?</DialogTitle>
          </DialogHeader>
          <div className="p-8 pt-4">
            <p className="text-sm opacity-70">
              This removes <strong>{deleteTarget?.name}</strong> from future registration dropdowns. Existing registrations keep their stored club text.
            </p>
          </div>
          <DialogFooter className="p-8 pt-0">
            <button onClick={() => setDeleteTarget(null)} className="btn-outline px-5 py-2.5 text-sm font-medium">Cancel</button>
            <button
              onClick={confirmDelete}
              disabled={saving}
              className="px-5 py-2.5 text-sm font-semibold"
              style={{ backgroundColor: "var(--badge-open-text)", color: "var(--color-hero-text)" }}
            >
              {saving ? "Deleting..." : "Delete Club"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FF({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-2 opacity-70">{label}</label>
      {children}
      {error && <p className="text-xs mt-1" style={{ color: "var(--badge-open-text)" }}>{error}</p>}
    </div>
  );
}

function FG({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1.5 opacity-60">{label}</label>
      {children}
    </div>
  );
}
