import { Router, type ErrorRequestHandler } from "express";
import type { Server as SocketIOServer } from "socket.io";
import { QueueService, QueueStoreError } from "../services/queue.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidSessionId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function createQueueRouter(queue: QueueService, io: SocketIOServer): Router {
  const router = Router();

  router.post("/join", async (req, res, next) => {
    const sessionId: unknown = req.body?.sessionId;
    if (!isValidSessionId(sessionId)) {
      res.status(400).json({ error: "sessionId must be a valid UUID" });
      return;
    }

    try {
      const ticketId = await queue.join(sessionId);
      await broadcastWaiting(queue, io);
      res.json({ ticketId });
    } catch (error) {
      next(error);
    }
  });

  router.post("/next", async (_req, res, next) => {
    try {
      const calledTicket = await queue.callNext();
      if (calledTicket) {
        io.emit("queue:current", { currentTicket: calledTicket.ticketId });
        await broadcastWaiting(queue, io);
      }
      res.json({ currentTicket: calledTicket?.ticketId ?? null });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/tickets/:sessionId", async (req, res, next) => {
    const { sessionId } = req.params;
    if (!isValidSessionId(sessionId)) {
      res.status(400).json({ error: "sessionId must be a valid UUID" });
      return;
    }

    try {
      const removed = await queue.cancel(sessionId);
      if (removed) {
        await broadcastWaiting(queue, io);
      }
      res.json({ removed });
    } catch (error) {
      next(error);
    }
  });

  router.get("/waiting", async (_req, res, next) => {
    try {
      const waitingTickets = await queue.getWaitingTickets();
      res.json({ waitingTickets });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

async function broadcastWaiting(queue: QueueService, io: SocketIOServer): Promise<void> {
  try {
    const waitingTickets = await queue.getWaitingTickets();
    io.emit("queue:waiting", { waitingTickets });
  } catch {
    // The queue mutation already succeeded; a snapshot read failure must not make
    // the mutation look unsuccessful to its caller.
    console.error("Could not read the waiting queue for a socket broadcast");
  }
}

export const queueErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof QueueStoreError) {
    res.status(503).json({ error: "Queue service unavailable" });
    return;
  }

  if (isJsonParseError(error)) {
    res.status(400).json({ error: "Request body must contain valid JSON" });
    return;
  }

  if (isBodyTooLargeError(error)) {
    res.status(413).json({ error: "Request body too large" });
    return;
  }

  console.error("Unhandled request error");
  res.status(500).json({ error: "Internal server error" });
};

function isJsonParseError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.parse.failed"
  );
}

function isBodyTooLargeError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.too.large"
  );
}
