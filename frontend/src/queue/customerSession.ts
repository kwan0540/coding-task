export const CUSTOMER_SESSION_KEY = "good-turn.customer-session.v1";

export interface CustomerSession {
  sessionId: string;
  ticketId?: string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ticketPattern = /^A[0-9]+$/;

export function readCustomerSession(): CustomerSession | null {
  try {
    const raw = window.localStorage.getItem(CUSTOMER_SESSION_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || typeof value.sessionId !== "string" || !uuidPattern.test(value.sessionId)) {
      return null;
    }
    if (value.ticketId !== undefined && (typeof value.ticketId !== "string" || !ticketPattern.test(value.ticketId))) {
      return null;
    }
    return {
      sessionId: value.sessionId,
      ...(typeof value.ticketId === "string" ? { ticketId: value.ticketId } : {}),
    };
  } catch {
    return null;
  }
}

export function writeCustomerSession(session: CustomerSession): void {
  try {
    window.localStorage.setItem(CUSTOMER_SESSION_KEY, JSON.stringify(session));
  } catch {
    throw new Error("This browser could not save your ticket session. Please enable local storage and try again.");
  }
}

export function clearCustomerSession(): void {
  try {
    window.localStorage.removeItem(CUSTOMER_SESSION_KEY);
  } catch {
    throw new Error("This browser could not clear your saved ticket session.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
