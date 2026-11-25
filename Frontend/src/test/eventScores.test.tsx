import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventScores from "@/pages/EventScores";
import type { LiveScores, ProgramResults, ScoreMatch } from "@/lib/api/scoresApi";

const service = vi.hoisted(() => ({ getLiveScores: vi.fn(), getProgramResults: vi.fn(), getScoreAvailability: vi.fn() }));
vi.mock("@/lib/api/scoresApi", () => service);
vi.mock("@/components/layout/Header", () => ({ default: () => null }));
vi.mock("@/components/layout/Footer", () => ({ default: () => null }));
vi.mock("@/contexts/LiveConfigContext", () => ({ useLiveConfig: () => ({ cfg: { displayTimeZone: "+08:00", displayDateTimeFormat: "dd/MM/yyyy HH:mm:ss" } }) }));
const match = { id: "1", programId: 12, programName: "Doubles", phase: "G", round: 1, roundLabel: "Group Stage", group: "Group A",
  team1: { id: "a", name: "A", players: ["Alice", "Beth"], seed: null }, team2: { id: "b", name: "B", players: ["Carol", "Dina"], seed: null },
  games: [{ a: 21, b: 19 }], winner: "A", remark: "", outcome: "N", matchDate: "2026-11-03", startTime: "14:00", court: "1", status: "C", scoreA: 3, scoreB: 4 } as ScoreMatch;
let container: HTMLDivElement, root: Root;
async function show(live = false, path = "/event/7/results?program=12") {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/event/:id/results" element={<EventScores live={live} />} /></Routes></MemoryRouter>));
}
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible"); service.getScoreAvailability.mockResolvedValue({hasLiveScores:true,resultProgramIds:[],refreshSeconds:5}); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
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


it("links from empty live scores to event results", async () => {
 service.getLiveScores.mockResolvedValue({eventName:"Open",matches:[],refreshSeconds:5,receivedAt:null});
 service.getScoreAvailability.mockResolvedValue({hasLiveScores:false,resultProgramIds:[13],refreshSeconds:5});
 await show(true);
 expect(container.textContent).toContain("No matches currently in progress.");
 const link=Array.from(container.querySelectorAll("a")).find(a=>a.textContent==="View Results")!;
 expect(link.getAttribute("href")).toBe("/event/7/results");
});

it("does not offer results when none are available", async () => {
 service.getLiveScores.mockResolvedValue({eventName:"Open",matches:[],refreshSeconds:5,receivedAt:null});
 await show(true);expect(container.textContent).not.toContain("View Results");
});

const results = { eventId: 7, eventName: "Open", programId: 12, programs: [{ id: 12, name: "Doubles" }], source: "TLS", receivedAt: null, timeZone: "Asia/Singapore", matches: [match], heats: [] } as ProgramResults;
const liveScores = (receivedAt: string | null, refreshSeconds = 2): LiveScores => ({ eventId: 7, eventName: "Open", matches: [{ ...match, status: "IP", winner: null }], refreshSeconds, receivedAt, timeZone: "Asia/Singapore" });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("public score freshness", () => {
  it("refreshes completion, correction and reset without reloading", async () => {
    vi.useFakeTimers();
    service.getProgramResults.mockResolvedValueOnce({ ...results, matches: [] }).mockResolvedValueOnce(results)
      .mockResolvedValueOnce({ ...results, matches: [{ ...match, winner: "B", games: [{ a: 18, b: 21 }] }] })
      .mockResolvedValue({ ...results, matches: [] });
    await show();
    expect(container.textContent).toContain("Results are not available yet.");
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(container.querySelector(".is-winner")?.textContent).toContain("Alice / Beth");
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(container.querySelector(".is-winner")?.textContent).toContain("Carol / Dina");
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(container.textContent).toContain("Results are not available yet.");
    expect(container.querySelector(".public-score-card")).toBeNull();
    expect(container.textContent).not.toContain("Winner");
  });

  it("retains the program and round on refresh, falling back when a round is removed", async () => {
    vi.useFakeTimers();
    service.getProgramResults.mockResolvedValue({ ...results, matches: [match, { ...match, id: "2", phase: "K", roundLabel: "Final", group: "" }] });
    await show();
    const final = () => [...container.querySelectorAll<HTMLButtonElement>("[role=tab]")].find(b => b.textContent === "Final")!;
    await act(async () => final().click());
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(final().getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector("select")?.value).toBe("12");
    expect(service.getProgramResults).toHaveBeenLastCalledWith("7", "12", expect.any(AbortSignal));
    service.getProgramResults.mockResolvedValue(results);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Group Stage");
  });

  it("pauses hidden polling and refreshes on visibility, focus and reconnection", async () => {
    vi.useFakeTimers(); service.getProgramResults.mockResolvedValue(results);
    await show();
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(service.getProgramResults).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue("visible");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(service.getProgramResults).toHaveBeenCalledTimes(2);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(service.getProgramResults).toHaveBeenCalledTimes(3);
    await act(async () => window.dispatchEvent(new Event("online")));
    expect(service.getProgramResults).toHaveBeenCalledTimes(4);
    await act(async () => root.render(<div>Other page</div>));
    await act(async () => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online")); await vi.advanceTimersByTimeAsync(20000); });
    expect(service.getProgramResults).toHaveBeenCalledTimes(4);
  });

  it("serializes slow requests and coalesces refresh events", async () => {
    vi.useFakeTimers(); const pending = deferred<ProgramResults>();
    service.getProgramResults.mockReturnValueOnce(pending.promise).mockResolvedValue(results);
    await show();
    await act(async () => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online")); await vi.advanceTimersByTimeAsync(10000); });
    expect(service.getProgramResults).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(results));
    expect(service.getProgramResults).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll(".public-score-card")).toHaveLength(1);
  });

  it("retries stalled requests after a bounded timeout", async () => {
    vi.useFakeTimers();
    service.getProgramResults.mockImplementationOnce((_id, _program, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })).mockResolvedValue(results);
    await show();
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(container.textContent).toContain("Unable to refresh scores. Retrying automatically.");
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(container.querySelector("[role=alert]")).toBeNull();
    expect(container.textContent).toContain("Alice / Beth");
  });

  it("aborts old program requests and ignores their late responses", async () => {
    vi.useFakeTimers(); const pending = deferred<ProgramResults>();
    const programs = [...results.programs, { id: 13, name: "Singles" }];
    service.getProgramResults.mockResolvedValueOnce({ ...results, programs }).mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ ...results, programId: 13, programs, matches: [] });
    await show();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    const signal = service.getProgramResults.mock.calls[1][2] as AbortSignal;
    await act(async () => { const select = container.querySelector("select")!; select.value = "13"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(results));
    expect(container.querySelector("select")?.value).toBe("13");
    expect(container.textContent).toContain("Results are not available yet.");
    expect(container.textContent).not.toContain("Alice / Beth");
  });

  it.each([2, 8, 120])("warns at the age threshold for a %i-second feed and clears on recovery", async interval => {
    vi.useFakeTimers(); const start = new Date("2026-11-03T06:00:00Z"); vi.setSystemTime(start);
    service.getLiveScores.mockResolvedValue(liveScores(start.toISOString(), interval));
    await show(true);
    const threshold = Math.max(15, 3 * interval) * 1000;
    await act(async () => { await vi.advanceTimersByTimeAsync(threshold - 1); });
    expect(container.querySelector("[role=alert]")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(container.textContent).toContain("Live updates delayed \u2014 showing last received scores");
    expect(container.textContent).toContain("Alice / Beth");
    service.getLiveScores.mockResolvedValue(liveScores(new Date().toISOString(), interval));
    await act(async () => window.dispatchEvent(new Event("online")));
    expect(container.querySelector("[role=alert]")).toBeNull();
  });

  it("ages a feed during a pending refresh and retains scores when the next fetch fails", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-03T06:00:00Z")); const pending = deferred<LiveScores>();
    service.getLiveScores.mockResolvedValueOnce(liveScores(new Date().toISOString())).mockReturnValueOnce(pending.promise)
      .mockRejectedValue(new Error("Cannot reach TRS"));
    await show(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(container.textContent).toContain("Live updates delayed");
    await act(async () => pending.resolve(liveScores("2026-11-03T06:00:00Z")));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(container.textContent).toContain("Cannot reach TRS");
    expect(container.textContent).toContain("Alice / Beth");
  });

  it("clears delay warnings for an empty feed", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-03T06:02:00Z"));
    service.getLiveScores.mockResolvedValueOnce(liveScores("2026-11-03T06:00:00Z")).mockResolvedValue({ ...liveScores(null), matches: [] });
    await show(true);
    expect(container.textContent).toContain("Live updates delayed");
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(container.querySelector("[role=alert]")).toBeNull();
    expect(container.textContent).toContain("No matches currently in progress.");
  });

  it("does not warn early for a future receipt timestamp", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-03T06:00:00Z"));
    service.getLiveScores.mockResolvedValue(liveScores("2026-11-03T06:01:00Z"));
    await show(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(container.querySelector("[role=alert]")).toBeNull();
  });

  it.each([null, "invalid"])("warns for an awaiting-confirmation match with receipt %s", async receivedAt => {
    service.getLiveScores.mockResolvedValue({ ...liveScores(receivedAt), matches: [{ ...match, status: "RC" }] });
    await show(true);
    expect(container.textContent).toContain("Live updates delayed");
    expect(container.textContent).toContain("Awaiting organiser confirmation");
    expect(container.textContent).toContain("Alice / Beth");
  });
});


it("shows warm-up and a technical pause from the external feed", async () => {
  service.getLiveScores.mockResolvedValue({ ...liveScores(new Date().toISOString()),
    matches: [{ ...match, id: "warm", status: "SC", gamePhase: "WU", winner: null },
      { ...match, id: "pause", status: "IP", gamePhase: "TP", winner: null }] });
  await show(true);
  expect(container.textContent).toContain("Warm-up");
  expect(container.textContent).toContain("Technical pause");
});

it("lists TLS programs without results and filters the event snapshot by date", async () => {
  const programs = [{ id: 12, name: "Doubles" }, { id: 13, name: "Singles" }, { id: 14, name: "Pending program" }];
  service.getProgramResults.mockResolvedValue({
    eventId: 7, eventName: "Social play", programId: null, programs, source: "TLS", heats: [],
    matches: [match, { ...match, id: "2", programId: 13, programName: "Singles", matchDate: "2026-11-04" }],
  });
  await show(false, "/event/7/results");
  expect(container.querySelector('#score-program option[value="14"]')?.textContent).toBe("Pending program");
  const select = container.querySelector<HTMLSelectElement>("#score-date")!;
  await act(async () => { select.value = "2026-11-04"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect([...container.querySelectorAll("h3")].map(h => h.textContent)).toContain("Singles");
  expect([...container.querySelectorAll("h3")].map(h => h.textContent)).not.toContain("Doubles");
});
