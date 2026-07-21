import type { SheetData } from "write-excel-file/browser";
import type { Program } from "@/types/config";
import type {
  ItemStatus,
  ParticipantGroup,
  PaymentItem,
  PaymentStatus,
  RegStatus,
  Registration,
  RegistrationParticipant,
} from "@/types/registration";
import {
  ITEM_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  REG_STATUS_LABEL,
} from "@/types/registration";
import { exportWorkbookSheet } from "@/lib/exportRegistrationPaymentsWorkbook";

const PRIMARY_HEADERS = [
  "No.",
  "Event",
  "Program",
  "Reg No.",
  "Group ID",
  "Full Name",
  "Date of Birth",
  "Gender",
  "Email",
  "Contact Number",
  "Nationality",
  "Club / Team / School",
  "Registration Status",
  "Payment Status",
];

const OPTIONAL_HEADERS = [
  "SBA ID",
  "T-Shirt Size",
  "Guardian Name",
  "Guardian Contact",
  "Remark",
];

function rowRegistrationStatus(group: ParticipantGroup, participant: RegistrationParticipant): string {
  return participant.participantStatus === "X" ? "X" : group.groupStatus;
}

function paymentItemForParticipant(reg: Registration, group: ParticipantGroup, participant: RegistrationParticipant): PaymentItem | undefined {
  const items = reg.payment?.items ?? [];
  return items.find(item => String(item.participantId) === String(participant.id))
    ?? items.find(item => String(item.participantGroupId) === String(group.id) && !item.participantId)
    ?? items.find(item => String(item.participantGroupId) === String(group.id));
}

function paymentStatusForParticipant(reg: Registration, group: ParticipantGroup, participant: RegistrationParticipant): string {
  const itemStatus = paymentItemForParticipant(reg, group, participant)?.itemStatus;
  return itemStatus
    ? ITEM_STATUS_LABEL[itemStatus as ItemStatus] ?? itemStatus
    : PAYMENT_STATUS_LABEL[reg.payment?.paymentStatus as PaymentStatus] ?? reg.payment?.paymentStatus ?? "";
}

interface ParticipantReportRow {
  reg: Registration;
  group: ParticipantGroup;
  participant: RegistrationParticipant;
  status: string;
}

type ProgramLookup = Record<string, Program | undefined>;

function customFieldLabelMap(programsById: ProgramLookup): Record<string, string> {
  const map: Record<string, string> = {};
  for (const program of Object.values(programsById)) {
    for (const field of program?.fields?.customFields ?? []) {
      const label = field.label?.trim();
      if (!label) continue;
      map[String(field.id)] = label;
      map[label] = label;
    }
  }
  return map;
}

function customFieldLabels(reportRows: ParticipantReportRow[], labelMap: Record<string, string>): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const row of reportRows) {
    for (const label of Object.keys(row.participant.customFieldValues ?? {})) {
      const trimmed = (labelMap[String(label)] ?? label).trim();
      const key = trimmed.toLowerCase();
      if (!trimmed || seen.has(key)) continue;
      seen.add(key);
      labels.push(trimmed);
    }
  }
  return labels;
}

function participantMatchesSearch(reg: Registration, group: ParticipantGroup, participant: RegistrationParticipant, search?: string): boolean {
  const q = search?.trim().toLowerCase();
  if (!q) return true;
  const searchable = [
    participant.fullName,
    participant.sbaId,
    participant.clubSchoolCompany,
    group.clubDisplay,
    group.namesDisplay,
    reg.id,
    reg.eventName,
    group.programName,
  ].join(" ").toLowerCase();
  return searchable.includes(q);
}

function titleRows(filterSummary: string, columnCount: number): SheetData {
  return [
    [{
      value: "Participant Details Report",
      columnSpan: columnCount,
      fontWeight: "bold" as const,
      fontSize: 14,
    }],
    [{
      value: filterSummary,
      columnSpan: columnCount,
      wrap: true,
    }],
  ];
}

export async function exportParticipantDetailsWorkbook(
  label: string,
  registrations: Registration[],
  filterSummary: string,
  options: {
    statusFilter?: string;
    search?: string;
    programId?: string;
    programsById?: ProgramLookup;
  } = {},
) {
  const reportRows: ParticipantReportRow[] = [];
  for (const reg of registrations) {
    for (const group of reg.groups) {
      if (options.programId && String(group.programId) !== String(options.programId)) continue;

      for (const participant of group.participants) {
        const status = rowRegistrationStatus(group, participant);
        if (options.statusFilter && status !== options.statusFilter) continue;
        if (!participantMatchesSearch(reg, group, participant, options.search)) continue;
        reportRows.push({ reg, group, participant, status });
      }
    }
  }

  const labelMap = customFieldLabelMap(options.programsById ?? {});
  const customHeaders = customFieldLabels(reportRows, labelMap);
  const headers = [...PRIMARY_HEADERS, ...OPTIONAL_HEADERS, ...customHeaders];
  const rows: SheetData = [];
  let rowNo = 1;

  for (const { reg, group, participant, status } of reportRows) {
    rows.push([
          { value: rowNo++, align: "right" as const },
          reg.eventName,
          group.programName,
          reg.id,
          group.id,
          participant.fullName,
          participant.dob,
          participant.gender,
          participant.email ?? "",
          participant.contactNumber ?? "",
          participant.nationality,
          participant.clubSchoolCompany || group.clubDisplay || "",
          REG_STATUS_LABEL[status as RegStatus] ?? status,
          paymentStatusForParticipant(reg, group, participant),
          participant.sbaId ?? "",
          participant.tshirtSize ?? "",
          participant.guardianName ?? "",
          participant.guardianContact ?? "",
          participant.remark ?? "",
          ...customHeaders.map(header => {
            const values = participant.customFieldValues ?? {};
            const match = Object.entries(values).find(([key]) => (labelMap[String(key)] ?? key) === header);
            return match?.[1] ?? "";
          }),
    ]);
  }

  await exportWorkbookSheet({
    filename: `${label} - Participant Details`,
    headers,
    rows,
    preHeaderRows: titleRows(filterSummary, headers.length),
    stickyRowsCount: 3,
    columns: [
      { width: 6 },
      { width: 28 },
      { width: 24 },
      { width: 10 },
      { width: 10 },
      { width: 26 },
      { width: 14 },
      { width: 12 },
      { width: 30 },
      { width: 18 },
      { width: 18 },
      { width: 30 },
      { width: 18 },
      { width: 18 },
      { width: 14 },
      { width: 14 },
      { width: 22 },
      { width: 18 },
      { width: 30 },
      ...customHeaders.map(() => ({ width: 24 })),
    ],
  });
}
