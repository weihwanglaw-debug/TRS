import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
let root: Root;
let container: HTMLDivElement;
const text = (value: string) => [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === value)!;
async function click(value: string) {
  await act(async () => { text(value).click(); });
}
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Fixtures from "@/pages/admin/Fixtures";

const api = vi.hoisted(() => ({ events: vi.fn(), generate: vi.fn() }));
vi.mock("@/types/registration", () => ({ groupsToSeedEntries: () => [{ id: "1", seed: 1, participants: ["A"] }, { id: "2", seed: 2, participants: ["B"] }] }));
vi.mock("@/lib/api", () => ({
  apiGetEvents: api.events,
  apiGetRegistrations: async () => ({ data: { items: [] } }),
  apiGetSbaRankings: async () => ({ data: [] }),
  apiUpdateGroupSeed: vi.fn(),
}));
vi.mock("@/lib/fixtureApi", () => ({
  apiGetFixtureStatus: async () => ({ data: {} }),
  apiGetFixture: async () => ({ data: null }),
  apiGenerateDraw: api.generate,
}));
vi.mock("@/components/admin/fixtures/WizardSteps", () => ({
  FixtureWizard: () => <div>Fixture wizard opened</div>,
}));
afterEach(() => { act(() => root.unmount()); container.remove(); });
beforeEach(() => { vi.clearAllMocks(); });
it.each([
  ["O", "still open for registration"],
  ["H", "This program is hidden"],
  ["CL", null],
])("guards the real fixture screen for %s", async (status, message) => {
  api.events.mockResolvedValue({ data: [{
    id: "1", name: "Event", isSports: true, sportType: "Badminton",
    fixtureMode: "internal", eventStartDate: "2027-01-01", closeDate: "2026-01-01",
    programs: [{ id: "2", name: "Program", type: "singles", status, participantSeeds: [] }],
  }] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root.render(<Fixtures />); });
  await click("Manage");
  await click("Generate Fixture");
  if (message) {
    expect(document.body.textContent).toContain(message);
    expect(document.body.textContent).not.toContain("Fixture wizard opened");
  } else {
    expect(document.body.textContent).toContain("Fixture wizard opened");
  }
  expect(api.generate).not.toHaveBeenCalled();
});
