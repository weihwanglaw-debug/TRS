import { useState } from "react";
import { Check, Edit2, X } from "lucide-react";
import { useLiveConfig } from "@/contexts/LiveConfigContext";
import type { LiveConfig } from "@/contexts/LiveConfigContext";
import { ActionFeedbackDialog, type ActionFeedbackVariant } from "@/components/ui/ActionFeedbackDialog";
import AdminTabs from "@/components/admin/AdminTabs";

export type { LiveConfig };

interface ConfigRow {
  id:    keyof LiveConfig;
  group: string;
  label: string;
  type:  "text" | "url" | "textarea";
}

const CONFIG_ROWS: ConfigRow[] = [
  { id: "appName",       group: "Branding",   label: "Application Name",                          type: "text"     },
  { id: "logoLightUrl",  group: "Branding",   label: "Logo URL (Light Background)",                type: "url"      },
  { id: "logoDarkUrl",   group: "Branding",   label: "Logo URL (Dark Background)",                 type: "url"      },
  { id: "logoUrl",       group: "Branding",   label: "Legacy Logo URL",                           type: "url"      },
  { id: "heroTitle",     group: "Hero",       label: "Hero Title",                                type: "text"     },
  { id: "heroSubtitle",  group: "Hero",       label: "Hero Subtitle",                             type: "textarea" },
  { id: "heroImageUrl",  group: "Hero",       label: "Hero Background Image URL",                 type: "url"      },
  { id: "messageTitle",  group: "Message",    label: "Landing Message Title",                     type: "text"     },
  { id: "messageBody",   group: "Message",    label: "Landing Message Body",                      type: "textarea" },
  { id: "currency",      group: "Payment",    label: "Currency Code",                             type: "text"     },
  { id: "contactEmail",  group: "Footer",     label: "Contact Email",                             type: "text"     },
  { id: "copyrightText", group: "Footer",     label: "Copyright Text",                            type: "text"     },
  { id: "socialInstagramUrl", group: "Footer", label: "Instagram URL",                           type: "url"      },
  { id: "socialYoutubeUrl",   group: "Footer", label: "YouTube URL",                             type: "url"      },
  { id: "socialFacebookUrl",  group: "Footer", label: "Facebook URL",                            type: "url"      },
  { id: "socialLinkedInUrl",  group: "Footer", label: "LinkedIn URL",                            type: "url"      },
  { id: "socialTiktokUrl",    group: "Footer", label: "TikTok URL",                              type: "url"      },
  { id: "consentText",   group: "Consent",    label: "Consent Statement (applies to all events)", type: "textarea" },
  { id: "adEnabled",     group: "Ad Banner",  label: "Show Ad Banner (true / false)",             type: "text"     },
  { id: "adUrl",         group: "Ad Banner",  label: "Ad Link URL",                               type: "url"      },
  { id: "adImageUrl",    group: "Ad Banner",  label: "Ad Background Image URL",                   type: "url"      },
  { id: "adTag",         group: "Ad Banner",  label: "Ad Tag Label (e.g. Partner Venue)",         type: "text"     },
  { id: "adTitle",       group: "Ad Banner",  label: "Ad Headline",                               type: "text"     },
  { id: "adBody",        group: "Ad Banner",  label: "Ad Body Text",                              type: "textarea" },
  { id: "adButtonLabel", group: "Ad Banner",  label: "Ad Button Label",                           type: "text"     },
  { id: "displayTimeZone", group: "Payment",  label: "Display UTC Offset (e.g. +08:00)",            type: "text"     },
  { id: "displayDateTimeFormat", group: "Payment", label: "Date Time Display Format (e.g. dd/MM/yyyy HH:mm:ss)", type: "text" },
];

const GROUPS = ["All", "Branding", "Hero", "Message", "Payment", "Footer", "Consent", "Ad Banner"];
const GROUP_TABS = GROUPS.map(group => ({ key: group, label: group }));

export default function MasterConfig() {
  const { cfg, update } = useLiveConfig();
  const [editId,      setEditId]      = useState<keyof LiveConfig | null>(null);
  const [editValue,   setEditValue]   = useState("");
  const [saving,      setSaving]      = useState(false);
  const [activeGroup, setActiveGroup] = useState("All");
  const [feedback, setFeedback] = useState<{
    open: boolean;
    variant: ActionFeedbackVariant;
    title: string;
    description?: string;
  }>({ open: false, variant: "info", title: "" });

  const startEdit = (row: ConfigRow) => {
    setEditId(row.id);
    setEditValue(cfg[row.id]);
  };

  const commitEdit = async (id: keyof LiveConfig) => {
    setSaving(true);
    try {
      await update(id, editValue);
      setEditId(null);
      setFeedback({ open: true, variant: "success", title: "Setting saved", description: "The master configuration has been updated." });
    } catch (error) {
      setFeedback({
        open: true,
        variant: "error",
        title: "Setting could not be saved",
        description: error instanceof Error ? error.message : "Please check your connection and try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => setEditId(null);

  const visible = CONFIG_ROWS.filter(r => activeGroup === "All" || r.group === activeGroup);
  const byGroup: Record<string, ConfigRow[]> = {};
  visible.forEach(r => { if (!byGroup[r.group]) byGroup[r.group] = []; byGroup[r.group].push(r); });

  return (
    <div>
      <ActionFeedbackDialog
        open={feedback.open}
        variant={feedback.variant}
        title={feedback.title}
        description={feedback.description}
        onOpenChange={open => setFeedback(prev => ({ ...prev, open }))}
      />
      <div className="admin-page-title"><h1>Master Configuration</h1></div>
  

      <AdminTabs tabs={GROUP_TABS} activeKey={activeGroup} onChange={setActiveGroup} />

      <div className="space-y-8">
        {Object.entries(byGroup).map(([group, groupRows]) => (
          <div key={group}>
            <p className="text-xs font-bold uppercase tracking-wider mb-3 pb-2 opacity-60"
              style={{ borderBottom: "1px solid var(--color-table-border)" }}>
              {group}
            </p>

  {/* Desktop: table */}
            <div className="hidden md:block" style={{ border: "1px solid var(--color-table-border)" }}>
              <table className="trs-table w-full">
                <thead>
                  <tr>
                    <th style={{ width: "30%" }}>Setting</th>
                    <th>Current Value</th>
                    <th style={{ width: 80 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {groupRows.map(row => (
                    <tr key={row.id}>
                      <td>
                        <p className="text-sm font-medium">{row.label}</p>
                        <p className="text-xs opacity-40 font-mono mt-0.5">{row.id}</p>
                      </td>
                      <td>
                        {editId === row.id ? (
                          row.type === "textarea" ? (
                            <textarea className="field-input text-sm w-full" rows={3}
                              value={editValue} onChange={e => setEditValue(e.target.value)}
                              autoFocus />
                          ) : (
                            <input className="field-input text-sm w-full"
                              value={editValue} onChange={e => setEditValue(e.target.value)}
                              autoFocus
                              onKeyDown={e => { if (e.key === "Enter") void commitEdit(row.id); if (e.key === "Escape") cancelEdit(); }} />
                          )
                        ) : (
                          <span className={`text-sm ${row.type === "textarea" ? "whitespace-pre-wrap" : "truncate max-w-md block"} ${!cfg[row.id] ? "opacity-30 italic" : ""}`}>
                            {cfg[row.id] || "(empty)"}
                          </span>
                        )}
                      </td>
                      <td>
                        {editId === row.id ? (
                          <div className="flex items-center gap-1">
                            <button onClick={() => commitEdit(row.id)} title="Save"
                              className="p-1.5 transition-opacity hover:opacity-70"
                              style={{ color: "var(--badge-open-text)" }}>
                              {saving ? "..." : <Check className="h-4 w-4" />}
                            </button>
                            <button onClick={cancelEdit} title="Cancel"
                              className="p-1.5 opacity-40 hover:opacity-80">
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => startEdit(row)} title="Edit"
                            className="p-1.5 transition-opacity hover:opacity-70"
                            style={{ color: "var(--color-primary)" }}>
                            <Edit2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

  {/* Mobile: cards */}
            <div className="md:hidden space-y-3">
              {groupRows.map(row => (
                <div key={row.id} className="p-4" style={{ border: "1px solid var(--color-table-border)" }}>
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-sm font-medium">{row.label}</p>
                      <p className="text-xs opacity-40 font-mono">{row.id}</p>
                    </div>
                    {editId === row.id ? (
                      <div className="flex items-center gap-1">
                        <button onClick={() => commitEdit(row.id)} className="p-1.5" style={{ color: "var(--badge-open-text)" }}>
                          {saving ? "..." : <Check className="h-4 w-4" />}
                        </button>
                        <button onClick={cancelEdit} className="p-1.5 opacity-40"><X className="h-4 w-4" /></button>
                      </div>
                    ) : (
                      <button onClick={() => startEdit(row)} className="p-1.5"
                        style={{ color: "var(--color-primary)" }}>
                        <Edit2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {editId === row.id ? (
                    row.type === "textarea" ? (
                      <textarea className="field-input text-sm w-full" rows={3}
                        value={editValue} onChange={e => setEditValue(e.target.value)} autoFocus />
                    ) : (
                      <input className="field-input text-sm w-full"
                        value={editValue} onChange={e => setEditValue(e.target.value)} autoFocus
                        onKeyDown={e => { if (e.key === "Enter") void commitEdit(row.id); if (e.key === "Escape") cancelEdit(); }} />
                    )
                  ) : (
                    <p className={`text-sm mt-1 ${!cfg[row.id] ? "opacity-30 italic" : ""}`}>
                      {cfg[row.id] || "(empty)"}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
