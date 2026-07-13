import { API_BASE, apiFetch, err, ok, parseError, publicHeaders } from "./_base";
import type { ApiResult } from "./_base";

export interface LandingMessagePayload {
  name: string;
  contact: string;
  topic: string;
  message: string;
}

export async function apiSendLandingMessage(
  payload: LandingMessagePayload,
): Promise<ApiResult<{ message: string }>> {
  const res = await apiFetch(`${API_BASE}/api/contact/message`, {
    method: "POST",
    headers: publicHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const parsed = await parseError(res, "Message could not be sent.");
    return err(parsed.code, parsed.message);
  }

  return ok(await res.json());
}
