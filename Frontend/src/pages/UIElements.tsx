import { useState } from "react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import LoadingSpinner, { PageLoader, ButtonLoader } from "@/components/ui/LoadingSpinner";
import ActionDropdownPortal from "@/components/ui/ActionDropdownPortal";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { ArrowLeft, Plus, Edit2, Trash2, Eye, MoreVertical, Download, Upload } from "lucide-react";

export default function UIElements() {
  const [switchOn, setSwitchOn] = useState(false);
  const [switchOn2, setSwitchOn2] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [showLoader, setShowLoader] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 pt-20 pb-16 px-8" style={{ backgroundColor: "var(--color-page-bg)" }}>
        <div className="max-w-5xl mx-auto">
          <h1 className="font-bold text-3xl mb-2">UI Elements Reference</h1>
          <p className="text-sm opacity-60 mb-12">All available components and design tokens for the TRS application.</p>

          {/* ── Colors ── */}
          <Section title="Color Palette">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { name: "Primary", var: "--color-primary" },
                { name: "Primary Hover", var: "--color-primary-hover" },
                { name: "Hero BG", var: "--color-hero-bg" },
                { name: "Page BG", var: "--color-page-bg" },
                { name: "Body Text", var: "--color-body-text" },
                { name: "Heading", var: "--color-heading" },
                { name: "Table Border", var: "--color-table-border" },
                { name: "Row Hover", var: "--color-row-hover" },
                { name: "Row Stripe", var: "--color-row-stripe" },
                { name: "Disabled Text", var: "--color-disabled-text" },
              ].map(c => (
                <div key={c.var} className="flex items-center gap-3 p-3" style={{ border: "1px solid var(--color-table-border)" }}>
                  <div className="w-8 h-8 flex-shrink-0" style={{ backgroundColor: `var(${c.var})` }} />
                  <div>
                    <p className="text-xs font-semibold">{c.name}</p>
                    <p className="text-xs opacity-40 font-mono">{c.var}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* ── Buttons ── */}
          <Section title="Buttons">
            <div className="flex flex-wrap gap-3 mb-6">
              <button className="btn-primary px-5 py-2.5 text-sm font-semibold">Primary</button>
              <button className="btn-primary px-5 py-2.5 text-sm font-semibold" disabled>Primary Disabled</button>
              <button className="btn-outline px-5 py-2.5 text-sm font-medium">Outline</button>
              <button className="btn-back"><ArrowLeft className="h-4 w-4" /> Back</button>
              <button className="btn-primary px-5 py-2.5 text-sm font-semibold flex items-center gap-2">
                <Plus className="h-4 w-4" /> With Icon
              </button>
            </div>
            <p className="text-xs font-bold uppercase tracking-wide opacity-50 mb-3">Shadcn Variants</p>
            <div className="flex flex-wrap gap-3">
              <Button variant="default">Default</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="link">Link</Button>
              <Button size="sm">Small</Button>
              <Button size="lg">Large</Button>
              <Button size="icon"><Plus className="h-4 w-4" /></Button>
            </div>
          </Section>

          {/* ── Form Fields ── */}
          <Section title="Form Fields">
            <div className="grid sm:grid-cols-2 gap-5 max-w-2xl">
              <div>
                <label className="block text-xs font-semibold mb-2 opacity-70">Text Input</label>
                <input className="field-input" placeholder="Enter text..." />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-2 opacity-70">Select</label>
                <select className="field-input">
                  <option>Option 1</option><option>Option 2</option><option>Option 3</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-2 opacity-70">Disabled Input</label>
                <input className="field-input" value="Cannot edit" disabled />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-2 opacity-70">With Error</label>
                <input className="field-input" value="Bad value" />
                <p className="text-xs mt-1" style={{ color: "var(--badge-open-text)" }}>This field has an error</p>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold mb-2 opacity-70">Textarea</label>
                <textarea className="field-input" rows={3} placeholder="Enter description..." />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-2 opacity-70">File Input</label>
                <input type="file" className="field-input" />
              </div>
            </div>
          </Section>

          {/* ── Toggle Switches ── */}
          <Section title="Toggle Switches">
            <div className="space-y-4 max-w-sm">
              <label className="flex items-center justify-between gap-3 text-sm cursor-pointer p-3" style={{ border: "1px solid var(--color-table-border)" }}>
                <span>Enable Feature A</span>
                <Switch checked={switchOn} onCheckedChange={setSwitchOn} />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm cursor-pointer p-3" style={{ border: "1px solid var(--color-table-border)" }}>
                <span>Enable Feature B (on)</span>
                <Switch checked={switchOn2} onCheckedChange={setSwitchOn2} />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm cursor-pointer p-3 opacity-50" style={{ border: "1px solid var(--color-table-border)" }}>
                <span>Disabled Switch</span>
                <Switch checked={false} disabled />
              </label>
            </div>
          </Section>

          {/* ── Checkboxes ── */}
          <Section title="Checkboxes (Shadcn)">
            <div className="space-y-3 max-w-sm">
              <label className="flex items-center gap-3 text-sm cursor-pointer">
                <Checkbox /> Unchecked
              </label>
              <label className="flex items-center gap-3 text-sm cursor-pointer">
                <Checkbox checked /> Checked
              </label>
            </div>
          </Section>

          {/* ── Badges ── */}
          <Section title="Status Badges">
            <div className="flex flex-wrap gap-3">
              {[
                { label: "Open", bg: "var(--badge-open-bg)", text: "var(--badge-open-text)" },
                { label: "Upcoming", bg: "var(--badge-soon-bg)", text: "var(--badge-soon-text)" },
                { label: "Closed", bg: "var(--badge-closed-bg)", text: "var(--badge-closed-text)" },
                { label: "Paid", bg: "var(--badge-open-bg)", text: "var(--badge-open-text)" },
                { label: "Pending", bg: "var(--badge-soon-bg)", text: "var(--badge-soon-text)" },
                { label: "Cancelled", bg: "var(--badge-closed-bg)", text: "var(--badge-closed-text)" },
              ].map(b => (
                <span key={b.label} className="inline-flex px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: b.bg, color: b.text }}>
                  {b.label}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-3 mt-4">
              <Badge>Default Badge</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="destructive">Destructive</Badge>
              <Badge variant="outline">Outline</Badge>
            </div>
          </Section>

          {/* ── Tables ── */}
          <Section title="Table (with alternate rows)">
            <div className="overflow-x-auto" style={{ border: "1px solid var(--color-table-border)" }}>
              <table className="trs-table">
                <thead>
                  <tr><th>Name</th><th>Role</th><th>Status</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {["Alice", "Bob", "Charlie", "Diana", "Eve"].map((name, i) => (
                    <tr key={name}>
                      <td className="font-medium">{name}</td>
                      <td className="text-sm opacity-70">{i % 2 === 0 ? "Admin" : "User"}</td>
                      <td>
                        <span className="inline-flex px-2.5 py-1 text-xs font-semibold"
                          style={{ backgroundColor: i < 3 ? "var(--badge-open-bg)" : "var(--badge-closed-bg)", color: i < 3 ? "var(--badge-open-text)" : "var(--badge-closed-text)" }}>
                          {i < 3 ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td>
                        <button className="p-2 hover:opacity-70" style={{ color: "var(--color-primary)" }}>
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* ── Tab Bar ── */}
          <Section title="Tab Bar">
            <TabBarDemo />
          </Section>

          {/* ── Loading States ── */}
          <Section title="Loading States">
            <div className="flex flex-wrap gap-8 items-center">
              <LoadingSpinner size="sm" label="Small" />
              <LoadingSpinner size="md" label="Medium" />
              <LoadingSpinner size="lg" label="Large" />
              <button className="btn-primary px-5 py-2.5 text-sm font-semibold flex items-center gap-2">
                <ButtonLoader /> Saving...
              </button>
            </div>
          </Section>

          {/* ── Modal ── */}
          <Section title="Modal / Dialog">
            <button className="btn-primary px-5 py-2.5 text-sm font-semibold" onClick={() => setModalOpen(true)}>
              Open Sample Modal
            </button>
            <Dialog open={modalOpen} onOpenChange={v => { if (!v) setModalOpen(false); }}>
              <DialogContent className="max-w-md p-0" style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)" }}>
                <DialogHeader className="sticky top-0 p-8 pb-4 z-10" style={{ backgroundColor: "var(--color-page-bg)", borderBottom: "1px solid var(--color-table-border)" }}>
                  <DialogTitle className="font-bold text-xl">Sample Modal</DialogTitle>
                </DialogHeader>
                <div className="p-8 pt-4">
                  <p className="text-sm opacity-70">This is a modal with sticky header. The header stays fixed when content scrolls.</p>
                  <div className="mt-4 space-y-3">
                    <div><label className="block text-xs font-semibold mb-2 opacity-70">Field 1</label><input className="field-input" placeholder="Enter..." /></div>
                    <div><label className="block text-xs font-semibold mb-2 opacity-70">Field 2</label><input className="field-input" placeholder="Enter..." /></div>
                  </div>
                </div>
                <DialogFooter className="p-8 pt-0">
                  <button onClick={() => setModalOpen(false)} className="btn-outline px-5 py-2.5 text-sm font-medium">Cancel</button>
                  <button onClick={() => setModalOpen(false)} className="btn-primary px-5 py-2.5 text-sm font-semibold">Save</button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </Section>

          {/* ── Action Dropdown ── */}
          <Section title="Action Dropdown">
            <ActionDropdownDemo />
          </Section>

          {/* ── Typography ── */}
          <Section title="Typography">
            <div className="space-y-4">
              <h1>Heading 1</h1>
              <h2>Heading 2</h2>
              <h3>Heading 3</h3>
              <h4>Heading 4</h4>
              <p className="text-sm" style={{ color: "var(--color-body-text)" }}>Body text — The quick brown fox jumps over the lazy dog.</p>
              <p className="text-xs opacity-60">Small / Caption text — secondary information</p>
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--color-primary)" }}>Label / Overline</p>
              <p className="font-mono text-sm">Monospace — R001, TXN-001, SBA-003</p>
            </div>
          </Section>

          {/* ── Spacing ── */}
          <Section title="Spacing Tokens">
            <div className="space-y-2">
              {[1, 2, 3, 4, 5, 6, 8, 10, 12, 16].map(n => (
                <div key={n} className="flex items-center gap-3">
                  <span className="text-xs font-mono w-8 text-right opacity-50">{n}</span>
                  <div className="h-3" style={{ width: `${n * 4}px`, backgroundColor: "var(--color-primary)", opacity: 0.6 }} />
                  <span className="text-xs opacity-40">{n * 4}px</span>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-14">
      <h2 className="font-bold text-lg mb-5 pb-3" style={{ borderBottom: "1px solid var(--color-table-border)" }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

function TabBarDemo() {
  const [active, setActive] = useState("tab1");
  return (
    <div>
      <div className="tab-bar mb-4">
        {[{ id: "tab1", label: "Tab One" }, { id: "tab2", label: "Tab Two" }, { id: "tab3", label: "Tab Three" }].map(t => (
          <button key={t.id} onClick={() => setActive(t.id)} className={`tab-btn ${active === t.id ? "active" : ""}`}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="text-sm opacity-60">Active: {active}</p>
    </div>
  );
}

function ActionDropdownDemo() {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = !!anchorEl;
  return (
    <div className="inline-block">
      <button
        onClick={(e) => setAnchorEl(open ? null : e.currentTarget)}
        className="p-2 hover:opacity-70"
        style={{ color: "var(--color-primary)", border: "1px solid var(--color-table-border)" }}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      <ActionDropdownPortal open={open} anchorEl={anchorEl} onClose={() => setAnchorEl(null)}>
        <button onClick={() => setAnchorEl(null)}><Eye className="h-4 w-4" /> View</button>
        <button onClick={() => setAnchorEl(null)}><Edit2 className="h-4 w-4" /> Edit</button>
        <button onClick={() => setAnchorEl(null)}><Download className="h-4 w-4" /> Export</button>
        <button disabled><Trash2 className="h-4 w-4" /> Delete (disabled)</button>
      </ActionDropdownPortal>
    </div>
  );
}
