import type { CartEntry, TournamentEvent, EventStatus, Program, ProgramStatus } from "@/types/config";

const SINGAPORE_TIME_ZONE = "Asia/Singapore";

export function singaporeDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-SG", {
    timeZone: SINGAPORE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find(p => p.type === "year")?.value ?? "0000";
  const month = parts.find(p => p.type === "month")?.value ?? "00";
  const day = parts.find(p => p.type === "day")?.value ?? "00";
  return `${year}-${month}-${day}`;
}

function parseDateOnly(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function getEventStatus(event: TournamentEvent, today = singaporeDateKey()): EventStatus {
  if (event.isActive === false) return "CL";
  if (event.computedRegistrationStatus) return event.computedRegistrationStatus;
  if (!event.programs?.length) return "D";
  if (today > event.closeDate) return "CL";
  if (event.registrationStatus === "CL") return "CL";
  if (event.registrationStatus === "PA") return "PA";
  if (today < event.openDate) return "U";
  return "O";
}

export function isEventVisibleOnLanding(
  event: TournamentEvent,
  today = singaporeDateKey(),
): boolean {
  if (event.isActive === false || !event.programs?.length) return false;
  const finalEventDate = event.eventEndDate || event.eventStartDate;
  return Boolean(finalEventDate) && today <= finalEventDate;
}

export interface ProgramRegistrationPresentation {
  badgeStatus: EventStatus | ProgramStatus;
  buttonLabel: string;
  canRegister: boolean;
}

export function getProgramRegistrationPresentation({
  eventStatus,
  programDisplayStatus,
  isAuthenticated,
  cartCapacityUsage = 0,
}: {
  eventStatus: EventStatus;
  programDisplayStatus: ProgramStatus;
  isAuthenticated: boolean;
  cartCapacityUsage?: number;
}): ProgramRegistrationPresentation {
  if (eventStatus === "D") {
    return { badgeStatus: "D", buttonLabel: "Registration Unavailable", canRegister: false };
  }

  if (!isAuthenticated && eventStatus !== "O") {
    const buttonLabel = eventStatus === "U"
      ? "Registration Not Open"
      : eventStatus === "PA"
        ? "Registration Paused"
        : "Registration Closed";
    return { badgeStatus: eventStatus, buttonLabel, canRegister: false };
  }

  if (programDisplayStatus === "F") {
    return {
      badgeStatus: "F",
      buttonLabel: cartCapacityUsage > 0 ? "Limit Reached" : "Full",
      canRegister: false,
    };
  }
  if (programDisplayStatus === "CL") {
    return { badgeStatus: "CL", buttonLabel: "Closed", canRegister: false };
  }

  return {
    badgeStatus: programDisplayStatus,
    buttonLabel: isAuthenticated ? "Admin Register" : "Register",
    canRegister: true,
  };
}

export function getCartProgramCapacityUsage(
  cart: CartEntry[],
  program: Program,
  excludeIndex: number | null = null,
): number {
  return cart
    .filter((entry, index) => entry.programId === program.id && index !== excludeIndex)
    .reduce(
      (total, entry) => total + (program.feeStructure === "per_player" ? entry.participants.length : 1),
      0,
    );
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  return parseDateOnly(dateStr).toLocaleDateString("en-SG", {
    timeZone: SINGAPORE_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
