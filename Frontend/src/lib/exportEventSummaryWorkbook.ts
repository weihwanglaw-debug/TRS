import type { SheetData } from "write-excel-file/browser";
import type { Program, TournamentEvent } from "@/types/config";
import type { Registration } from "@/types/registration";
import { exportWorkbookSheet } from "@/lib/exportRegistrationPaymentsWorkbook";

const HEADERS = [
  "Event Name",
  "Event Start Date",
  "Event End Date",
  "Registration Open Date",
  "Registration Close Date",
  "Registration Status",
  "isSport",
  "SportsType",
  "Fixture Management Mode",
  "Program Name",
  "Program Type",
  "Gender",
  "Min Age",
  "Max Age",
  "Min Entries",
  "Max Entries",
  "Min Players / Entry",
  "Max Players / Entry",
  "Fee",
  "Fee Structure",
  "Registered",
  "Cancelled",
];

const EVENT_STATUS_LABEL: Record<string, string> = {
  D: "Draft",
  U: "Upcoming",
  O: "Open",
  PA: "Paused",
  CL: "Closed",
};

const FIXTURE_MODE_LABEL: Record<string, string> = {
  internal: "Internal",
  external: "External",
  not_required: "Not Required",
};

function dateOnly(value?: string): string {
  return value ? value.slice(0, 10) : "";
}

function eventStatus(event: TournamentEvent): string {
  const status = event.computedRegistrationStatus ?? event.registrationStatus ?? "";
  return EVENT_STATUS_LABEL[status] ?? status;
}

function feeStructure(program: Program): string {
  if (!program.paymentRequired || program.fee <= 0) return "";
  return program.feeStructure;
}

function countProgram(registrations: Registration[], program: Program) {
  let registered = 0;
  let cancelled = 0;

  for (const reg of registrations) {
    for (const group of reg.groups) {
      if (String(group.programId) !== String(program.id)) continue;

      if (program.feeStructure === "per_player") {
        for (const participant of group.participants) {
          const isCancelled = reg.regStatus === "X" || group.groupStatus === "X" || participant.participantStatus === "X";
          if (isCancelled) cancelled += 1;
          else registered += 1;
        }
      } else {
        const isCancelled = reg.regStatus === "X" || group.groupStatus === "X";
        if (isCancelled) cancelled += 1;
        else registered += 1;
      }
    }
  }

  return { registered, cancelled };
}

function titleRows(): SheetData {
  return [
    [{
      value: "Event and Program Summary Report",
      columnSpan: HEADERS.length,
      fontWeight: "bold" as const,
      fontSize: 14,
    }],
  ];
}

export async function exportEventSummaryWorkbook(
  events: TournamentEvent[],
  registrations: Registration[],
) {
  const rows: SheetData = [];

  for (const event of events) {
    for (const program of event.programs) {
      const counts = countProgram(registrations, program);
      rows.push([
        event.name,
        dateOnly(event.eventStartDate),
        dateOnly(event.eventEndDate),
        dateOnly(event.openDate),
        dateOnly(event.closeDate),
        eventStatus(event),
        event.isSports ? "Yes" : "No",
        event.isSports ? event.sportType : "",
        event.isSports ? FIXTURE_MODE_LABEL[event.fixtureMode] ?? event.fixtureMode : "",
        program.name,
        program.type,
        program.gender,
        program.minAge,
        program.maxAge,
        program.minParticipants,
        program.maxParticipants,
        program.minPlayers,
        program.maxPlayers,
        {
          value: program.paymentRequired ? program.fee : 0,
          type: Number,
          format: "#,##0.00",
          align: "right" as const,
        },
        feeStructure(program),
        counts.registered,
        counts.cancelled,
      ]);
    }
  }

  await exportWorkbookSheet({
    filename: "Event and Program Summary",
    headers: HEADERS,
    rows,
    preHeaderRows: titleRows(),
    stickyRowsCount: 2,
    columns: [
      { width: 28 },
      { width: 16 },
      { width: 16 },
      { width: 20 },
      { width: 20 },
      { width: 18 },
      { width: 10 },
      { width: 16 },
      { width: 24 },
      { width: 24 },
      { width: 16 },
      { width: 14 },
      { width: 10 },
      { width: 10 },
      { width: 12 },
      { width: 12 },
      { width: 18 },
      { width: 18 },
      { width: 12 },
      { width: 16 },
      { width: 12 },
      { width: 12 },
    ],
  });
}
