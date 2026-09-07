/**
 * _base.ts - Shared API primitives.
 *
 * Every API module uses these types and helpers so the entire surface
 * is consistent.
 *
 *  AUTH STRATEGY
 *
 *  publicHeaders()  No Authorization header.
 *  Use for: public registration, checkout, payment result.
 *
 *  adminHeaders()  Includes Authorization: Bearer <token>.
 *  Use for: all /admin/* endpoints, refunds, status patches.
 *
 *  BASE URL
 *
 *  The frontend reads /config.json during boot. This lets the same portal
 *  build run in local, UAT, and production by changing only config.json.
 */

interface RuntimeConfig {
  apiBaseUrl?: string;
  mockDelayMs?: number;
}

function normalizeApiBase(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

function validateApiBase(value: string): void {
  if (!value) return;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("config.json apiBaseUrl must be an absolute URL.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("config.json apiBaseUrl must use http or https.");
  }
}

export let API_BASE: string = normalizeApiBase(import.meta.env.VITE_API_BASE_URL as string | undefined);
let mockDelayMs = Number(import.meta.env.VITE_MOCK_DELAY_MS ?? 60);

export async function loadRuntimeConfig(): Promise<void> {
  try {
    const res = await fetch("/config.json", { cache: "no-store" });
    if (!res.ok) {
      if (res.status === 404) return;
      throw new Error(`Unable to load config.json. HTTP ${res.status}`);
    }

    const config = await res.json() as RuntimeConfig;
    const apiBaseUrl = normalizeApiBase(config.apiBaseUrl);
    validateApiBase(apiBaseUrl);
    API_BASE = apiBaseUrl;

    if (typeof config.mockDelayMs === "number") {
      mockDelayMs = config.mockDelayMs;
    }
  } catch (error) {
    console.error("TRS runtime config failed to load.", error);
    throw error;
  }
}

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

//  Result envelope

export interface ApiError {
  code: string;
  message: string;
}

export type ApiResult<T> =
  | { data: T;    error: null }
  | { data: null; error: ApiError };

export function ok<T>(data: T): ApiResult<T>               { return { data, error: null }; }
export function err(code: string, message: string): ApiResult<never> { return { data: null, error: { code, message } }; }

//  Auth helpers

export function getToken(): string {
  return localStorage.getItem("trs_token") ?? "";
}

const PUBLIC_CLIENT_TOKEN_KEY = "trs_public_client_token";
let memoryPublicClientToken: string | null = null;

function createPublicClientToken(): string {
  const randomPart = globalThis.crypto?.randomUUID?.()
    ?? `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return `trs_client_${randomPart}`;
}

export function getPublicClientToken(): string {
  try {
    const existing = sessionStorage.getItem(PUBLIC_CLIENT_TOKEN_KEY);
    if (existing && existing.length >= 32 && existing.length <= 120) return existing;

    const token = memoryPublicClientToken ?? createPublicClientToken();
    memoryPublicClientToken = token;
    sessionStorage.setItem(PUBLIC_CLIENT_TOKEN_KEY, token);
    return token;
  } catch {
    memoryPublicClientToken ??= createPublicClientToken();
    return memoryPublicClientToken;
  }
}

export function publicHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-TRS-Client-Token": getPublicClientToken(),
  };
}

export function adminHeaders(): Record<string, string> {
  const token = getToken();
  const base: Record<string, string> = { "Content-Type": "application/json" };
  if (token) base["Authorization"] = `Bearer ${token}`;
  return base;
}

//  401 interceptor
//
// ALL API calls go through apiFetch() instead of raw fetch().
// If the backend returns 401 (expired/invalid token), we:
//  1. Clear the stored token and user
//  2. Redirect to login immediately
//
// This prevents the silent "broken session" where the user keeps
// clicking and getting empty results because their JWT expired.
//
// Public endpoints (login, checkout, payment result) never send a token
// so they can never get a 401 - the redirect only fires for admin calls.

export async function apiFetch(
  url: string,
  options: RequestInit,
): Promise<Response> {
  const res = await fetch(url, options);

  if (res.status === 401) {
  // Token expired or invalid - wipe session and redirect to login.
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

//  Backend error parser

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

//  Mock delay

export const delay = () => new Promise(r => setTimeout(r, mockDelayMs));

//  Pagination helpers

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
