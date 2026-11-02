import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callNext, cancelTicket, joinQueue } from "./api";

const fakeFetch = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("queue REST client", () => {
  beforeEach(() => {
    fakeFetch.mockReset();
    vi.stubGlobal("fetch", fakeFetch);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("posts a session UUID and returns the server-assigned ticket", async () => {
    fakeFetch.mockResolvedValueOnce(jsonResponse({ ticketId: "A001" }));
    await expect(joinQueue("123e4567-e89b-42d3-a456-426614174000")).resolves.toEqual({ ticketId: "A001" });
    expect(fakeFetch).toHaveBeenCalledWith("http://localhost:3000/api/queue/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "123e4567-e89b-42d3-a456-426614174000" }),
    });
  });

  it("posts call-next without treating an empty result as a current-ticket update", async () => {
    fakeFetch.mockResolvedValueOnce(jsonResponse({ currentTicket: null }));
    await expect(callNext()).resolves.toEqual({ currentTicket: null });
    expect(fakeFetch).toHaveBeenCalledWith("http://localhost:3000/api/queue/next", { method: "POST" });
  });

  it("deletes by encoded session UUID and returns the removal result", async () => {
    fakeFetch.mockResolvedValueOnce(jsonResponse({ removed: false }));
    await expect(cancelTicket("123e4567-e89b-42d3-a456-426614174000")).resolves.toEqual({ removed: false });
    expect(fakeFetch).toHaveBeenCalledWith("http://localhost:3000/api/queue/tickets/123e4567-e89b-42d3-a456-426614174000", {
      method: "DELETE",
    });
  });

  it("surfaces the backend JSON error and status", async () => {
    fakeFetch.mockResolvedValueOnce(jsonResponse({ error: "Queue service unavailable" }, 503));
    await expect(callNext()).rejects.toMatchObject({
      name: "QueueApiError",
      message: "Queue service unavailable",
      status: 503,
    });
  });
});
