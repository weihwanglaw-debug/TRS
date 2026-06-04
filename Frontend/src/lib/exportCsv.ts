/**
 * exportCsv.ts — Client-side CSV export utilities
 *
 * Two exports:
 *   exportParticipantsCsv()   — fixture seeding list (SeedEntry[])
 *   exportRegistrationsCsv()  — full admin registrations export (Registration[])
 *
 * Both work entirely client-side. The data comes from the API layer;
 * no changes needed here when switching to a real backend.
 */

import type { SeedEntry } from "@/types/config";
import type { Registration } from "@/types/registration";

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csv(rows: string[][]): string {
  return rows.map(r =>
    r.map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")
  ).join("\r\n");
}

function safeFilename(s: string) {
  return s.replace(/[/\\?%*:|"<>]/g, "-");
}

// ── Fixture seeding list ───────────────────────────────────────────────────────

export function exportParticipantsCsv(
  eventName:   string,
  programName: string,
  participants: SeedEntry[],
  isBadminton:  boolean,
) {
  const headers = [
    "No.", "Club / School / Org", "Player(s)",
    ...(isBadminton ? ["SBA ID"] : []),
    "Seed",
  ];

  const rows = participants.map((p, i) => [
    String(i + 1),
    p.club,
    p.participants.join(" / "),
    ...(isBadminton ? [p.sbaId ?? ""] : []),
    p.seed != null ? String(p.seed) : "",
  ]);

  download(
    safeFilename(`${eventName} - ${programName} - Participants.csv`),
    csv([headers, ...rows]),
  );
}

// ── Full registrations export (admin) ─────────────────────────────────────────
// One row per participant (not per registration) for easy filtering in Excel.

export function exportRegistrationsCsv(
  eventName:    string,
  programName:  string,
  registrations: Registration[],
) {
  const headers = [
    "Reg ID",
    "Submitted",
    "Contact Name",
    "Contact Email",
    "Contact Phone",
    "Reg Status",
    "Program",
    "Group Status",
    "Participant",
    "DOB",
    "Gender",
    "Nationality",
    "Club / School / Company",
    "SBA ID",
    "T-Shirt Size",
    "Guardian Name",
    "Guardian Contact",
    "Remark",
    "Seed",
    "Payment Status",
    "Receipt No.",
    "Method",
    "Fee (SGD)",
  ];

  const rows: string[][] = [];

  for (const reg of registrations) {
    for (const group of reg.groups) {
      for (const p of group.participants) {
        rows.push([
          reg.id,
          reg.submittedAt.slice(0, 10),
          reg.contactName,
          reg.contactEmail,
          reg.contactPhone,
          reg.regStatus,
          group.programName,
          group.groupStatus,
          p.fullName,
          p.dob,
          p.gender,
          p.nationality,
          p.clubSchoolCompany,
          p.sbaId ?? "",
          p.tshirtSize ?? "",
          p.guardianName ?? "",
          p.guardianContact ?? "",
          p.remark ?? "",
          group.seed != null ? String(group.seed) : "",
          reg.payment.paymentStatus,
          reg.payment.receiptNo ?? "",
          reg.payment.method,
          group.fee.toFixed(2),
        ]);
      }
    }
  }

  const label = programName ? `${eventName} - ${programName}` : eventName;
  download(
    safeFilename(`${label} - Registrations.csv`),
    csv([headers, ...rows]),
  );
}
