import { API_BASE, apiFetch, err, getToken, ok, parseError } from "./_base";
import type { ApiResult } from "./_base";

type UploadResponse =
  | { url: string }
  | { path: string }
  | { location: string }
  | string;

function authHeader(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * POST /api/uploads
 * Multipart form-data:
 *   file: File
 *   folder: string (optional)
 *
 * Returns JSON with { url } (preferred) or { path }.
 */
export async function apiUploadFile(
  file: File,
  folder?: string,
): Promise<ApiResult<string>> {
  if (!file) return err("INVALID_FILE", "No file provided.");

  const form = new FormData();
  form.append("file", file);
  if (folder) form.append("folder", folder);

  const res = await apiFetch(`${API_BASE}/api/uploads`, {
    method: "POST",
    headers: authHeader(),
    body: form,
  });

  if (!res.ok) {
    const e = await parseError(res, "Failed to upload file.");
    return err(e.code, e.message);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const locationHeader = res.headers.get("location") ?? "";

  if (!contentType.includes("application/json")) {
    // Backend may return empty 201 with Location header.
    if (locationHeader) return ok(locationHeader);
    try {
      const text = (await res.text()).trim();
      if (text) return ok(text);
    } catch {
      // ignore
    }
    return err("UPLOAD_BAD_RESPONSE", "Upload succeeded but response was not a URL.");
  }

  const body = (await res.json()) as UploadResponse;
  if (typeof body === "string") return ok(body);
  if (typeof (body as any)?.url === "string") return ok((body as any).url);
  if (typeof (body as any)?.path === "string") return ok((body as any).path);
  if (typeof (body as any)?.location === "string") return ok((body as any).location);
  if (locationHeader) return ok(locationHeader);

  return err("UPLOAD_BAD_RESPONSE", "Upload succeeded but response was missing URL.");
}

