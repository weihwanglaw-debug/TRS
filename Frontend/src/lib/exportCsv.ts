/**
 * exportCsv.ts - Client-side CSV export utilities
 *
 * Two exports:
 *  exportParticipantsCsv()  - fixture seeding list (SeedEntry[])
 *  exportRegistrationsCsv()  - full admin registrations export (Registration[])
 *
 * Both work entirely client-side. The data comes from the API layer;
 * no changes needed here when switching to a real backend.
 */

import type { MatchEntry, Program, SeedEntry } from "@/types/config";
import { getEntryDisplay } from "@/lib/entryDisplay";
import type { Registration } from "@/types/registration";
import { PAYMENT_STATUS_LABEL, REG_STATUS_LABEL, totalFee } from "@/types/registration";

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

//  Fixture seeding list

export function exportParticipantsCsv(
  eventName:   string,
  programName: string,
  participants: SeedEntry[],
  isBadminton:  boolean,
) {
  const headers = [
    "No.", "Club / Team / School", "Player(s)", "Participant Club(s)",
    ...(isBadminton ? ["SBA ID"] : []),
    "Seed",
  ];

  const rows = participants.map((p, i) => [
    String(i + 1),
    p.club,
    p.participants.join(" / "),
    p.teamMode ? p.club : (p.participantClubs ?? []).join(" / "),
    ...(isBadminton ? [p.sbaId ?? ""] : []),
    p.seed != null ? String(p.seed) : "",
  ]);

  download(
    safeFilename(`${eventName} - ${programName} - Participants.csv`),
    csv([headers, ...rows]),
  );
}

//  Full registrations export (admin)
// One row per participant (not per registration) for easy filtering in Excel.

export function exportRegistrationsCsv(
  eventName:    string,
  programName:  string,
  registrations: Registration[],
  programId?:    string,
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
      if (programId && group.programId !== programId) continue;
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
          reg.payment?.paymentStatus ?? "",
          reg.payment?.receiptNo ?? "",
          reg.payment?.method ?? "",
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

export function exportRegistrationPaymentsCsv(
  label: string,
  registrations: Registration[],
  programsById: Record<string, Pick<Program, "feeStructure"> | undefined> = {},
) {
  const headers = [
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

  const rows = registrations.map(reg => {
    const programs = formatRegistrationProgramsSummary(reg, programsById).join(" | ");

    return [
      reg.id,
      reg.contactName,
      reg.contactPhone,
      reg.contactEmail,
      reg.eventName,
      programs,
      REG_STATUS_LABEL[reg.regStatus] ?? reg.regStatus,
      reg.payment ? (PAYMENT_STATUS_LABEL[reg.payment.paymentStatus] ?? reg.payment.paymentStatus) : "No payment",
      totalFee(reg).toFixed(2),
      reg.submittedAt.slice(0, 10),
    ];
  });

  download(
    safeFilename(`${label} - Registrations Payments.csv`),
    csv([headers, ...rows]),
  );
}

export function formatRegistrationProgramsSummary(
  reg: Registration,
  programsById: Record<string, Pick<Program, "feeStructure"> | undefined> = {},
): string[] {
  const byProgram = new Map<string, {
    programId: string;
    programName: string;
    entries: number;
    participants: number;
  }>();

  for (const group of reg.groups) {
    const key = group.programId || group.programName;
    const current = byProgram.get(key);
    if (current) {
      current.entries += 1;
      current.participants += group.participants.length;
    } else {
      byProgram.set(key, {
        programId: group.programId,
        programName: group.programName,
        entries: 1,
        participants: group.participants.length,
      });
    }
  }

  return Array.from(byProgram.values()).map(program => {
    const feeStructure = programsById[program.programId]?.feeStructure;
    const count = feeStructure === "per_player" ? program.participants : program.entries;
    const unit = feeStructure === "per_player"
      ? "per head"
      : count === 1 ? "entry" : "entries";

    return `${program.programName} x ${count} ${unit}`;
  });
}

export function exportFixtureRoundCsv(
  eventName: string,
  programName: string,
  roundLabel: string,
  matches: MatchEntry[],
) {
  const headers = [
    "Round",
    "Team 1",
    "Team 1 Club / Team",
    "Team 1 Seed",
    "Team 2",
    "Team 2 Club / Team",
    "Team 2 Seed",
    "Result Score",
    "Winner",
    "Walkover",
    "Walkover Winner",
    "Court / Venue",
    "Date",
    "Actual Start Time",
    "Actual End Time",
    "Status",
    "Officials",
    "Remark",
  ];

  const teamName = (team: MatchEntry["team1"]) =>
    getEntryDisplay({
      teamMode: team.teamMode,
      label: team.label,
      participants: team.participants,
      participantClubs: team.participantClubs,
    }, "compact").main || team.label;
  const score = (match: MatchEntry) => match.walkover
    ? "W/O"
    : match.games
      .filter(g => g.p1 !== "" || g.p2 !== "")
      .map(g => `${g.p1}-${g.p2}`)
      .join(", ");
  const winner = (match: MatchEntry) => {
    if (match.winner === "team1") return teamName(match.team1);
    if (match.winner === "team2") return teamName(match.team2);
    if (match.walkoverWinner === "team1") return teamName(match.team1);
    if (match.walkoverWinner === "team2") return teamName(match.team2);
    return "";
  };
  const officials = (match: MatchEntry) =>
    match.officials.map(o => [o.role, o.name].filter(Boolean).join(": ")).filter(Boolean).join("; ");

  const rows = matches.map(match => [
    roundLabel,
    teamName(match.team1),
    match.team1.label,
    match.team1.seed != null ? String(match.team1.seed) : "",
    teamName(match.team2),
    match.team2.label,
    match.team2.seed != null ? String(match.team2.seed) : "",
    score(match),
    winner(match),
    match.walkover ? "Yes" : "No",
    match.walkoverWinner === "team1" ? teamName(match.team1)
      : match.walkoverWinner === "team2" ? teamName(match.team2)
      : "",
    match.courtNo,
    match.matchDate,
    match.startTime,
    match.endTime,
    match.status,
    officials(match),
    match.remark ?? "",
  ]);

  download(
    safeFilename(`${eventName} - ${programName} - ${roundLabel} - Fixture Table.csv`),
    csv([headers, ...rows]),
  );
}
