/**
 * eventsApi.ts - Event & Program management.
 *
 * Real backend:
 *  GET  /events  list all events
 *  GET  /events/:id  single event with programs + documents
 *  POST  /events  create event
 *  PUT  /events/:id  update event details
 *  DELETE /events/:id  delete event (admin only)
 *  POST  /events/:id/programs  add program to event
 *  PUT  /events/:id/programs/:pid  update program
 *  DELETE /events/:id/programs/:pid  remove program
 *  GET  /events/:id/documents  list documents
 *  POST  /events/:id/documents  add document
 *  PUT  /events/:id/documents/:did  update document label/order
 *  DELETE /events/:id/documents/:did  remove document
 */

import { ok, err, delay, API_BASE, publicHeaders, adminHeaders, parseError, apiFetch } from "./_base";
import type { ApiResult } from "./_base";
import type { TournamentEvent, Program, EventDocument } from "@/types/config";

export interface ProgramImportIssue {
  row: number | null;
  field: string | null;
  message: string;
}

export interface ProgramImportPreviewEntry {
  entryNo: string;
  participantCount: number;
  names: string;
  fee: number;
}

export interface ProgramImportPreviewResponse {
  importToken: string;
  eventId: number;
  programId: number;
  eventName: string;
  programName: string;
  entries: ProgramImportPreviewEntry[];
  rowCount: number;
  entryCount: number;
  participantCount: number;
  totalAmount: number;
  valid: boolean;
  errors: ProgramImportIssue[];
  warnings: ProgramImportIssue[];
}

export interface ProgramImportConfirmRequest {
  importToken: string;
  paymentStatus: "S" | "W" | "PC";
  method?: string;
  paymentReference?: string;
  adminNote: string;
}

export interface ProgramImportConfirmResponse {
  registrationId: number;
  paymentId: number;
  entryCount: number;
  paymentStatus: string;
  participantCount: number;
}

function remapProgram<T extends { fields?: { customFields?: any[] } }>(p: T): T {
  if (!p.fields?.customFields) return p;
  return {
    ...p,
    fields: {
      ...p.fields,
      customFields: p.fields.customFields.map((cf: any, i: number) => ({
        label:      cf.label,
        fieldType:  cf.fieldType ?? cf.type ?? "text",
        isRequired: cf.isRequired ?? cf.required ?? false,
        options:    cf.options,
        sortOrder:  cf.sortOrder ?? i,
      })),
    },
  };
}

//  Event CRUD

export async function apiGetEvents(filters?: {
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  includeInactive?: boolean;
  publicArchive?: boolean;
}): Promise<ApiResult<TournamentEvent[]>> {
  await delay();
  const params = new URLSearchParams();
  if (filters?.status)          params.set("status",          filters.status);
  if (filters?.dateFrom)        params.set("dateFrom",        filters.dateFrom);
  if (filters?.dateTo)          params.set("dateTo",          filters.dateTo);
  if (filters?.includeInactive) params.set("includeInactive", "true");
  if (filters?.publicArchive)   params.set("publicArchive",   "true");
  const headers = filters?.includeInactive ? adminHeaders() : publicHeaders();
  const res = await apiFetch(`${API_BASE}/api/events?${params}`, { headers });
  if (!res.ok) return err("FETCH_FAILED", "Failed to load events.");
  return ok(await res.json());
}

export async function apiGetEvent(
  eventId: string,
  options?: { admin?: boolean },
): Promise<ApiResult<TournamentEvent>> {
  await delay();
  const res = await apiFetch(`${API_BASE}/api/events/${eventId}`, {
    headers: options?.admin ? adminHeaders() : publicHeaders(),
  });
  if (!res.ok) return err("NOT_FOUND", "Event not found.");
  return ok(await res.json());
}

export async function apiCreateEvent(
  payload: Omit<TournamentEvent, "id" | "programs" | "documents">,
): Promise<ApiResult<TournamentEvent>> {
  await delay();
  const res = await apiFetch(`${API_BASE}/api/events`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) return err("CREATE_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

export async function apiUpdateEvent(
  eventId: string,
  patch: Partial<Omit<TournamentEvent, "id" | "programs" | "documents">>,
): Promise<ApiResult<TournamentEvent>> {
  await delay();
  const res = await apiFetch(`${API_BASE}/api/events/${eventId}`, {
    method: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) return err("UPDATE_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

export async function apiUpdateEventRegistrationStatus(
  eventId: string,
  status: "O" | "PA" | "CL",
): Promise<ApiResult<TournamentEvent>> {
  await delay();
  const res = await apiFetch(`${API_BASE}/api/events/${eventId}/registration-status`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const parsed = await parseError(res);
    return err(parsed.code, parsed.message);
  }
  return ok(await res.json());
}

export async function apiDeleteEvent(eventId: string): Promise<ApiResult<null>> {
  await delay();
  const res = await apiFetch(`${API_BASE}/api/events/${eventId}`, {
    method: "DELETE",
    headers: adminHeaders(),
  });
  if (!res.ok) return err("DELETE_FAILED", (await parseError(res)).message);
  return ok(null);
}

//  Program sub-resource

export async function apiAddProgram(
  eventId: string,
  payload: Omit<Program, "id" | "currentParticipants" | "participantSeeds">,
): Promise<ApiResult<Program>> {
  await delay();
  const res = await apiFetch(`${API_BASE}/api/events/${eventId}/programs`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(remapProgram(payload)),
  });
  if (!res.ok) return err("CREATE_FAILED", "Failed to add program.");
  return ok(await res.json());
}

export async function apiUpdateProgram(
  eventId: string,
  programId: string,
  patch: Partial<Omit<Program, "id" | "currentParticipants">>,
): Promise<ApiResult<Program>> {
  await delay();
  const res = await apiFetch(`${API_BASE}/api/events/${eventId}/programs/${programId}`, {
    method: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify(remapProgram(patch as any)),
  });
  if (!res.ok) return err("UPDATE_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

export async function apiUpdateProgramStatus(
  eventId: string,
  programId: string,
  status: "O" | "CL",
): Promise<ApiResult<{ programId: number; status: string }>> {
  await delay();
  const res = await apiFetch(`${API_BASE}/api/events/${eventId}/programs/${programId}/status`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ status }),
  });
  if (!res.ok) return err("UPDATE_FAILED", "Failed to update program status.");
  return ok(await res.json());
}

export async function apiDeleteProgram(
  eventId: string,
  programId: string,
): Promise<ApiResult<null>> {
  await delay();
  const res = await apiFetch(`${API_BASE}/api/events/${eventId}/programs/${programId}`, {
    method: "DELETE",
    headers: adminHeaders(),
  });
  if (!res.ok) return err("DELETE_FAILED", (await parseError(res)).message);
  return ok(null);
}

export async function apiPreviewProgramImport(
  eventId: string,
  programId: string,
  file: File,
): Promise<ApiResult<ProgramImportPreviewResponse>> {
  await delay();
  const headers = adminHeaders();
  delete headers["Content-Type"];
  const form = new FormData();
  form.append("file", file);
  const res = await apiFetch(`${API_BASE}/api/events/${eventId}/programs/${programId}/import/preview`, {
    method: "POST",
    headers,
    body: form,
  });
  if (!res.ok) {
    const parsed = await parseError(res, "Failed to scan import template.");
    return err(parsed.code, parsed.message);
  }
  return ok(await res.json());
}

export async function apiConfirmProgramImport(
  eventId: string,
  programId: string,
  payload: ProgramImportConfirmRequest,
): Promise<ApiResult<ProgramImportConfirmResponse>> {
  await delay();
  const res = await apiFetch(`${API_BASE}/api/events/${eventId}/programs/${programId}/import/confirm`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const parsed = await parseError(res, "Failed to save imported registration.");
    return err(parsed.code, parsed.message);
  }
  return ok(await res.json());
}

//  Document sub-resource

export async function apiAddEventDocument(
  eventId: string,
  payload: { label: string; fileUrl: string; displayOrder?: number },
): Promise<ApiResult<EventDocument>> {
  await delay();
  const res = await apiFetch(`${API_BASE}/api/events/${eventId}/documents`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) return err("CREATE_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

export async function apiUpdateEventDocument(
  eventId: string,
  documentId: number,
  payload: { label: string; fileUrl: string; displayOrder?: number },
): Promise<ApiResult<EventDocument>> {
  await delay();
  const res = await apiFetch(`${API_BASE}/api/events/${eventId}/documents/${documentId}`, {
    method: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) return err("UPDATE_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

export async function apiDeleteEventDocument(
  eventId: string,
  documentId: number,
): Promise<ApiResult<null>> {
  await delay();
  const res = await apiFetch(`${API_BASE}/api/events/${eventId}/documents/${documentId}`, {
    method: "DELETE",
    headers: adminHeaders(),
  });
  if (!res.ok) return err("DELETE_FAILED", "Failed to delete document.");
  return ok(null);
}
