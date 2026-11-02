import cors from "cors";
import express from "express";
import { createServer, type Server as HttpServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Server as SocketIOServer } from "socket.io";
import {
  createRedisClient,
  QueueService,
  type RedisConnection,
  type QueueService as QueueServiceType,
} from "./services/queue.js";
import { createQueueRouter, queueErrorHandler } from "./routes/queue.js";

export interface QueueServer {
  app: express.Express;
  httpServer: HttpServer;
  io: SocketIOServer;
  queue: QueueServiceType;
}

export function createQueueServer(
  redis: RedisConnection,
  frontendOrigin = "http://localhost:5173",
): QueueServer {
  const queue = new QueueService(redis);
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: frontendOrigin }));
  app.use(express.json({ limit: "16kb" }));

  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: { origin: frontendOrigin },
  });

  io.on("connection", (socket) => {
    void Promise.all([queue.getCurrentTicket(), queue.getWaitingTickets()])
      .then(([currentTicket, waitingTickets]) => {
        socket.emit("queue:current", { currentTicket });
        socket.emit("queue:waiting", { waitingTickets });
      })
      .catch(() => {
        console.error("Could not read queue snapshots for a socket client");
        socket.disconnect(true);
      });
  });

  app.use("/api/queue", createQueueRouter(queue, io));
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  app.use(queueErrorHandler);

  return { app, httpServer, io, queue };
}

async function start(): Promise<void> {
  const port = parsePort(process.env.PORT ?? "3000");
  const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
  const frontendOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
  const redis = createRedisClient(redisUrl);
  redis.on("error", () => {
    console.error("Redis client reported an error");
  });

  let queueServer: QueueServer | undefined;
  try {
    await redis.connect();
    const queue = new QueueService(redis);
    await queue.initialize();
    queueServer = createQueueServer(redis, frontendOrigin);

    await new Promise<void>((resolveListen, rejectListen) => {
      queueServer?.httpServer.once("error", rejectListen);
      queueServer?.httpServer.listen(port, "0.0.0.0", resolveListen);
    });
    console.log(`Queue backend listening on port ${port}`);
  } catch (error) {
    console.error("Queue backend failed to start");
    if (queueServer) {
      await closeHttpServer(queueServer);
    }
    if (redis.isOpen) {
      await redis.quit();
    }
    process.exitCode = 1;
    return;
  }

  let stopping = false;
  const shutdown = async () => {
    if (stopping || !queueServer) {
      return;
    }
    stopping = true;
    console.log("Stopping queue backend");
    await closeHttpServer(queueServer);
    if (redis.isOpen) {
      await redis.quit();
    }
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

async function closeHttpServer(queueServer: QueueServer): Promise<void> {
  await new Promise<void>((resolveClose) => {
    queueServer.io.close(() => resolveClose());
  });
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(resolve(entryPoint)).href) {
  void start();
}
