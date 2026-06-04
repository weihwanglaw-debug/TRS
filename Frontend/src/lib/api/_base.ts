/**
 * _base.ts — Shared API primitives.
 *
 * Every API module uses these types and helpers so the entire surface
 * is consistent.
 *
 * ── AUTH STRATEGY ─────────────────────────────────────────────────────────────
 *
 *   publicHeaders()   No Authorization header.
 *                     Use for: public registration, checkout, payment result.
 *
 *   adminHeaders()    Includes Authorization: Bearer <token>.
 *                     Use for: all /admin/* endpoints, refunds, status patches.
 *
 * ── BASE URL ──────────────────────────────────────────────────────────────────
 *
 *   .env.development  →  VITE_API_BASE_URL=https://localhost:7183
 *   .env.production   →  VITE_API_BASE_URL=https://api.yourdomain.com
 */

export const API_BASE: string =
  (import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? "";

/**
 * Converts a relative upload path (e.g. /uploads/events/gallery/file.jpg)
 * into a full URL pointing at the backend (e.g. https://localhost:7183/uploads/...).
 * Absolute URLs (http/https/blob/data) are returned unchanged.
 */
export function assetUrl(path: string | null | undefined): string {
  if (!path) return "";
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  return `${API_BASE}${path}`;
}

// ── Result envelope ───────────────────────────────────────────────────────────

export interface ApiError {
  code: string;
  message: string;
}

export type ApiResult<T> =
  | { data: T;    error: null }
  | { data: null; error: ApiError };

export function ok<T>(data: T): ApiResult<T>               { return { data, error: null }; }
export function err(code: string, message: string): ApiResult<never> { return { data: null, error: { code, message } }; }

// ── Auth helpers ──────────────────────────────────────────────────────────────

export function getToken(): string {
  return localStorage.getItem("trs_token") ?? "";
}

export function publicHeaders(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

export function adminHeaders(): Record<string, string> {
  const token = getToken();
  const base: Record<string, string> = { "Content-Type": "application/json" };
  if (token) base["Authorization"] = `Bearer ${token}`;
  return base;
}

// ── 401 interceptor ───────────────────────────────────────────────────────────
//
// ALL API calls go through apiFetch() instead of raw fetch().
// If the backend returns 401 (expired/invalid token), we:
//   1. Clear the stored token and user
//   2. Redirect to login immediately
//
// This prevents the silent "broken session" where the user keeps
// clicking and getting empty results because their JWT expired.
//
// Public endpoints (login, checkout, payment result) never send a token
// so they can never get a 401 — the redirect only fires for admin calls.

export async function apiFetch(
  url: string,
  options: RequestInit,
): Promise<Response> {
  const res = await fetch(url, options);

  if (res.status === 401) {
    // Token expired or invalid — wipe session and redirect to login.
    // Skip if already on a login/public page to prevent redirect loops
    // (e.g. apiGetMe() during boot calls this and we're already on /login).
    localStorage.removeItem("trs_token");
    localStorage.removeItem("trs_user");
    const path = window.location.pathname;
    const isLoginPage = path === "/login" || path === "/";
    if (!isLoginPage) {
      window.location.replace("/login");
    }
    return res;
  }

  return res;
}

// ── Backend error parser ──────────────────────────────────────────────────────

export async function parseError(
  res: Response,
  fallback = "An unexpected error occurred.",
): Promise<ApiError> {
  try {
    const body = await res.json();
    const message = body?.message ?? body?.title ?? body?.detail ?? fallback;
    const code    = body?.code ?? `HTTP_${res.status}`;
    return { code, message };
  } catch {
    return { code: `HTTP_${res.status}`, message: res.statusText || fallback };
  }
}

// ── Mock delay ────────────────────────────────────────────────────────────────

const DELAY_MS = Number(import.meta.env?.VITE_MOCK_DELAY_MS ?? 60);
export const delay = () => new Promise(r => setTimeout(r, DELAY_MS));

// ── Pagination helpers ────────────────────────────────────────────────────────

export interface PageParams {
  page: number;
  pageSize: number;
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function paginate<T>(items: T[], { page, pageSize }: PageParams): PagedResult<T> {
  const total      = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage   = Math.min(Math.max(1, page), totalPages);
  const start      = (safePage - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total, page: safePage, pageSize, totalPages };
}