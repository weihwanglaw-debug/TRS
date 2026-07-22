export type AdminPaymentStatus = "S" | "W" | "PC";

type AdminPaymentOutcomeFieldsProps = {
  status: AdminPaymentStatus;
  onStatusChange: (status: AdminPaymentStatus) => void;
  method: string;
  onMethodChange: (method: string) => void;
  reference: string;
  onReferenceChange: (reference: string) => void;
  note: string;
  onNoteChange: (note: string) => void;
  remarkPlaceholder: string;
  detailsLayout?: "stacked" | "grid";
};

const PAYMENT_STATUS_OPTIONS: Array<{ value: AdminPaymentStatus; label: string; sub: string }> = [
  { value: "S", label: "Paid", sub: "Collected now" },
  { value: "W", label: "Waived", sub: "Fee waived" },
  { value: "PC", label: "Pending Collection", sub: "Will pay later" },
];

const PAYMENT_METHOD_OPTIONS = [
  { value: "Cash", label: "Cash" },
  { value: "BankTransfer", label: "Bank Transfer" },
  { value: "PayNow", label: "PayNow" },
  { value: "Others", label: "Others" },
];

export default function AdminPaymentOutcomeFields({
  status,
  onStatusChange,
  method,
  onMethodChange,
  reference,
  onReferenceChange,
  note,
  onNoteChange,
  remarkPlaceholder,
  detailsLayout = "stacked",
}: AdminPaymentOutcomeFieldsProps) {
  const showPaymentDetails = status === "S";

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-semibold mb-2 opacity-70">Payment Status *</label>
        <div className="grid grid-cols-3 gap-2">
          {PAYMENT_STATUS_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onStatusChange(opt.value)}
              className="p-3 text-left text-xs transition-all"
              style={{
                border: `2px solid ${status === opt.value ? "var(--color-primary)" : "var(--color-table-border)"}`,
                backgroundColor: status === opt.value ? "var(--color-row-hover)" : "transparent",
              }}>
              <p className="font-semibold">{opt.label}</p>
              <p className="opacity-50 mt-0.5">{opt.sub}</p>
            </button>
          ))}
        </div>
      </div>

      {showPaymentDetails && (
        <div className={detailsLayout === "grid" ? "grid sm:grid-cols-2 gap-4" : "space-y-4"}>
          <Field label="Payment Method">
            <select className="field-input" value={method} onChange={e => onMethodChange(e.target.value)}>
              {PAYMENT_METHOD_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Payment Reference (optional)">
            <input
              className="field-input"
              value={reference}
              onChange={e => onReferenceChange(e.target.value)}
              placeholder="e.g. PayNow ref, receipt number"
            />
          </Field>
        </div>
      )}

      <Field label="Admin Remark *">
        <textarea
          className="field-input"
          rows={2}
          value={note}
          onChange={e => onNoteChange(e.target.value)}
          placeholder={remarkPlaceholder}
        />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-2 opacity-70">{label}</label>
      {children}
    </div>
  );
}
