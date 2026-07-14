export interface EntryDisplayInput {
  teamMode?: boolean;
  label?: string;
  club?: string;
  participants?: string[];
}

export interface EntryDisplay {
  main: string;
  sub: string;
}

export function getEntryDisplay(entry: EntryDisplayInput): EntryDisplay {
  const participants = entry.participants ?? [];
  const label = entry.label ?? entry.club ?? "";
  const participantNames = participants.join(" / ");

  if (entry.teamMode) {
    return {
      main: label || participantNames,
      sub: participantNames,
    };
  }

  const showPlayersAsMain = participants.length > 0 && participants.length <= 2;
  return {
    main: showPlayersAsMain ? participantNames : label,
    sub: showPlayersAsMain ? label : participantNames,
  };
}
