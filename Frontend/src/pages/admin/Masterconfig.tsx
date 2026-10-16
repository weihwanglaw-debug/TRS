import { useEffect, useState } from "react";
import { Check, Edit2, X } from "lucide-react";
import { useLiveConfig } from "@/contexts/LiveConfigContext";
import type { LiveConfig } from "@/contexts/LiveConfigContext";
import { ActionFeedbackDialog, type ActionFeedbackVariant } from "@/components/ui/ActionFeedbackDialog";
import { useAuth } from "@/contexts/AuthContext";
import { apiGetPaymentGatewayConfig, apiUpdatePaymentGatewayConfig, type PaymentGatewayConfiguration } from "@/lib/api/configApi";
import AdminTabs from "@/components/admin/AdminTabs";

export type { LiveConfig };

type ConfigId = keyof LiveConfig | "activePaymentGateway";

interface ConfigRow {
  id:    ConfigId;
  group: string;
  label: string;
  type:  "text" | "url" | "textarea" | "gateway";
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
  { id: "activePaymentGateway", group: "Payment", label: "Payment Gateway", type: "gateway" },
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
  const { user } = useAuth();
  const [editId,      setEditId]      = useState<ConfigId | null>(null);
  const [editValue,   setEditValue]   = useState("");
  const [saving,      setSaving]      = useState(false);
  const [activeGroup, setActiveGroup] = useState("All");
  const [feedback, setFeedback] = useState<{
    open: boolean;
    variant: ActionFeedbackVariant;
    title: string;
    description?: string;
  }>({ open: false, variant: "info", title: "" });

  const [gatewayConfig, setGatewayConfig] = useState<PaymentGatewayConfiguration | null>(null);
  const [gatewayError, setGatewayError] = useState("");

  useEffect(() => {
    if (user?.role !== "superadmin") return;
    let current = true;
    apiGetPaymentGatewayConfig().then(result => {
      if (!current) return;
      if (result.error) setGatewayError(result.error.message);
      else if (result.data) { setGatewayConfig(result.data); setGatewayError(""); }
    }).catch(() => { if (current) setGatewayError("Could not load payment gateway. Use Edit to retry."); });
    return () => { current = false; };
  }, [user?.role]);

  const rowValue = (row: ConfigRow) => row.id === "activePaymentGateway"
    ? gatewayError || (gatewayConfig
      ? gatewayConfig.gateways.find(g => g.code === gatewayConfig.activeGateway)?.displayName ?? gatewayConfig.activeGateway
      : "Loading...")
    : cfg[row.id];

  const startEdit = async (row: ConfigRow) => {
    if (saving) return;
    if (row.id === "activePaymentGateway") {
      setSaving(true);
      try {
        const result = await apiGetPaymentGatewayConfig();
        if (result.error) throw new Error(result.error.message);
        if (!result.data) throw new Error("Could not load payment gateways.");
        setGatewayConfig(result.data);
        setGatewayError("");
        setEditValue(result.data.activeGateway);
        setEditId(row.id);
      } catch (error) {
        setFeedback({ open: true, variant: "error", title: "Setting could not be loaded",
          description: error instanceof Error ? error.message : "Please try again." });
      } finally { setSaving(false); }
    } else {
      setEditId(row.id);
      setEditValue(cfg[row.id]);
    }
  };

  const canSave = (id: ConfigId) => !saving && (id !== "activePaymentGateway"
    || !!gatewayConfig?.gateways.some(g => g.code === editValue && g.selectable));

  const commitEdit = async (id: ConfigId) => {
    if (!canSave(id)) return;
    setSaving(true);
    try {
      if (id === "activePaymentGateway") {
        if (!gatewayConfig) throw new Error("Please reopen Edit to load the gateway setting.");
        const result = await apiUpdatePaymentGatewayConfig(editValue, gatewayConfig.version);
        if (result.error) {
          if (result.error.code === "CONFIG_CHANGED") setEditId(null);
          throw new Error(result.error.code === "CONFIG_CHANGED"
            ? "The gateway setting changed. Use Edit to reload it before saving." : result.error.message);
        }
        if (!result.data) throw new Error("The configuration server returned no saved value.");
        setGatewayConfig(result.data);
      } else {
        await update(id, editValue);
      }
      setEditId(null);
      setFeedback({ open: true, variant: "success", title: "Setting saved", description: "The master configuration has been updated." });
    } catch (error) {
      setFeedback({ open: true, variant: "error", title: "Setting could not be saved",
        description: error instanceof Error ? error.message : "Please check your connection and try again." });
    } finally { setSaving(false); }
  };

  const gatewayEditor = () => <select aria-label="Payment Gateway" className="field-input text-sm w-full"
    value={editValue} onChange={e => setEditValue(e.target.value)} disabled={saving}
    onKeyDown={e => { if (e.key === "Enter") void commitEdit("activePaymentGateway"); if (e.key === "Escape" && !saving) setEditId(null); }}>
    {gatewayConfig && !gatewayConfig.gateways.some(g => g.code === editValue) &&
      <option value={editValue} disabled>{editValue} (unavailable)</option>}
    {gatewayConfig?.gateways.map(g => <option key={g.code} value={g.code} disabled={!g.selectable}>
      {g.displayName}{g.selectable ? "" : ` (unavailable: ${g.unavailableReason ?? "Not ready"})`}
    </option>)}
  </select>;

  const cancelEdit = () => setEditId(null);

  const visible = CONFIG_ROWS.filter(r => (r.type !== "gateway" || user?.role === "superadmin")
    && (activeGroup === "All" || r.group === activeGroup));
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
                    <tr key={row.id} data-setting={row.id}>
                      <td>
                        <p className="text-sm font-medium">{row.label}</p>
                        <p className="text-xs opacity-40 font-mono mt-0.5">{row.id}</p>
                      </td>
                      <td>
                        {editId === row.id ? (
                          row.type === "gateway" ? gatewayEditor() : row.type === "textarea" ? (
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
                          <span className={`text-sm ${row.type === "textarea" ? "whitespace-pre-wrap" : "truncate max-w-md block"} ${!rowValue(row) ? "opacity-30 italic" : ""}`}>
                            {rowValue(row) || "(empty)"}
                          </span>
                        )}
                      </td>
                      <td>
                        {editId === row.id ? (
                          <div className="flex items-center gap-1">
                            <button onClick={() => commitEdit(row.id)} disabled={!canSave(row.id)} aria-label={`Save ${row.label}`} title="Save"
                              className="p-1.5 transition-opacity hover:opacity-70"
                              style={{ color: "var(--badge-open-text)" }}>
                              {saving ? "..." : <Check className="h-4 w-4" />}
                            </button>
                            <button onClick={cancelEdit} disabled={saving} aria-label={`Cancel ${row.label}`} title="Cancel"
                              className="p-1.5 opacity-40 hover:opacity-80">
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => void startEdit(row)} disabled={saving} aria-label={`Edit ${row.label}`} title="Edit"
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
                <div key={row.id} data-setting={row.id} className="p-4" style={{ border: "1px solid var(--color-table-border)" }}>
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-sm font-medium">{row.label}</p>
                      <p className="text-xs opacity-40 font-mono">{row.id}</p>
                    </div>
                    {editId === row.id ? (
                      <div className="flex items-center gap-1">
                        <button onClick={() => commitEdit(row.id)} disabled={!canSave(row.id)} aria-label={`Save ${row.label}`} className="p-1.5" style={{ color: "var(--badge-open-text)" }}>
                          {saving ? "..." : <Check className="h-4 w-4" />}
                        </button>
                        <button onClick={cancelEdit} disabled={saving} aria-label={`Cancel ${row.label}`} className="p-1.5 opacity-40"><X className="h-4 w-4" /></button>
                      </div>
                    ) : (
                      <button onClick={() => void startEdit(row)} disabled={saving} aria-label={`Edit ${row.label}`} className="p-1.5"
                        style={{ color: "var(--color-primary)" }}>
                        <Edit2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {editId === row.id ? (
                    row.type === "gateway" ? gatewayEditor() : row.type === "textarea" ? (
                      <textarea className="field-input text-sm w-full" rows={3}
                        value={editValue} onChange={e => setEditValue(e.target.value)} autoFocus />
                    ) : (
                      <input className="field-input text-sm w-full"
                        value={editValue} onChange={e => setEditValue(e.target.value)} autoFocus
                        onKeyDown={e => { if (e.key === "Enter") void commitEdit(row.id); if (e.key === "Escape") cancelEdit(); }} />
                    )
                  ) : (
                    <p className={`text-sm mt-1 ${!rowValue(row) ? "opacity-30 italic" : ""}`}>
                      {rowValue(row) || "(empty)"}
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
