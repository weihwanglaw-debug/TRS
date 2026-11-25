import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
let root: Root | undefined;
let container: HTMLDivElement;
function render(node: ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  root.render(node);
}
function cleanup() {
  if (root) act(() => root!.unmount());
  root = undefined;
  container?.remove();
}
const heading = () => container.querySelector("h2")!;
const text = (value: string) => [...container.querySelectorAll("p, button")].find(el => el.textContent === value)!;
import { MemoryRouter } from "react-router-dom";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import EventCarousel from "@/components/landing/EventCarousel";
import { LiveConfigProvider, useLiveConfig } from "@/contexts/LiveConfigContext";
import { apiGetConfig, apiUpdateConfig } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  apiGetConfig: vi.fn(), apiUpdateConfig: vi.fn(),
  apiGetEvents: async () => ({ data: [] }), assetUrl: (value: string) => value,
}));
beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

async function mount() {
  await act(async () => {
    render(<MemoryRouter><LiveConfigProvider><EventCarousel /></LiveConfigProvider></MemoryRouter>);
  });
}

it.each([{}, { eventsLabel: "  ", eventsTitle: "" }])("preserves original copy for missing or blank settings", async config => {
  vi.mocked(apiGetConfig).mockResolvedValue({ data: config as never, error: null });
  await mount();
  expect(heading().textContent).toBe("Choose your tournament and continue registration");
  expect(text("Featured events /")).toBeTruthy();
});

it("loads saved copy and renders markup as plain text", async () => {
  vi.mocked(apiGetConfig).mockResolvedValue({ data: {
    eventsLabel: "Social games /", eventsTitle: "Join <b>our games</b>",
  } as never, error: null });
  await mount();
  expect(text("Social games /")).toBeTruthy();
  const title = heading();
  expect(title.textContent).toBe("Join <b>our games</b>");
  expect(title.querySelector("b")).toBeNull();
});

it("saves through the existing config API and retains saved copy after remount", async () => {
  let saved = {};
  vi.mocked(apiGetConfig).mockImplementation(async () => ({ data: saved as never, error: null }));
  vi.mocked(apiUpdateConfig).mockImplementation(async patch => {
    saved = { ...saved, ...patch };
    return { data: saved as never, error: null };
  });
  function Editor() {
    const { update } = useLiveConfig();
    return <button onClick={() => update("eventsTitle", "Explore events and register")}>Save test title</button>;
  }
  await act(async () => {
    render(<MemoryRouter><LiveConfigProvider><Editor /><EventCarousel /></LiveConfigProvider></MemoryRouter>);
  });
  await act(async () => { (text("Save test title") as HTMLButtonElement).click(); });
  expect(apiUpdateConfig).toHaveBeenCalledWith({ eventsTitle: "Explore events and register" });
  expect(heading().textContent).toBe("Explore events and register");
  cleanup();
  await mount();
  expect(heading().textContent).toBe("Explore events and register");
});
