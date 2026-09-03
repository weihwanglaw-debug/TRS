import { describe, expect, it } from "vitest";
import { getCartProgramCapacityUsage } from "@/lib/eventUtils";
import type { CartEntry, Program } from "@/types/config";

function program(feeStructure: Program["feeStructure"]): Program {
  return {
    id: "program-1",
    name: "Doubles",
    type: "doubles",
    sbaRankingType: null,
    gender: "Open",
    minAge: 1,
    maxAge: 99,
    fee: 20,
    paymentRequired: true,
    feeStructure,
    minPlayers: 2,
    maxPlayers: 2,
    minParticipants: 2,
    maxParticipants: 16,
    currentParticipants: 0,
    status: "O",
    fields: {
      enableSbaId: false,
      enableDocumentUpload: false,
      enableGuardianInfo: false,
      enableRemark: false,
      enableTshirt: false,
      requireSbaId: false,
      requireDocumentUpload: false,
      requireGuardianInfo: false,
      requireRemark: false,
      requireTshirt: false,
      customFields: [],
    },
  };
}

const cart = [
  { programId: "program-1", participants: [{}, {}] },
  { programId: "program-1", participants: [{}, {}] },
  { programId: "program-2", participants: [{}] },
] as CartEntry[];

describe("getCartProgramCapacityUsage", () => {
  it("counts players for per-player programs", () => {
    expect(getCartProgramCapacityUsage(cart, program("per_player"))).toBe(4);
  });

  it("counts entries for per-entry programs and can exclude the edited row", () => {
    expect(getCartProgramCapacityUsage(cart, program("per_entry"))).toBe(2);
    expect(getCartProgramCapacityUsage(cart, program("per_entry"), 0)).toBe(1);
  });
});
