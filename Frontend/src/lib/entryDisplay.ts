export interface EntryDisplayInput {
  teamMode?: boolean;
  label?: string;
  club?: string;
  participants?: string[];
  participantClubs?: string[];
}

export interface EntryDisplay {
  main: string;
  sub: string;
  detailLines: string[];
}

export type EntryDisplayMode = "compact" | "standard" | "detailed";

export function getEntryDisplay(entry: EntryDisplayInput, mode: EntryDisplayMode = "standard"): EntryDisplay {
  const participants = entry.participants ?? [];
  const participantClubs = entry.participantClubs ?? [];
  const label = entry.label ?? entry.club ?? "";
  const participantNames = participants.join(" / ");

  if (entry.teamMode) {
    return {
      main: label || participantNames,
      sub: "",
      detailLines: [],
    };
  }

  const participantClubLines = participants
    .map((name, index) => {
      const club = participantClubs[index]?.trim();
      return club ? `${name} - ${club}` : "";
    })
    .filter(Boolean);

  if (mode === "compact") {
    return {
      main: participantNames || label,
      sub: "",
      detailLines: [],
    };
  }

  if (mode === "detailed") {
    return {
      main: participantNames || label,
      sub: participantClubLines.length ? "" : label,
      detailLines: participantClubLines,
    };
  }

  const showPlayersAsMain = participants.length > 0 && participants.length <= 2;
  return {
    main: showPlayersAsMain ? participantNames : label,
    sub: showPlayersAsMain ? label : participantNames,
    detailLines: [],
  };
}
