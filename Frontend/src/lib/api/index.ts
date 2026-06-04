/**
 * index.ts — Single import point for all API modules.
 *
 * Usage:
 *   import { apiGetEvents, apiInitiateCheckout, apiGetRefunds } from "@/lib/api";
 *
 * Every function is a stub: mock data now, swap to fetch() later by
 * replacing only the function body — no caller edits needed.
 */

// Shared types & helpers
export type { ApiResult, ApiError, PageParams, PagedResult } from "./_base";
export { ok, err, assetUrl } from "./_base";

// Auth
export * from "./authApi";

// Admin users
export * from "./usersApi";

// System config
export * from "./configApi";

// Events & programs
export * from "./eventsApi";

// File uploads
export * from "./uploadsApi";

// Registrations, payments, refunds, checkout, stats
export * from "./registrationsApi";

// SBA rankings & member lookup
export * from "./sbaApi";

// Fixture API (pre-existing — re-exported for convenience)
export {
  apiGetFixture,
  apiGenerateDraw,
  apiResetFixture,
  apiSaveScore,
  apiUpdateSchedule,
  apiAdvanceToKnockout,
  apiAdvanceKnockoutRound,
  apiSwapTeams,
  apiSaveHeatResult,
  apiAdvanceHeatsRound,
  apiAssignHeatPlaces,
} from "@/lib/fixtureApi";

// Types from registration.ts (re-exported for convenience)
export type {
  RegStatus,
  PaymentStatus,
  ItemStatus,
  RefundStatus,
  PaymentMethod,
  PaymentGateway,
  RegistrationParticipant,
  ParticipantGroup,
  PaymentItem,
  Refund,
  Payment,
  Registration,
  CheckoutSession,
  RegistrationStats,
} from "@/types/registration";

export {
  PAYMENT_STATUS_LABEL,
  ITEM_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  groupsToSeedEntries,
  totalFee,
  totalRefunded,
  allParticipantNames,
  canRefundItem,
} from "@/types/registration";