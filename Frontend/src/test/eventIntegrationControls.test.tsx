import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Fixtures from "@/pages/admin/Fixtures";
import EventEdit from "@/pages/admin/EventEdit";
import ParticipantDetails from "@/pages/admin/ParticipantDetails";
import Registrations from "@/pages/admin/Registrations";
import { useEventIntegration, eventIntegrationMessage } from "@/hooks/useEventIntegration";

const service = vi.hoisted(() => ({
  fixtureStatus: vi.fn(), fixtureDetail: vi.fn(), apiGetEvents: vi.fn(), apiGetEvent: vi.fn(), apiGetEventRestrictedSbaPlayers: vi.fn(), apiGetRegistrations: vi.fn(), apiGetRefunds: vi.fn(), apiUpdateParticipant: vi.fn(), apiGenerateDraw: vi.fn(),
}));
vi.mock("@/contexts/LiveConfigContext", () => ({ useLiveConfig: () => ({ cfg: {} }) }));
vi.mock("@/lib/api", async original => ({ ...await original<object>(), ...service }));
vi.mock("@/lib/fixtureApi", async original => ({ ...await original<object>(), apiGetFixtureStatus: service.fixtureStatus, apiGetFixture: service.fixtureDetail }));
const event = { id: "1", name: "Open", registrationStatus: "CL", venue: "Hall", sportType: "Badminton", isSports: true, readyForEventIntegration: true, fixtureMode: "internal", eventStartDate: "2026-12-01", eventEndDate: "2026-12-02", closeDate: "2026-11-01", programs: [{ id: "3", name: "Mixed Doubles", type: "Doubles", currentParticipants: 1, maxParticipants: 32, fee: 50, status: "CL", participantSeeds: [] }] };
const registration = {
  id: "7", eventId: "1", eventName: "Open", regStatus: "C", contactName: "Test", contactEmail: "test@example.com", contactPhone: "123", submittedAt: "2026-11-01T00:00:00Z",
  groups: [{ id: "10", eventId: "1", programId: "3", programName: "Mixed Doubles", groupStatus: "C", participants: [], namesDisplay: "Test pair" }],
  payment: { id: "2", method: "Cash", gateway: "Manual", paymentStatus: "S", amount: 50, currency: "SGD", items: [{ id: "4", participantGroupId: "10", programName: "Mixed Doubles", amount: 50, itemStatus: "S" }] },
};
beforeEach(() => {
  vi.clearAllMocks();
  service.fixtureStatus.mockReset().mockResolvedValue({ data: {} });
  service.fixtureDetail.mockReset().mockResolvedValue({ data: null });
  service.apiGetEvents.mockResolvedValue({ data: [event] });
  service.apiGetEvent.mockResolvedValue({ data: event });
  service.apiGetEventRestrictedSbaPlayers.mockResolvedValue({ data: [] });
  service.apiGetRegistrations.mockResolvedValue({ data: { items: [registration], total: 1, totalPages: 1 } });
  service.apiGetRefunds.mockResolvedValue({ data: [] });
});
let root: Root;
let host: HTMLDivElement;
function render(node: ReactNode) {
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host); root.render(node);
}
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); });
const buttons = (name: string) => Array.from(document.querySelectorAll("button")).filter(button => (button.getAttribute("aria-label") || button.textContent?.trim()) === name);
const option = (name: string) => Array.from(document.querySelectorAll("option")).find(option => option.textContent === name)!;


it("prevents entering fixture management for an integration-ready event", async () => {
  await act(async () => { render(<Fixtures />); });
  expect(buttons("Manage").length).toBeGreaterThan(0);
  expect(buttons("Manage")[0]).toBeEnabled();
  await act(async () => buttons("Manage")[0].click());
  expect(document.body.textContent).toContain(eventIntegrationMessage);
  expect(document.body.textContent).not.toContain("GAME FORMAT");
});

it("opens linked TLS program results read-only while fixture editing is locked", async () => {
  service.fixtureStatus.mockImplementation(async (_ids, onTlsResults) => {
    onTlsResults(["3"]);
    return { data: {} };
  });
  service.fixtureDetail.mockImplementation(async (_eventId, _programId, onTlsResults) => {
    onTlsResults([{
      id: "match", programId: 3, programName: "Mixed Doubles", roundLabel: "Final",
      team1: { id: "a", players: ["Alice"] }, team2: { id: "b", players: ["Beth"] },
      games: [{ a: 21, b: 18 }], winner: "A",
    }]);
    return { data: null };
  });
  await act(async () => { render(<Fixtures />); });
  await act(async () => buttons("View Results")[0].click());
  expect(host.querySelector('[aria-label="TLS program results"]')?.textContent).toContain("Alice");
  expect(buttons("Generate Fixture")).toHaveLength(0);
});

it("keeps refunds available and warns when cancellation is selected", async () => {
  await act(async () => { render(<MemoryRouter><Registrations /></MemoryRouter>); });
  await act(async () => buttons("Open actions for registration 7")[0].click());
  const refund = buttons("Refund / Cancel")[0];
  expect(refund).toBeEnabled();
  await act(async () => refund.click());
  expect(option("Refund only")).toBeEnabled();
  expect(option("Cancel without refund")).toBeEnabled();
  const action = option("Refund only").parentElement as HTMLSelectElement;
  await act(async () => { action.value = "cancelWithRefund"; action.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(document.body.textContent).toContain(eventIntegrationMessage);
  expect(action.value).toBe("refundOnly");
});

it("keeps payment collection available for a confirmed unpaid entry", async () => {
  service.apiGetRegistrations.mockResolvedValue({ data: { items: [{ ...registration, payment: { ...registration.payment, paymentStatus: "PC" } }], total: 1, totalPages: 1 } });
  await act(async () => { render(<MemoryRouter><Registrations /></MemoryRouter>); });
  await act(async () => buttons("Open actions for registration 7")[0].click());
  expect(buttons("Mark as Paid")[0]).toBeEnabled();
});

it("refreshes the editing restriction on focus and restores editing after integration is cancelled", async () => {
  function Probe() { const ready = useEventIntegration(); return <button disabled={ready("1")}>Edit</button>; }
  await act(async () => { render(<Probe />); });
  expect(buttons("Edit")[0]).toBeDisabled();
  service.apiGetEvents.mockResolvedValue({ data: [{ ...event, readyForEventIntegration: false }] });
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(buttons("Edit")[0]).toBeEnabled();
});


it("warns before opening event or program editing", async () => {
  await act(async () => { render(<MemoryRouter initialEntries={["/admin/events/1"]}><Routes><Route path="/admin/events/:eventId" element={<EventEdit />} /></Routes></MemoryRouter>); });
  expect(buttons("Edit Event")[0]).toBeEnabled();
  await act(async () => buttons("Edit Event")[0].click());
  expect(document.body.textContent).toContain(eventIntegrationMessage);
  expect(buttons("Save Event")).toHaveLength(0);
  await act(async () => buttons("OK")[0].click());
  expect(buttons("Add Program")[0]).toBeEnabled();
  await act(async () => buttons("Add Program")[0].click());
  expect(document.body.textContent).toContain(eventIntegrationMessage);
});

it("warns before opening participant editing", async () => {
  const participant = { id: "12", fullName: "Test Player", sbaId: "123", participantStatus: "A" };
  service.apiGetRegistrations.mockResolvedValue({ data: { items: [{ ...registration, groups: [{ ...registration.groups[0], participants: [participant] }] }], total: 1, totalPages: 1 } });
  await act(async () => { render(<MemoryRouter><ParticipantDetails /></MemoryRouter>); });
  const player = Array.from(document.querySelectorAll("button")).find(button => button.textContent?.includes("Test Player"))!;
  expect(player).toBeEnabled();
  await act(async () => player.click());
  expect(document.body.textContent).toContain(eventIntegrationMessage);
  expect(buttons("Save Changes")).toHaveLength(0);
  expect(service.apiUpdateParticipant).not.toHaveBeenCalled();
});
