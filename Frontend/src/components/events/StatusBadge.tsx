import type { EventStatus, ProgramStatus, Program } from "@/types/config";

type BadgeStatus = EventStatus | ProgramStatus;

const styles: Record<string, { bg: string; text: string; label: string }> = {
  O:  { bg: "var(--badge-open-bg)",   text: "var(--badge-open-text)",   label: "Open"        },
  D:  { bg: "var(--feedback-info-bg)", text: "var(--feedback-info)",     label: "Draft"       },
  U:  { bg: "var(--badge-soon-bg)",   text: "var(--badge-soon-text)",   label: "Upcoming"    },
  PA: { bg: "var(--feedback-warning-bg)", text: "var(--feedback-warning)", label: "Paused"    },
  CL: { bg: "var(--badge-closed-bg)", text: "var(--badge-closed-text)", label: "Closed"      },
  F:  { bg: "var(--badge-closed-bg)", text: "var(--badge-closed-text)", label: "Full"        },
  NF: { bg: "var(--badge-soon-bg)",   text: "var(--badge-soon-text)",   label: "Nearly Full" },
};

export default function StatusBadge({ status }: { status: BadgeStatus }) {
  const s = styles[status] ?? styles.CL;
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
  if (program.status === "CL") return "CL";

  // Then compute from capacity
  const ratio = program.currentParticipants / program.maxParticipants;
  if (ratio >= 1)   return "F";
  if (ratio >= 0.8) return "NF";
  return "O";
}
