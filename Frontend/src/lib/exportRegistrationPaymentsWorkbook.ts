import type { SheetData } from "write-excel-file/browser";
import type { Program } from "@/types/config";
import type { Registration } from "@/types/registration";
import { PAYMENT_STATUS_LABEL, REG_STATUS_LABEL, totalFee } from "@/types/registration";
import { formatRegistrationProgramsSummary } from "@/lib/exportCsv";

const HEADERS = [
  "No.",
  "Reg ID",
  "Payer Name",
  "Payer Contact",
  "Payer Email",
  "Event Name",
  "Programs",
  "Reg Status",
  "Payment Status",
  "Total",
  "Submitted",
];

export interface WorkbookColumn {
  width: number;
}

export interface WorkbookExportOptions {
  filename: string;
  headers: string[];
  rows: SheetData;
  columns: WorkbookColumn[];
}

function safeFilename(value: string) {
  return value.replace(/[/\\?%*:|"<>]/g, "-");
}

function formatSubmitted(value: string) {
  return value.slice(0, 10);
}

function formatProgramsCell(
  reg: Registration,
  programsById: Record<string, Pick<Program, "feeStructure"> | undefined>,
) {
  const lines = formatRegistrationProgramsSummary(reg, programsById);
  const programCount = lines.length;
  return [
    `${programCount} program${programCount !== 1 ? "s" : ""}`,
    ...lines,
  ].join("\n");
}

export async function exportWorkbookSheet({
  filename,
  headers,
  rows,
  columns,
}: WorkbookExportOptions) {
  const writeExcelFile = (await import("write-excel-file/browser")).default;
  const data: SheetData = [
    headers.map(value => ({
      value,
      fontWeight: "bold" as const,
      backgroundColor: "#2f3f50",
      textColor: "#ffffff",
      alignVertical: "center" as const,
      height: 24,
    })),
    ...rows,
  ];

  await writeExcelFile(data, {
    columns,
    stickyRowsCount: 1,
  }).toFile(`${safeFilename(filename)}.xlsx`);
}

export async function exportRegistrationPaymentsWorkbook(
  label: string,
  registrations: Registration[],
  programsById: Record<string, Pick<Program, "feeStructure"> | undefined> = {},
) {
  const rows: SheetData = [];

  for (const [index, reg] of registrations.entries()) {
    const programCell = formatProgramsCell(reg, programsById);
    const lineCount = programCell.split("\n").length;

    rows.push([
      {
        value: index + 1,
        align: "right" as const,
      },
      reg.id,
      reg.contactName,
      reg.contactPhone,
      reg.contactEmail,
      reg.eventName,
      {
        value: programCell,
        wrap: true,
        alignVertical: "top" as const,
        height: Math.max(34, lineCount * 17),
      },
      REG_STATUS_LABEL[reg.regStatus] ?? reg.regStatus,
      reg.payment ? (PAYMENT_STATUS_LABEL[reg.payment.paymentStatus] ?? reg.payment.paymentStatus) : "No payment",
      {
        value: totalFee(reg),
        format: "$#,##0.00",
        align: "right" as const,
      },
      formatSubmitted(reg.submittedAt),
    ]);
  }

  await exportWorkbookSheet({
    filename: `${label} - Registrations Payments`,
    headers: HEADERS,
    rows,
    columns: [
      { width: 6 },
      { width: 10 },
      { width: 24 },
      { width: 18 },
      { width: 30 },
      { width: 28 },
      { width: 48 },
      { width: 16 },
      { width: 22 },
      { width: 12 },
      { width: 14 },
    ],
  });
}
