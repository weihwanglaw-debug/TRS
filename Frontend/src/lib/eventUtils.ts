import type { CartEntry, TournamentEvent, EventStatus, Program } from "@/types/config";

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

export function getEventStatus(event: TournamentEvent): EventStatus {
  if (event.computedRegistrationStatus) return event.computedRegistrationStatus;
  if (!event.programs?.length) return "D";
  if (event.registrationStatus === "PA") return "PA";
  if (event.registrationStatus === "CL") return "CL";
  const today = singaporeDateKey();
  if (today < event.openDate) return "U";
  if (today > event.closeDate) return "CL";
  return "O";
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
