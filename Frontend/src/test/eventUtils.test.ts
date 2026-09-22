import { describe, expect, it } from "vitest";
import {
  getCartProgramCapacityUsage,
  getEventStatus,
  getProgramRegistrationPresentation,
  isEventVisibleOnLanding,
  singaporeDateKey,
} from "@/lib/eventUtils";
import type { CartEntry, Program, TournamentEvent } from "@/types/config";

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

function event(overrides: Partial<TournamentEvent> = {}): TournamentEvent {
  return {
    id: "event-1",
    name: "Test Event",
    description: "",
    venue: "Test Venue",
    venueAddress: "",
    bannerUrl: "",
    galleryUrls: [],
    additionalInfo: "",
    documents: [],
    eventStartDate: "2026-10-01",
    eventEndDate: "2026-10-03",
    openDate: "2026-09-01",
    closeDate: "2026-09-30",
    sponsorInfo: "",
    isSports: true,
    sportType: "Badminton",
    fixtureMode: "internal",
    isActive: true,
    registrationStatus: "O",
    programs: [program("per_entry")],
    ...overrides,
  };
}

describe("getCartProgramCapacityUsage", () => {
  it("counts players for per-player programs", () => {
    expect(getCartProgramCapacityUsage(cart, program("per_player"))).toBe(4);
  });

  it("counts entries for per-entry programs and can exclude the edited row", () => {
    expect(getCartProgramCapacityUsage(cart, program("per_entry"))).toBe(2);
    expect(getCartProgramCapacityUsage(cart, program("per_entry"), 0)).toBe(1);
  });
});

describe("getEventStatus", () => {
  it("uses the Singapore calendar date", () => {
    expect(singaporeDateKey(new Date("2026-09-21T16:30:00Z"))).toBe("2026-09-22");
  });

  it("treats an inactive event as closed", () => {
    expect(getEventStatus(event({ isActive: false }), "2026-09-22")).toBe("CL");
  });

  it("treats an event without active programs as draft", () => {
    expect(getEventStatus(event({ programs: [] }), "2026-09-22")).toBe("D");
  });

  it("lets the closing date override a manual pause", () => {
    expect(getEventStatus(event({ registrationStatus: "PA", closeDate: "2026-09-21" }), "2026-09-22")).toBe("CL");
  });

  it("keeps a manual pause during the registration window", () => {
    expect(getEventStatus(event({ registrationStatus: "PA" }), "2026-09-22")).toBe("PA");
  });
});

describe("isEventVisibleOnLanding", () => {
  it("works through an Array.filter callback without receiving the array index as the date", () => {
    const visible = [event()].filter((candidate) => isEventVisibleOnLanding(candidate, "2026-09-22"));
    expect(visible).toHaveLength(1);
  });

  it("shows closed and paused events through their event end date", () => {
    expect(isEventVisibleOnLanding(event({ registrationStatus: "CL" }), "2026-10-03")).toBe(true);
    expect(isEventVisibleOnLanding(event({ registrationStatus: "PA" }), "2026-10-03")).toBe(true);
  });

  it("hides events after their end date and falls back to the start date", () => {
    expect(isEventVisibleOnLanding(event(), "2026-10-04")).toBe(false);
    expect(isEventVisibleOnLanding(event({ eventEndDate: "" }), "2026-10-02")).toBe(false);
  });

  it("hides draft and inactive events", () => {
    expect(isEventVisibleOnLanding(event({ programs: [] }), "2026-09-22")).toBe(false);
    expect(isEventVisibleOnLanding(event({ isActive: false }), "2026-09-22")).toBe(false);
  });
});

describe("getProgramRegistrationPresentation", () => {
  it.each([
    ["U", "Registration Not Open"],
    ["PA", "Registration Paused"],
    ["CL", "Registration Closed"],
  ] as const)("uses event status %s for public users", (eventStatus, buttonLabel) => {
    expect(getProgramRegistrationPresentation({
      eventStatus,
      programDisplayStatus: "O",
      isAuthenticated: false,
    })).toEqual({ badgeStatus: eventStatus, buttonLabel, canRegister: false });
  });

  it("allows admin-assisted registration but retains the actual program capacity badge", () => {
    expect(getProgramRegistrationPresentation({
      eventStatus: "PA",
      programDisplayStatus: "NF",
      isAuthenticated: true,
    })).toEqual({ badgeStatus: "NF", buttonLabel: "Admin Register", canRegister: true });
  });

  it("does not allow registration for a full or closed program", () => {
    expect(getProgramRegistrationPresentation({
      eventStatus: "O",
      programDisplayStatus: "F",
      isAuthenticated: true,
    }).canRegister).toBe(false);
    expect(getProgramRegistrationPresentation({
      eventStatus: "O",
      programDisplayStatus: "CL",
      isAuthenticated: false,
    }).canRegister).toBe(false);
  });
});
