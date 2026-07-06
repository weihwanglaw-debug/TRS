// ── Custom field + program field config ──────────────────────────────────────

export interface CustomField {
  id?: string | number;
  customFieldId?: string | number;
  label: string;
  type: string;
  required: boolean;
  options?: string;
}

export interface ProgramFields {
  enableSbaId: boolean;
  enableDocumentUpload: boolean;
  enableGuardianInfo: boolean;
  enableRemark?: boolean;
  enableTshirt?: boolean;
  requireSbaId?: boolean;
  requireDocumentUpload?: boolean;
  requireGuardianInfo?: boolean;
  requireRemark?: boolean;
  requireTshirt?: boolean;
  customFields: CustomField[];
}

// ── Fixture types ─────────────────────────────────────────────────────────────

export type FixtureFormat =
  | "knockout"       // single elimination bracket
  | "group_knockout" // round-robin groups → top N advance to KO
  | "round_robin"    // everyone vs everyone, standings only
  | "heats";         // individual/non-vs: rounds of individual results → advancement → final

export type FixtureMode = "internal" | "external" | "not_required";

export type TiebreakCriteria =
  | "head_to_head"
  | "game_ratio"
  | "point_ratio"
  | "goal_difference"
  | "goals_scored";

// ── Round Robin standing points ───────────────────────────────────────────────

export interface StandingPoints {
  win:  number;   // default 2
  draw: number;   // default 1
  loss: number;   // default 0
}

// ── Heats format config ───────────────────────────────────────────────────────

export interface HeatsConfig {
  numRounds:      number;   // total rounds including final (min 2)
  advancePerRound: number;  // how many advance from each round (except final)
  resultLabel:    string;   // display label for result column e.g. "Time", "Score", "Distance"
  placesAwarded:  number;   // how many places to assign in final (1=winner only, 3=podium)
}

// Wizard-produced config — stored inside BracketState
export interface WizardConfig {
  format:          FixtureFormat;
  numSeeds:        number;
  // group_knockout
  numGroups?:      number;
  advancePerGroup?: number;
  // round_robin standing points
  standingPoints?: StandingPoints;
  // heats
  heatsConfig?:    HeatsConfig;
}

export type FixtureFormatConfig = WizardConfig;

// ── SBA ranking ───────────────────────────────────────────────────────────────

export interface SbaRanking {
  id: number;
  rankingType: string;
  player1: { sbaId: string; name: string; club: string; dob: string };
  player2: { sbaId: string; name: string; club: string; dob: string } | null;
  accumulatedScore: number;
  ranking: number;
  tournaments: number;
  yearOfBirth?: number | null;
  updatedAt?: string;
}

export interface SbaRankingType {
  value: string;
  label: string;
  players: number;
  gender: string;
  minAge: number;
  maxAge: number;
}

// ── BadmintonClub ───────────────────────────────────────────────────────────────────
export interface BadmintonClub {
  clubId:        number;
  name:          string;
  contactNumber: string | null;
  email:         string | null;
  address:       string | null;
  country:       string | null;
}

export type BadmintonClubInput = Omit<BadmintonClub, "clubId">;
 

// ── Program ───────────────────────────────────────────────────────────────────

export interface Program {
  id: string;
  name: string;
  type: string;
  sbaRankingType?: string | null;
  minAge: number;
  maxAge: number;
  gender: string;
  fee: number;
  paymentRequired: boolean;
  feeStructure: "per_entry" | "per_player"; // per_entry = flat fee for whole group; per_player = fee × each player
  minPlayers: number;
  maxPlayers: number;
  minParticipants: number;
  maxParticipants: number;
  currentParticipants: number;
  status: string;
  fields: ProgramFields;
  participantSeeds?: SeedEntry[];
}

// ── Event ─────────────────────────────────────────────────────────────────────

export interface EventDocument {
  id:           number;
  label:        string;
  fileUrl:      string;
  displayOrder: number;
}
 

export interface TournamentEvent {
  id:               string;
  name:             string;
  description:      string;
  venue:            string;
  venueAddress:     string;
  bannerUrl:        string;
  galleryUrls:      string[];
  additionalInfo:   string;    // sanitised HTML — replaces prospectusUrl
  documents:        EventDocument[];   // downloadable attachments
  eventStartDate:   string;
  eventEndDate:     string;
  openDate:         string;
  closeDate:        string;
  maxParticipants:  number;
  sponsorInfo:      string;
  consentStatement: string;
  isSports:         boolean;
  sportType:        string;
  fixtureMode:      FixtureMode;
  programs:         Program[];
}

// ── Users / config ────────────────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  email: string;
  password: string;
  role: "superadmin" | "eventadmin";
  name: string;
  lastLogin?: string;
  mustChangePassword?: boolean;
}

export interface ConfigEntry {
  key: string;
  label: string;
  value: string;
  group: string;
}

export interface Config {
  branding: { logoUrl: string; appName: string };
  hero: { title: string; subtitle: string };
  nav: { menuItems: { label: string; href: string }[] };
  footer: {
    socialLinks: { platform: string; url: string }[];
    contactEmail: string;
    copyrightText: string;
    extraLinks?: { label: string; href: string }[];
  };
  consentText: string;
  payment: { currency: string };
  events: TournamentEvent[];
  admin: { users: AdminUser[] };
}

export type EventStatus   = "open" | "upcoming" | "closed";
export type ProgramStatus = "open" | "upcoming" | "closed" | "full" | "nearly_full";

// ── Match / bracket types ─────────────────────────────────────────────────────

export interface GameScore {
  p1: string;
  p2: string;
}

export interface Official {
  id: string;
  role: string;
  name: string;
}

export interface TeamEntry {
  id: string;
  label: string;
  participants: string[];
  seed?: number;
}

export type MatchStatus = "Scheduled" | "In Progress" | "Completed" | "Walkover";
export type MatchPhase  = "group" | "knockout";

export interface MatchEntry {
  id: string;
  phase: MatchPhase;
  round: number;
  roundLabel: string;
  groupId?: string;
  team1: TeamEntry;
  team2: TeamEntry;
  games: GameScore[];
  winner: "team1" | "team2" | null;
  walkover: boolean;
  walkoverWinner: "team1" | "team2" | "";
  remark?: string;
  matchDate: string;
  startTime: string;
  endTime: string;
  courtNo: string;
  officials: Official[];
  status: MatchStatus;
  expanded: boolean;
}

export interface SeedEntry {
  id: string;
  club: string;
  participants: string[];
  seed: number | null;
  sbaId?: string;
  sbaIds?: string[];
  registrationId?: string;
  groupId?: string;
}

export interface GroupStanding {
  team: TeamEntry;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  gamesFor: number;
  gamesAgainst: number;
  pointsFor: number;
  pointsAgainst: number;
  points: number;
  rank: number;
}

export interface GroupEntry {
  id: string;
  name: string;
  teams: TeamEntry[];
  matches: MatchEntry[];
}

// ── Heats bracket types ───────────────────────────────────────────────────────

export interface HeatParticipantResult {
  teamId:   string;
  result:   string;   // free text: "12.4s", "847", "222,223,225"
  advanced: boolean;  // did they advance to next round?
  place?:   number;   // final round: 1st, 2nd, 3rd...
}

export interface HeatRound {
  id:           string;
  roundNumber:  number;
  label:        string;      // "Heat 1", "Semi-Final", "Final"
  isFinal:      boolean;
  results:      HeatParticipantResult[];
  isComplete:   boolean;
}

// ── BracketState ─────────────────────────────────────────────────────────────

export interface BracketState {
  format: FixtureFormat;
  config: FixtureFormatConfig;
  locked: boolean;
  phase:  "group" | "knockout";
  groups: GroupEntry[];
  matches: MatchEntry[];
  seeds:  SeedEntry[];
  // heats format only
  heatRounds?: HeatRound[];
}

// ── Registration / participant types ─────────────────────────────────────────

export interface Participant {
  id: string;
  fullName: string;
  dobDay: string;
  dobMonth: string;
  dobYear: string;
  gender: string;
  email: string;
  contactNumber: string;
  nationality: string;
  clubSchoolCompany: string;
  tshirtSize: string;
  sbaId?: string;
  guardianName?: string;
  guardianContact?: string;
  documentFile?: File | null;
  remark?: string;
  customFieldValues: Record<string, string>;
}

export interface CartEntry {
  programId: string;
  programName: string;
  fee: number;               // total fee for this entry (feePerPlayer × players OR flat fee)
  feeStructure: "per_entry" | "per_player";
  feePerPlayer?: number;     // only set when feeStructure = "per_player"
  participants: Participant[];
}

// ── Payment types ─────────────────────────────────────────────────────────────
// Single source of truth lives in registration.ts.
// Import from there — do not duplicate here.
//
//   import type { PaymentStatus, ItemStatus, RefundStatus,
//                 PaymentMethod, PaymentGateway,
//                 Payment, PaymentItem, Refund,
//                 PAYMENT_STATUS_LABEL } from "@/types/registration";
//
// PaymentRecord (legacy flat shape) has been removed.
// Use Registration → Payment → PaymentItem[] from registration.ts instead.
