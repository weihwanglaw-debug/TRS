import type { TournamentEvent, EventStatus } from "@/types/config";

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
  if (!event.programs?.length) return "draft";
  const today = singaporeDateKey();
  if (today < event.openDate) return "upcoming";
  if (today > event.closeDate) return "closed";
  if (event.registrationStatus === "paused") return "paused";
  if (event.registrationStatus === "closed") return "closed";
  return "open";
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
