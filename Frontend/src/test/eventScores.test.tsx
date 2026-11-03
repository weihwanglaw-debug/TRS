import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventScores from "@/pages/EventScores";
import type { ScoreMatch } from "@/lib/api/scoresApi";

const service = vi.hoisted(() => ({ getLiveScores: vi.fn(), getProgramResults: vi.fn() }));
vi.mock("@/lib/api/scoresApi", () => service);
vi.mock("@/components/layout/Header", () => ({ default: () => null }));
vi.mock("@/components/layout/Footer", () => ({ default: () => null }));
vi.mock("@/contexts/LiveConfigContext", () => ({ useLiveConfig: () => ({ cfg: { displayTimeZone: "+08:00", displayDateTimeFormat: "dd/MM/yyyy HH:mm:ss" } }) }));
const match = { id: "1", programId: 12, programName: "Doubles", phase: "G", round: 1, roundLabel: "Group Stage", group: "Group A",
  team1: { id: "a", name: "A", players: ["Alice", "Beth"], seed: null }, team2: { id: "b", name: "B", players: ["Carol", "Dina"], seed: null },
  games: [{ a: 21, b: 19 }], winner: "A", remark: "", outcome: "N", matchDate: "2026-11-03", startTime: "14:00", court: "1", status: "C", scoreA: 3, scoreB: 4 } as ScoreMatch;
let container: HTMLDivElement, root: Root;
async function show(live = false) {
  await act(async () => root.render(<MemoryRouter initialEntries={["/event/7/results?program=12"]}><Routes><Route path="/event/:id/results" element={<EventScores live={live} />} /></Routes></MemoryRouter>));
}
beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.clearAllMocks(); });
describe("public results and live scores", () => {
  it("shows opponents, winners and round tabs for either server-selected source", async () => {
    service.getProgramResults.mockResolvedValue({ eventId: 7, eventName: "Open", programId: 12, programs: [{ id: 12, name: "Doubles" }, { id: 13, name: "Singles" }], source: "TRS", matches: [match, { ...match, id: "2", phase: "K", roundLabel: "Final", group: "" }], heats: [] });
    await show();
    expect(container.textContent).toContain("Alice / Beth"); expect(container.textContent).toContain("Winner");
    const final = [...container.querySelectorAll<HTMLButtonElement>("[role=tab]")].find(b => b.textContent === "Final")!;
    await act(async () => final.click()); expect(final.getAttribute("aria-selected")).toBe("true");
    await act(async () => { const select = container.querySelector("select")!; select.value = "13"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(service.getProgramResults).toHaveBeenCalledWith("7", "13", expect.any(AbortSignal));
  });
  it("shows the empty result message when no results have been published", async () => {
    service.getProgramResults.mockResolvedValue({ eventName: "Open", programId: 12, programs: [{ id: 12, name: "Doubles" }], matches: [], heats: [] });
    await show(); expect(container.textContent).toContain("Results are not available yet.");
  });
  it("updates live scores to empty while retaining the received timestamp", async () => {
    vi.useFakeTimers();
    service.getLiveScores.mockResolvedValueOnce({ eventName: "Open", matches: [{ ...match, status: "IP", winner: null }], refreshSeconds: 2, receivedAt: "2026-11-03T06:00:00Z" })
      .mockResolvedValue({ eventName: "Open", matches: [], refreshSeconds: 2, receivedAt: "2026-11-03T06:01:00Z" });
    await show(true);
    expect(container.textContent).toContain("Alice / Beth"); expect(container.querySelector("select")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(container.textContent).toContain("No matches currently in progress.");
    expect(container.textContent).toContain("Last received from TLS"); expect(container.textContent).toContain("Last fetched"); expect(container.textContent).not.toContain("Alice / Beth");
  });
  it("retains the configured interval and both timestamps when a fetch fails", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-03T06:02:00Z"));
    service.getLiveScores.mockResolvedValueOnce({ eventName: "Open", matches: [match], refreshSeconds: 8, receivedAt: "2026-11-03T06:01:00Z" })
      .mockRejectedValueOnce(new Error("Cannot reach TRS"))
      .mockResolvedValue({ eventName: "Open", matches: [match], refreshSeconds: 8, receivedAt: "2026-11-03T06:01:00Z" });
    await show(true);
    const fetched = () => container.querySelector('[data-testid="last-fetched"]')?.textContent;
    const received = () => container.querySelector('[data-testid="last-received"]')?.textContent;
    expect(fetched()).toBe("03/11/2026 14:02:00"); expect(received()).toBe("03/11/2026 14:01:00");
    expect(container.textContent).toContain("Refreshes every 8 seconds");
    expect(container.querySelector('a')?.getAttribute('href')).toBe("/event/7");
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(container.textContent).toContain("Cannot reach TRS");
    expect(fetched()).toBe("03/11/2026 14:02:00"); expect(received()).toBe("03/11/2026 14:01:00");
    expect(container.textContent).toContain("Alice / Beth");
    await act(async () => { await vi.advanceTimersByTimeAsync(7999); });
    expect(service.getLiveScores).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetched()).toBe("03/11/2026 14:02:16"); expect(received()).toBe("03/11/2026 14:01:00");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("stops live polling after leaving the page", async () => {
    vi.useFakeTimers();
    service.getLiveScores.mockResolvedValue({ eventName: "Open", matches: [], refreshSeconds: 3, receivedAt: null });
    await show(true); const calls = service.getLiveScores.mock.calls.length;
    await act(async () => root.render(<div>Other page</div>));
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(service.getLiveScores).toHaveBeenCalledTimes(calls);
  });
});
