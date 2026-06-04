import type { EventStatus, ProgramStatus, Program } from "@/types/config";

type BadgeStatus = EventStatus | ProgramStatus;

const styles: Record<string, { bg: string; text: string; label: string }> = {
  open:        { bg: "var(--badge-open-bg)",   text: "var(--badge-open-text)",   label: "Open"        },
  upcoming:    { bg: "var(--badge-soon-bg)",   text: "var(--badge-soon-text)",   label: "Upcoming"    },
  closed:      { bg: "var(--badge-closed-bg)", text: "var(--badge-closed-text)", label: "Closed"      },
  full:        { bg: "var(--badge-closed-bg)", text: "var(--badge-closed-text)", label: "Full"        },
  nearly_full: { bg: "var(--badge-soon-bg)",   text: "var(--badge-soon-text)",   label: "Nearly Full" },
};

export default function StatusBadge({ status }: { status: BadgeStatus }) {
  const s = styles[status] ?? styles.closed;
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 text-xs font-semibold"
      style={{ backgroundColor: s.bg, color: s.text }}
    >
      {s.label}
    </span>
  );
}

export function getProgramCapacityStatus(program: Program): BadgeStatus {
  // Respect the program's explicit status field first
  if (program.status === "closed")   return "closed";
  if (program.status === "upcoming") return "upcoming";

  // Then compute from capacity
  const ratio = program.currentParticipants / program.maxParticipants;
  if (ratio >= 1)   return "full";
  if (ratio >= 0.8) return "nearly_full";
  return "open";
}
