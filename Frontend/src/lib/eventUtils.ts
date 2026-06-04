import type { TournamentEvent, EventStatus } from "@/types/config";

export function getEventStatus(event: TournamentEvent): EventStatus {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const open = new Date(event.openDate);
  const close = new Date(event.closeDate);
  if (today < open) return "upcoming";
  if (today > close) return "closed";
  return "open";
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
