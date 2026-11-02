import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { io as createSocketClient, type Socket } from "socket.io-client";
import { createQueueServer, type QueueServer } from "../src/server.js";
import { QUEUE_KEYS, QueueService } from "../src/services/queue.js";

const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const redis = createClient({ url: redisUrl });
const sockets: Socket[] = [];
let queueService: QueueService;
let queueServer: QueueServer;
let baseUrl: string;

redis.on("error", () => {
  // The test failures below report Redis availability without exposing connection details.
});

before(async () => {
  await redis.connect();
  queueService = new QueueService(redis);
  await clearQueue();
  queueServer = createQueueServer(redis);

  await new Promise<void>((resolveListen, rejectListen) => {
    queueServer.httpServer.once("error", rejectListen);
    queueServer.httpServer.listen(0, "127.0.0.1", resolveListen);
  });

  const address = queueServer.httpServer.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  await clearQueue();
});

afterEach(() => {
  for (const socket of sockets.splice(0)) {
    socket.disconnect();
  }
});

after(async () => {
  for (const socket of sockets.splice(0)) {
    socket.disconnect();
  }
  if (queueServer) {
    await new Promise<void>((resolveClose) => queueServer.io.close(() => resolveClose()));
  }
  if (redis.isOpen) {
    await redis.quit();
  }
});

test("100 concurrent distinct joins receive unique sequential ticket IDs", async () => {
  const sessions = Array.from({ length: 100 }, () => randomUUID());
  const responses = await Promise.all(
    sessions.map((sessionId) => post("/api/queue/join", { sessionId })),
  );

  const ticketIds = await Promise.all(
    responses.map(async (response) => {
      assert.equal(response.status, 200);
      const body = (await response.json()) as { ticketId: string };
      return body.ticketId;
    }),
  );

  assert.equal(new Set(ticketIds).size, 100);
  assert.deepEqual(
    [...ticketIds].sort((left, right) => Number(left.slice(1)) - Number(right.slice(1))),
    Array.from({ length: 100 }, (_, index) => `A${String(index + 1).padStart(3, "0")}`),
  );
});

test("repeated joins for a waiting or currently called UUID keep its ticket", async () => {
  const sessionId = randomUUID();
  const firstJoin = await post("/api/queue/join", { sessionId });
  const duplicateJoin = await post("/api/queue/join", { sessionId });
  assert.deepEqual(await firstJoin.json(), { ticketId: "A001" });
  assert.deepEqual(await duplicateJoin.json(), { ticketId: "A001" });
  assert.equal(await redis.get(QUEUE_KEYS.sequence), "1");

  const called = await post("/api/queue/next");
  assert.deepEqual(await called.json(), { currentTicket: "A001" });
  const joinAfterCall = await post("/api/queue/join", { sessionId });
  assert.deepEqual(await joinAfterCall.json(), { ticketId: "A001" });
  assert.equal(await redis.get(QUEUE_KEYS.sequence), "1");
});

test("concurrent call-next requests return distinct waiting tickets", async () => {
  const sessions = Array.from({ length: 25 }, () => randomUUID());
  await Promise.all(sessions.map((sessionId) => post("/api/queue/join", { sessionId })));

  const responses = await Promise.all(
    sessions.map(() => post("/api/queue/next")),
  );
  const ticketIds = await Promise.all(
    responses.map(async (response) => {
      assert.equal(response.status, 200);
      const body = (await response.json()) as { currentTicket: string | null };
      assert.ok(body.currentTicket);
      return body.currentTicket;
    }),
  );

  assert.equal(new Set(ticketIds).size, sessions.length);
  assert.deepEqual(
    [...ticketIds].sort((left, right) => Number(left.slice(1)) - Number(right.slice(1))),
    Array.from({ length: sessions.length }, (_, index) => `A${String(index + 1).padStart(3, "0")}`),
  );
  assert.equal((await redis.hGetAll(QUEUE_KEYS.current)).score, "25");
});

test("empty call-next returns null and leaves the stored current ticket unchanged", async () => {
  await post("/api/queue/join", { sessionId: randomUUID() });
  const firstCall = await post("/api/queue/next");
  assert.deepEqual(await firstCall.json(), { currentTicket: "A001" });
  const currentBeforeEmptyCall = await redis.hGetAll(QUEUE_KEYS.current);

  const emptyCall = await post("/api/queue/next");
  assert.deepEqual(await emptyCall.json(), { currentTicket: null });
  assert.deepEqual(await redis.hGetAll(QUEUE_KEYS.current), currentBeforeEmptyCall);
});

test("cancellation removes a waiter without reusing the issued number", async () => {
  const cancelledId = randomUUID();
  const keptId = randomUUID();
  await post("/api/queue/join", { sessionId: cancelledId });
  await post("/api/queue/join", { sessionId: keptId });

  const cancel = await fetch(`${baseUrl}/api/queue/tickets/${cancelledId}`, { method: "DELETE" });
  assert.equal(cancel.status, 200);
  assert.deepEqual(await cancel.json(), { removed: true });

  const nextJoin = await post("/api/queue/join", { sessionId: randomUUID() });
  assert.deepEqual(await nextJoin.json(), { ticketId: "A003" });
});

test("GET waiting returns only FIFO ticket IDs and reflects cancellation and calls", async () => {
  const empty = await fetch(`${baseUrl}/api/queue/waiting`);
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { waitingTickets: [] });

  const firstSession = randomUUID();
  const secondSession = randomUUID();
  await post("/api/queue/join", { sessionId: firstSession });
  await post("/api/queue/join", { sessionId: secondSession });

  const ordered = await fetch(`${baseUrl}/api/queue/waiting`);
  const orderedBody = (await ordered.json()) as { waitingTickets: string[] };
  assert.deepEqual(orderedBody, { waitingTickets: ["A001", "A002"] });
  assert.equal(JSON.stringify(orderedBody).includes(firstSession), false);
  assert.equal(JSON.stringify(orderedBody).includes(secondSession), false);

  await fetch(`${baseUrl}/api/queue/tickets/${firstSession}`, { method: "DELETE" });
  const afterCancel = await fetch(`${baseUrl}/api/queue/waiting`);
  assert.deepEqual(await afterCancel.json(), { waitingTickets: ["A002"] });

  await post("/api/queue/next");
  const afterCall = await fetch(`${baseUrl}/api/queue/waiting`);
  assert.deepEqual(await afterCall.json(), { waitingTickets: [] });
});

test("invalid UUIDs and Redis failures return consistent JSON errors", async () => {
  const invalid = await post("/api/queue/join", { sessionId: "not-a-uuid" });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: "sessionId must be a valid UUID" });

  await redis.set(QUEUE_KEYS.sequence, "not-an-integer");
  const unavailable = await post("/api/queue/join", { sessionId: randomUUID() });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: "Queue service unavailable" });

  await redis.set(QUEUE_KEYS.waiting, "wrong-type");
  const waitingUnavailable = await fetch(`${baseUrl}/api/queue/waiting`);
  assert.equal(waitingUnavailable.status, 503);
  assert.deepEqual(await waitingUnavailable.json(), { error: "Queue service unavailable" });
});

test("Socket.IO broadcasts current to two clients and snapshots it after reconnect", async () => {
  const first = connectSocket();
  const second = connectSocket();

  const firstSnapshot = waitForQueueEvent(first);
  const secondSnapshot = waitForQueueEvent(second);
  first.connect();
  second.connect();
  assert.deepEqual(await firstSnapshot, { currentTicket: null });
  assert.deepEqual(await secondSnapshot, { currentTicket: null });

  await post("/api/queue/join", { sessionId: randomUUID() });
  const firstBroadcast = waitForQueueEvent(first);
  const secondBroadcast = waitForQueueEvent(second);
  const called = await post("/api/queue/next");
  assert.deepEqual(await called.json(), { currentTicket: "A001" });
  assert.deepEqual(await firstBroadcast, { currentTicket: "A001" });
  assert.deepEqual(await secondBroadcast, { currentTicket: "A001" });

  const noFirstUpdate = assertNoQueueEvent(first);
  const noSecondUpdate = assertNoQueueEvent(second);
  const emptyCall = await post("/api/queue/next");
  assert.deepEqual(await emptyCall.json(), { currentTicket: null });
  await Promise.all([noFirstUpdate, noSecondUpdate]);

  first.disconnect();
  const reconnectSnapshot = waitForQueueEvent(first);
  first.connect();
  assert.deepEqual(await reconnectSnapshot, { currentTicket: "A001" });
});

test("Socket.IO sends waiting snapshots on connect, queue changes, and reconnect", async () => {
  const first = connectSocket();
  const second = connectSocket();
  const firstSnapshot = waitForWaitingEvent(first);
  const secondSnapshot = waitForWaitingEvent(second);
  first.connect();
  second.connect();
  assert.deepEqual(await firstSnapshot, { waitingTickets: [] });
  assert.deepEqual(await secondSnapshot, { waitingTickets: [] });

  const firstJoinUpdate = waitForWaitingEvent(first);
  const secondJoinUpdate = waitForWaitingEvent(second);
  const firstSession = randomUUID();
  await post("/api/queue/join", { sessionId: firstSession });
  assert.deepEqual(await firstJoinUpdate, { waitingTickets: ["A001"] });
  assert.deepEqual(await secondJoinUpdate, { waitingTickets: ["A001"] });

  const firstSecondJoinUpdate = waitForWaitingEvent(first);
  const secondSecondJoinUpdate = waitForWaitingEvent(second);
  const secondSession = randomUUID();
  await post("/api/queue/join", { sessionId: secondSession });
  assert.deepEqual(await firstSecondJoinUpdate, { waitingTickets: ["A001", "A002"] });
  assert.deepEqual(await secondSecondJoinUpdate, { waitingTickets: ["A001", "A002"] });

  const firstCancelUpdate = waitForWaitingEvent(first);
  const secondCancelUpdate = waitForWaitingEvent(second);
  const cancellation = await fetch(`${baseUrl}/api/queue/tickets/${firstSession}`, { method: "DELETE" });
  assert.deepEqual(await cancellation.json(), { removed: true });
  assert.deepEqual(await firstCancelUpdate, { waitingTickets: ["A002"] });
  assert.deepEqual(await secondCancelUpdate, { waitingTickets: ["A002"] });

  const firstCallUpdate = waitForWaitingEvent(first);
  const secondCallUpdate = waitForWaitingEvent(second);
  const called = await post("/api/queue/next");
  assert.deepEqual(await called.json(), { currentTicket: "A002" });
  assert.deepEqual(await firstCallUpdate, { waitingTickets: [] });
  assert.deepEqual(await secondCallUpdate, { waitingTickets: [] });

  const noFirstWaitingUpdate = assertNoWaitingEvent(first);
  const noSecondWaitingUpdate = assertNoWaitingEvent(second);
  await post("/api/queue/next");
  const noOpCancel = await fetch(`${baseUrl}/api/queue/tickets/${firstSession}`, { method: "DELETE" });
  assert.deepEqual(await noOpCancel.json(), { removed: false });
  await Promise.all([noFirstWaitingUpdate, noSecondWaitingUpdate]);

  const firstRejoinUpdate = waitForWaitingEvent(first);
  const secondRejoinUpdate = waitForWaitingEvent(second);
  await post("/api/queue/join", { sessionId: randomUUID() });
  assert.deepEqual(await firstRejoinUpdate, { waitingTickets: ["A003"] });
  assert.deepEqual(await secondRejoinUpdate, { waitingTickets: ["A003"] });

  first.disconnect();
  const reconnectSnapshot = waitForWaitingEvent(first);
  first.connect();
  assert.deepEqual(await reconnectSnapshot, { waitingTickets: ["A003"] });
});

test("current ticket remains unavailable through a REST GET endpoint", async () => {
  const response = await fetch(`${baseUrl}/api/queue/current`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Not found" });
});

async function clearQueue(): Promise<void> {
  await redis.del(Object.values(QUEUE_KEYS));
  await queueService.initialize();
}

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function connectSocket(): Socket {
  const socket = createSocketClient(baseUrl, {
    autoConnect: false,
    reconnection: false,
    transports: ["websocket"],
  });
  sockets.push(socket);
  return socket;
}

function waitForQueueEvent(socket: Socket): Promise<{ currentTicket: string | null }> {
  return new Promise((resolveEvent, rejectEvent) => {
    const timeout = setTimeout(() => {
      socket.off("queue:current", onQueueEvent);
      rejectEvent(new Error("Timed out waiting for queue:current"));
    }, 3000);

    const onQueueEvent = (event: { currentTicket: string | null }) => {
      clearTimeout(timeout);
      resolveEvent(event);
    };
    socket.once("queue:current", onQueueEvent);
  });
}

function waitForWaitingEvent(socket: Socket): Promise<{ waitingTickets: string[] }> {
  return new Promise((resolveEvent, rejectEvent) => {
    const timeout = setTimeout(() => {
      socket.off("queue:waiting", onWaitingEvent);
      rejectEvent(new Error("Timed out waiting for queue:waiting"));
    }, 3000);

    const onWaitingEvent = (event: { waitingTickets: string[] }) => {
      clearTimeout(timeout);
      resolveEvent(event);
    };
    socket.once("queue:waiting", onWaitingEvent);
  });
}

function assertNoQueueEvent(socket: Socket): Promise<void> {
  return new Promise((resolveEvent, rejectEvent) => {
    const onQueueEvent = (event: unknown) => {
      clearTimeout(timeout);
      rejectEvent(new Error(`Unexpected queue:current event: ${JSON.stringify(event)}`));
    };
    const timeout = setTimeout(() => {
      socket.off("queue:current", onQueueEvent);
      resolveEvent();
    }, 150);
    socket.once("queue:current", onQueueEvent);
  });
}

function assertNoWaitingEvent(socket: Socket): Promise<void> {
  return new Promise((resolveEvent, rejectEvent) => {
    const onWaitingEvent = (event: unknown) => {
      clearTimeout(timeout);
      rejectEvent(new Error(`Unexpected queue:waiting event: ${JSON.stringify(event)}`));
    };
    const timeout = setTimeout(() => {
      socket.off("queue:waiting", onWaitingEvent);
      resolveEvent();
    }, 150);
    socket.once("queue:waiting", onWaitingEvent);
  });
}
