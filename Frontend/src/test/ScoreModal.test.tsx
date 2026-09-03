import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ScoreModal } from "@/components/admin/fixtures/ScoreModal";
import type { MatchEntry } from "@/types/config";

const draft: MatchEntry = {
  id: "match-1",
  phase: "group",
  round: 1,
  roundLabel: "Round 1",
  team1: { id: "team-1", label: "Team 1", participants: ["Player 1"] },
  team2: { id: "team-2", label: "Team 2", participants: ["Player 2"] },
  games: [{ p1: "21", p2: "10" }],
  winner: "team1",
  walkover: false,
  walkoverWinner: "",
  matchDate: "",
  startTime: "",
  endTime: "",
  courtNo: "",
  officials: [],
  status: "SC",
  expanded: false,
};

describe("ScoreModal", () => {
  it("can transition between an empty and populated draft without changing hook order", () => {
    const props = {
      open: false,
      isLocked: false,
      onClose: vi.fn(),
      onSave: vi.fn(),
      onChangeDraft: vi.fn(),
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => root.render(<ScoreModal {...props} draft={null} />));

    expect(() => act(() => root.render(<ScoreModal {...props} draft={draft} />))).not.toThrow();
    expect(() => act(() => root.render(<ScoreModal {...props} draft={null} />))).not.toThrow();

    act(() => root.unmount());
    container.remove();
  });
});
