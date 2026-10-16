import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import MasterConfig from "@/pages/admin/Masterconfig";
import { apiGetPaymentGatewayConfig, apiUpdatePaymentGatewayConfig } from "@/lib/api/configApi";

const state = vi.hoisted(() => ({ role: "superadmin", update: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { role: state.role } }) }));
vi.mock("@/contexts/LiveConfigContext", () => ({ useLiveConfig: () => ({ cfg: { currency: "SGD" }, update: state.update }) }));
vi.mock("@/lib/api/configApi", () => ({ apiGetPaymentGatewayConfig: vi.fn(), apiUpdatePaymentGatewayConfig: vi.fn() }));

vi.mock("@/components/ui/ActionFeedbackDialog", () => ({
  ActionFeedbackDialog: ({ open, title, description }: { open: boolean; title: string; description?: string }) =>
    open ? <div role="status">{title}: {description}</div> : null,
}));

const config = { activeGateway: "Stripe", version: "2026-10-08T00:00:00.0000000", gateways: [
  { code: "Stripe", displayName: "Stripe", selectable: true, unavailableReason: null },
  { code: "Fiuu", displayName: "Fiuu", selectable: false, unavailableReason: "Integration is not available yet." },
] };

describe("Master Config gateway row", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    if (root) await act(async () => root.unmount());
    document.body.innerHTML = "";
    container = document.createElement("div"); document.body.append(container);
    root = createRoot(container);
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.resetAllMocks(); state.role = "superadmin";
    vi.mocked(apiGetPaymentGatewayConfig).mockResolvedValue({ data: config, error: null });
  });
  const row = (mobile = false) => container.querySelector<HTMLElement>(`${mobile ? "div" : "tr"}[data-setting="activePaymentGateway"]`)!;
  const button = (element: HTMLElement, action: string) => element.querySelector<HTMLButtonElement>(`button[aria-label="${action} Payment Gateway"]`)!;
  const edit = async (mobile = false) => {
    await act(async () => button(row(mobile), "Edit").click());
    return row(mobile).querySelector<HTMLSelectElement>("select")!;
  };

  it("places gateway in the Payment table with other settings and no separate controls", async () => {
    await act(async () => root.render(<MasterConfig />));
    expect(row().closest("table")!.textContent).toContain("Currency Code");
    expect(row().textContent).toContain("Stripe");
    expect(row().querySelector("select")).toBeNull();
    expect(container.textContent).not.toContain("Save gateway");
    expect(container.textContent).not.toContain("Reload");
    const select = await edit();
    expect(select.value).toBe("Stripe");
    expect(select.querySelector<HTMLOptionElement>('option[value="Fiuu"]')!.disabled).toBe(true);
  });

  it("does not load or show the gateway row to eventadmin", async () => {
    state.role = "eventadmin";
    await act(async () => root.render(<MasterConfig />));
    expect(row()).toBeNull();
    expect(apiGetPaymentGatewayConfig).not.toHaveBeenCalled();
  });

  it.each([false, true])("saves through the shared confirm control (mobile=%s)", async mobile => {
    vi.mocked(apiUpdatePaymentGatewayConfig).mockResolvedValue({ data: config, error: null });
    await act(async () => root.render(<MasterConfig />));
    await edit(mobile);
    await act(async () => button(row(mobile), "Save").click());
    expect(apiUpdatePaymentGatewayConfig).toHaveBeenCalledWith("Stripe", config.version);
    expect(state.update).not.toHaveBeenCalled();
    expect(row(mobile).querySelector("select")).toBeNull();
    expect(container.textContent).toContain("Setting saved");
  });

  it.each([false, true])("cancels without writing (mobile=%s)", async mobile => {
    await act(async () => root.render(<MasterConfig />));
    await edit(mobile);
    await act(async () => button(row(mobile), "Cancel").click());
    expect(apiUpdatePaymentGatewayConfig).not.toHaveBeenCalled();
    expect(row(mobile).querySelector("select")).toBeNull();
    expect(row(mobile).textContent).toContain("Stripe");
  });

  it("uses the shared feedback dialog and reloads on Edit after a conflict", async () => {
    vi.mocked(apiUpdatePaymentGatewayConfig).mockResolvedValue({ data: null, error: { code: "CONFIG_CHANGED", message: "Stale" } });
    await act(async () => root.render(<MasterConfig />));
    await edit();
    await act(async () => button(row(), "Save").click());
    expect(container.textContent).toContain("Setting could not be saved");
    expect(container.textContent).toContain("Use Edit to reload");
    vi.mocked(apiGetPaymentGatewayConfig).mockResolvedValue({ data: { ...config, version: "fresh" }, error: null });
    await edit();
    await act(async () => button(row(), "Save").click());
    expect(apiUpdatePaymentGatewayConfig).toHaveBeenLastCalledWith("Stripe", "fresh");
  });

  it("retries a failed initial load using the standard Edit control", async () => {
    vi.mocked(apiGetPaymentGatewayConfig).mockResolvedValueOnce({ data: null, error: { code: "FETCH_FAILED", message: "Could not load gateway" } });
    await act(async () => root.render(<MasterConfig />));
    expect(row().textContent).toContain("Could not load gateway");
    expect((await edit()).value).toBe("Stripe");
  });
});
