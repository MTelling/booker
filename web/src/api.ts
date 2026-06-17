import type { EventDetail, SlotData, VoteChoice } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error((data.error as string) || `Request failed (${res.status})`);
  }
  return data as T;
}

export interface CreateEventBody {
  name: string;
  allowProposals: boolean;
  createdBy: string;
  slots: number[];
}

export const api = {
  createEvent: (body: CreateEventBody) =>
    request<{ id: string; adminToken: string }>("/api/events", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getEvent: (id: string) => request<EventDetail>(`/api/events/${id}`),

  addSlot: (id: string, startsAt: number, createdBy: string, adminToken?: string) =>
    request<{ slot: SlotData }>(`/api/events/${id}/slots`, {
      method: "POST",
      headers: adminToken ? { "x-admin-token": adminToken } : {},
      body: JSON.stringify({ startsAt, createdBy }),
    }),

  deleteSlot: (id: string, slotId: string, name: string, adminToken?: string) =>
    request<{ ok: true }>(
      `/api/events/${id}/slots/${slotId}?name=${encodeURIComponent(name)}`,
      {
        method: "DELETE",
        headers: adminToken ? { "x-admin-token": adminToken } : {},
      },
    ),

  saveVotes: (id: string, voterName: string, votes: Record<string, VoteChoice>) =>
    request<{ ok: true }>(`/api/events/${id}/votes`, {
      method: "POST",
      body: JSON.stringify({ voterName, votes }),
    }),

  deleteEvent: (id: string, adminToken: string) =>
    request<{ ok: true }>(`/api/events/${id}`, {
      method: "DELETE",
      headers: { "x-admin-token": adminToken },
    }),
};
