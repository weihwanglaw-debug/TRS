import type { SheetData } from "write-excel-file/browser";
import type {
  ItemStatus,
  ParticipantGroup,
  ParticipantStatus,
  Payment,
  PaymentItem,
  PaymentStatus,
  Refund,
  Registration,
} from "@/types/registration";
import {
  ITEM_STATUS_LABEL,
  PARTICIPANT_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  REG_STATUS_LABEL,
} from "@/types/registration";
import { exportWorkbookSheet } from "@/lib/exportRegistrationPaymentsWorkbook";

const HEADERS = [
  "No.",
  "Item No.",
  "Reg ID",
  "Payer Name",
  "Payer Contact",
  "Payer Email",
  "Event Name",
  "Program",
  "Fee Structure",
  "Participant / Entry",
  "Registration Status",
  "Payment Item Status",
  "Payment Method",
  "Admin Note",
  "Payment Transaction ID",
  "Receipt No.",
  "Paid Date",
  "Fee Amount",
  "Paid Amount",
  "Refunded Amount",
  "Net Amount",
  "Remark / Reason",
  "Refunded Date",
  "Refund Reference No.",
];

function formatDate(value?: string): string {
  if (!value) return "";
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return [
    pad(date.getDate()),
    pad(date.getMonth() + 1),
    date.getFullYear(),
  ].join("-") + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function groupStatusLabel(status?: string): string {
  if (status === "X") return "Cancelled";
  if (status === "C") return "Confirmed";
  if (status === "P") return "Pending";
  return status ?? "";
}

function participantStatusLabel(status?: ParticipantStatus): string {
  if (status === "A") return "Confirmed";
  return status ? PARTICIPANT_STATUS_LABEL[status] : "";
}

function itemStatusLabel(status: string): string {
  return ITEM_STATUS_LABEL[status as ItemStatus] ?? status;
}

function rowPaymentStatusLabel(paymentStatus: PaymentStatus, itemStatus: ItemStatus): string {
  if (itemStatus === "R") return "Refunded";
  if (itemStatus === "X") return "Cancelled";
  if (paymentStatus === "W" || paymentStatus === "PC" || paymentStatus === "P" || paymentStatus === "F") {
    return PAYMENT_STATUS_LABEL[paymentStatus];
  }
  return itemStatusLabel(itemStatus);
}

function describeItem(item: PaymentItem, groupsById: Map<string, ParticipantGroup>) {
  const group = groupsById.get(String(item.participantGroupId));
  const participant = group?.participants.find(p => String(p.id) === String(item.participantId));
  const isPerPlayer = !!item.participantId;
  const participantCount = group?.participants.length ?? 1;
  const teamOrClub = group?.clubDisplay?.trim();

  let entryLabel = item.playerName ?? participant?.fullName ?? group?.namesDisplay ?? item.description ?? item.programName;
  if (isPerPlayer && participantCount > 2 && teamOrClub) {
    entryLabel = `${teamOrClub} - ${item.playerName ?? participant?.fullName ?? "Participant"}`;
  } else if (!isPerPlayer && participantCount > 2) {
    entryLabel = `${teamOrClub || group?.namesDisplay || item.description || item.programName} (${participantCount} participants)`;
  }

  return {
    entryLabel,
    feeStructure: isPerPlayer ? "Per head" : "Per entry",
    registrationStatus: isPerPlayer
      ? participantStatusLabel(participant?.participantStatus)
      : groupStatusLabel(group?.groupStatus),
  };
}

function paymentTransactionId(payment: Payment): string {
  return payment.gatewayPaymentId ?? payment.gatewayChargeId ?? payment.gatewaySessionId ?? "";
}

function uniqueReasons(refunds: Refund[]): string {
  return Array.from(new Set(refunds.map(refund => refund.refundReason?.trim()).filter((reason): reason is string => !!reason))).join("; ");
}

function refundReference(refunds: Refund[]): string {
  return Array.from(new Set(
    refunds
      .map(refund => refund.gatewayRefundId?.trim() || refund.id)
      .filter(Boolean),
  )).join("\n");
}

function refundDate(refunds: Refund[]): string {
  const latest = [...refunds]
    .sort((a, b) => String(b.processedAt ?? b.createdAt).localeCompare(String(a.processedAt ?? a.createdAt)))
    [0];
  return formatDate(latest?.processedAt ?? latest?.createdAt);
}

function paidDate(payment: Payment): string {
  if (!["S", "PR", "FR"].includes(payment.paymentStatus)) return "";
  return formatDate(payment.paidAt ?? payment.createdAt);
}

function paidAmount(payment: Payment, item: PaymentItem): number {
  if (payment.paymentStatus === "S" || payment.paymentStatus === "PR" || payment.paymentStatus === "FR") {
    return item.amount;
  }
  return 0;
}

function moneyCell(value: number, bold = false) {
  return {
    value,
    type: Number,
    format: "#,##0.00",
    align: "right" as const,
    fontWeight: bold ? "bold" as const : undefined,
  };
}

function moneyFormulaCell(formula: string, bold = false) {
  return {
    value: formula,
    type: "Formula" as const,
    format: "#,##0.00",
    align: "right" as const,
    fontWeight: bold ? "bold" as const : undefined,
  };
}

function textCell(value: string, wrap = false, bold = false) {
  return {
    value,
    wrap,
    alignVertical: wrap ? "top" as const : "center" as const,
    fontWeight: bold ? "bold" as const : undefined,
  };
}

function borderedBlankCell() {
  return {
    value: "",
    topBorderStyle: "medium" as const,
    topBorderColor: "#000000",
  };
}

function totalFormulaCell(formula: string) {
  return {
    ...moneyFormulaCell(formula, true),
    topBorderStyle: "medium" as const,
    topBorderColor: "#000000",
  };
}

function reportTitleRows(filterSummary: string): SheetData {
  return [
    [{
      value: "Payment Summary Report",
      columnSpan: HEADERS.length,
      fontWeight: "bold" as const,
      fontSize: 14,
    }],
    [{
      value: filterSummary,
      columnSpan: HEADERS.length,
      wrap: true,
    }],
    [{
      value: `Generated: ${formatDate(new Date().toISOString())}`,
      columnSpan: HEADERS.length,
      textColor: "#666666",
    }],
  ];
}

export async function exportPaymentSummaryWorkbook(
  label: string,
  registrations: Registration[],
  refundsByRegistrationId: Record<string, Refund[]>,
  filterSummary = "Filters: All",
) {
  const rows: SheetData = [];
  let itemCounter = 1;
  const titleRows = reportTitleRows(filterSummary);
  const firstDataSheetRow = titleRows.length + 2;
  const subtotalRows: number[] = [];

  for (const reg of registrations) {
    const payment = reg.payment;
    if (!payment) continue;

    const groupsById = new Map(reg.groups.map(group => [String(group.id), group]));
    const refunds = refundsByRegistrationId[String(reg.id)] ?? [];
    const firstDetailRow = rows.length + firstDataSheetRow;
    let detailRows = 0;
    let itemNo = 1;

    for (const item of payment.items) {
      const itemRefunds = refunds.filter(refund => String(refund.paymentItemId) === String(item.id));
      const successfulRefunds = itemRefunds.filter(refund => refund.refundStatus === "S");
      const refundedAmount = successfulRefunds.reduce((sum, refund) => sum + refund.refundAmount, 0);
      const description = describeItem(item, groupsById);
      detailRows += 1;

      rows.push([
        { value: itemCounter++, align: "right" as const },
        { value: itemNo++, align: "right" as const },
        reg.id,
        reg.contactName,
        reg.contactPhone,
        reg.contactEmail,
        reg.eventName,
        item.programName,
        description.feeStructure,
        textCell(description.entryLabel, true),
        description.registrationStatus || (REG_STATUS_LABEL[reg.regStatus] ?? reg.regStatus),
        rowPaymentStatusLabel(payment.paymentStatus, item.itemStatus as ItemStatus),
        payment.method ? PAYMENT_METHOD_LABEL[payment.method] ?? payment.method : "",
        textCell(payment.adminNote ?? "", true),
        paymentTransactionId(payment),
        payment.receiptNo ?? "",
        paidDate(payment),
        moneyCell(item.amount),
        moneyCell(paidAmount(payment, item)),
        moneyCell(refundedAmount),
        "",
        textCell(uniqueReasons(itemRefunds), true),
        refundDate(successfulRefunds),
        textCell(refundReference(successfulRefunds), true),
      ]);
    }

    if (detailRows === 0) continue;

    const lastDetailRow = firstDetailRow + detailRows - 1;
    const subtotalSheetRow = rows.length + firstDataSheetRow;
    subtotalRows.push(subtotalSheetRow);
    const totalRow: SheetData[number] = Array(24).fill(null).map(() => borderedBlankCell());
    totalRow[20] = totalFormulaCell(`MAX(0,SUM(S${firstDetailRow}:S${lastDetailRow})-SUM(T${firstDetailRow}:T${lastDetailRow}))`);
    rows.push(totalRow);
  }

  const grandTotalRow = Array(24).fill(null).map(() => borderedBlankCell());
  const netSubtotalRefs = subtotalRows.map(row => `U${row}`).join(",");
  grandTotalRow[19] = {
    value: "Grand Total",
    fontWeight: "bold" as const,
    align: "right" as const,
    topBorderStyle: "medium" as const,
    topBorderColor: "#000000",
  };
  grandTotalRow[20] = totalFormulaCell(netSubtotalRefs ? `SUM(${netSubtotalRefs})` : "0");
  rows.push(grandTotalRow);

  await exportWorkbookSheet({
    filename: `${label} - Payment Summary`,
    headers: HEADERS,
    rows,
    preHeaderRows: titleRows,
    stickyRowsCount: titleRows.length + 1,
    columns: [
      { width: 6 },
      { width: 8 },
      { width: 10 },
      { width: 24 },
      { width: 18 },
      { width: 30 },
      { width: 28 },
      { width: 24 },
      { width: 14 },
      { width: 34 },
      { width: 20 },
      { width: 20 },
      { width: 18 },
      { width: 34 },
      { width: 30 },
      { width: 28 },
      { width: 22 },
      { width: 14 },
      { width: 16 },
      { width: 14 },
      { width: 14 },
      { width: 40 },
      { width: 22 },
      { width: 28 },
    ],
  });
}
