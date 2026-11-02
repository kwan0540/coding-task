import type {
  CallNextResponse,
  CancelTicketResponse,
  JoinQueueResponse,
} from "./types";

const apiUrl = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/$/, "");

export class QueueApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "QueueApiError";
  }
}

export async function joinQueue(sessionId: string): Promise<JoinQueueResponse> {
  const value = await request<unknown>("/api/queue/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  if (!isRecord(value) || typeof value.ticketId !== "string") {
    throw new QueueApiError("The queue returned an invalid ticket response.");
  }
  return { ticketId: value.ticketId };
}

export async function callNext(): Promise<CallNextResponse> {
  const value = await request<unknown>("/api/queue/next", { method: "POST" });
  if (!isRecord(value) || !(typeof value.currentTicket === "string" || value.currentTicket === null)) {
    throw new QueueApiError("The queue returned an invalid call response.");
  }
  return { currentTicket: value.currentTicket };
}

export async function cancelTicket(sessionId: string): Promise<CancelTicketResponse> {
  const value = await request<unknown>(`/api/queue/tickets/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
  if (!isRecord(value) || typeof value.removed !== "boolean") {
    throw new QueueApiError("The queue returned an invalid cancellation response.");
  }
  return { removed: value.removed };
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, init);
  } catch {
    throw new QueueApiError("Could not reach the queue. Check your connection and try again.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new QueueApiError("The queue sent an unreadable response.", response.status);
  }

  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === "string"
      ? body.error
      : "The queue request could not be completed.";
    throw new QueueApiError(message, response.status);
  }
  return body as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
