import type { Sheet, SheetData } from "write-excel-file/browser";
import type { Program, SbaRanking, TournamentEvent } from "@/types/config";
import type { ParticipantGroup, Registration, RegistrationParticipant } from "@/types/registration";
import { formatTournamentSoftwareCountry } from "@/lib/countries";

const HEADERS = ["No.", "Name", "Gender", "DOB", "Phone", "Club", "Member ID", "Country", "Email", "Seed", "Rank"];
const INVALID_SHEET_CHARS = /[\\/?*[\]:]/g;

type RankedProgram = Program & { sbaRankingType?: string | null };

function safeFilename(value: string) {
  return value.replace(/[/\\?%*:|"<>]/g, "-");
}

function safeSheetName(name: string, usedNames: Set<string>) {
  const base = (name.replace(INVALID_SHEET_CHARS, " ").trim() || "Program").slice(0, 31);
  let candidate = base;
  let index = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    const suffix = ` ${index++}`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function formatDob(value?: string | null) {
  if (!value) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return value;
}

function formatGender(value?: string | null) {
  const clean = value?.trim();
  if (!clean) return "";
  const lower = clean.toLowerCase();
  if (lower.startsWith("m")) return "M";
  if (lower.startsWith("f")) return "F";
  return clean;
}

function normalizeId(value?: string | null) {
  return value?.trim().toUpperCase() ?? "";
}

function rankingMatchesGroup(ranking: SbaRanking, participants: RegistrationParticipant[]) {
  const ids = participants.map((participant) => normalizeId(participant.sbaId)).filter(Boolean);
  if (!ids.length) return false;
  if (ids.length === 1) {
    return !ranking.player2 && normalizeId(ranking.player1.sbaId) === ids[0];
  }

  const groupIds = new Set(ids);
  const rankingIds = [normalizeId(ranking.player1.sbaId), normalizeId(ranking.player2?.sbaId)].filter(Boolean);
  return rankingIds.length === ids.length && rankingIds.every((id) => groupIds.has(id));
}

function findRank(program: RankedProgram, group: ParticipantGroup, rankings: SbaRanking[]) {
  if (!program.sbaRankingType) return "";
  const ranking = rankings.find((item) =>
    item.rankingType === program.sbaRankingType && rankingMatchesGroup(item, group.participants)
  );
  return ranking ? String(ranking.ranking) : "";
}

function firstFilled(...values: Array<string | null | undefined>) {
  return values.find((value) => value?.trim())?.trim() ?? "";
}

function buildProgramRows(
  program: RankedProgram,
  groups: ParticipantGroup[],
  registrationsById: Map<string, Registration>,
  rankings: SbaRanking[],
): SheetData {
  const rows: SheetData = [HEADERS.map((value) => ({ value, fontWeight: "bold" as const }))];

  groups.forEach((group, groupIndex) => {
    const registration = registrationsById.get(group.registrationId);
    const seed = group.seed != null ? String(group.seed) : "";
    const rank = findRank(program, group, rankings);

    group.participants.forEach((participant, participantIndex) => {
      const isFirstPlayer = participantIndex === 0;
      rows.push([
        isFirstPlayer ? groupIndex + 1 : null,
        participant.fullName,
        formatGender(participant.gender),
        formatDob(participant.dob),
        firstFilled(participant.contactNumber, registration?.contactPhone),
        participant.clubSchoolCompany || group.clubDisplay || "",
        participant.sbaId ?? "",
        formatTournamentSoftwareCountry(participant.nationality ?? ""),
        isFirstPlayer ? firstFilled(participant.email, registration?.contactEmail) : "",
        isFirstPlayer ? seed : "",
        isFirstPlayer ? rank : "",
      ]);
    });
  });

  return rows;
}

function getGroupsForProgram(programId: string, registrations: Registration[]) {
  return registrations
    .filter((registration) => registration.regStatus !== "Cancelled")
    .flatMap((registration) =>
      registration.groups.filter((group) =>
        group.programId === programId && group.groupStatus !== "Cancelled"
      )
    );
}

export async function exportTournamentSoftwareWorkbook(
  event: TournamentEvent,
  registrations: Registration[],
  rankings: SbaRanking[],
) {
  const writeExcelFile = (await import("write-excel-file/browser")).default;
  const registrationsById = new Map(registrations.map((registration) => [registration.id, registration]));
  const usedSheetNames = new Set<string>();
  const sheets: Sheet[] = event.programs.map((program) => ({
    sheet: safeSheetName(program.name, usedSheetNames),
    data: buildProgramRows(
      program,
      getGroupsForProgram(program.id, registrations),
      registrationsById,
      rankings,
    ),
    columns: [
      { width: 6 },
      { width: 28 },
      { width: 8 },
      { width: 12 },
      { width: 14 },
      { width: 30 },
      { width: 14 },
      { width: 24 },
      { width: 32 },
      { width: 8 },
      { width: 8 },
    ],
    stickyRowsCount: 1,
  }));

  await writeExcelFile(sheets).toFile(`${safeFilename(event.name)} - TournamentSoftware Import.xlsx`);
}
