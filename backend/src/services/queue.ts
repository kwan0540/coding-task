import { createClient } from "redis";

export const QUEUE_KEYS = {
  sequence: "queue:{demo}:sequence",
  waiting: "queue:{demo}:waiting",
  current: "queue:{demo}:current",
} as const;

export type RedisConnection = ReturnType<typeof createClient>;

const JOIN_SCRIPT = `
local waitingScore = redis.call("ZSCORE", KEYS[2], ARGV[1])
if waitingScore then
  return tonumber(waitingScore)
end

local currentSessionId = redis.call("HGET", KEYS[3], "sessionId")
if currentSessionId == ARGV[1] then
  local currentScore = redis.call("HGET", KEYS[3], "score")
  if currentScore then
    return tonumber(currentScore)
  end
end

local score = redis.call("INCR", KEYS[1])
redis.call("ZADD", KEYS[2], score, ARGV[1])
return score
`;

const CALL_NEXT_SCRIPT = `
local currentType = redis.call("TYPE", KEYS[3]).ok
if currentType ~= "none" and currentType ~= "hash" then
  return redis.error_reply("queue current key must be a hash")
end

local ticket = redis.call("ZPOPMIN", KEYS[2])
if #ticket == 0 then
  return nil
end

local sessionId = ticket[1]
local score = ticket[2]
local updateResult = redis.pcall("HSET", KEYS[3], "sessionId", sessionId, "score", score)
if type(updateResult) == "table" and updateResult.err then
  local restoreResult = redis.pcall("ZADD", KEYS[2], score, sessionId)
  if type(restoreResult) == "table" and restoreResult.err then
    return redis.error_reply("could not update current ticket or restore waiting ticket")
  end
  return redis.error_reply(updateResult.err)
end

return { sessionId, score }
`;

const CANCEL_SCRIPT = `
return redis.call("ZREM", KEYS[1], ARGV[1])
`;

export class QueueStoreError extends Error {
  constructor(cause: unknown) {
    super("Queue store operation failed", { cause });
    this.name = "QueueStoreError";
  }
}

export interface CalledTicket {
  sessionId: string;
  ticketId: string;
}

function scoreFrom(value: unknown): number {
  const score = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(score) || score < 1) {
    throw new Error("Redis returned an invalid ticket score");
  }
  return score;
}

export function formatTicketId(score: number): string {
  return `A${score.toString().padStart(3, "0")}`;
}

export class QueueService {
  constructor(private readonly redis: RedisConnection) {}

  async initialize(): Promise<void> {
    try {
      await this.redis.set(QUEUE_KEYS.sequence, "0", { NX: true });
    } catch (error) {
      throw new QueueStoreError(error);
    }
  }

  async join(sessionId: string): Promise<string> {
    try {
      const result = await this.redis.eval(JOIN_SCRIPT, {
        keys: [QUEUE_KEYS.sequence, QUEUE_KEYS.waiting, QUEUE_KEYS.current],
        arguments: [sessionId],
      });
      return formatTicketId(scoreFrom(result));
    } catch (error) {
      throw new QueueStoreError(error);
    }
  }

  async callNext(): Promise<CalledTicket | null> {
    try {
      const result: unknown = await this.redis.eval(CALL_NEXT_SCRIPT, {
        keys: [QUEUE_KEYS.sequence, QUEUE_KEYS.waiting, QUEUE_KEYS.current],
        arguments: [],
      });

      if (result === null) {
        return null;
      }
      if (!Array.isArray(result) || result.length !== 2) {
        throw new Error("Redis returned an invalid call-next result");
      }

      const [sessionId, rawScore] = result;
      if (typeof sessionId !== "string") {
        throw new Error("Redis returned an invalid session identifier");
      }
      const score = scoreFrom(rawScore);
      return { sessionId, ticketId: formatTicketId(score) };
    } catch (error) {
      throw new QueueStoreError(error);
    }
  }

  async cancel(sessionId: string): Promise<boolean> {
    try {
      const result = await this.redis.eval(CANCEL_SCRIPT, {
        keys: [QUEUE_KEYS.waiting],
        arguments: [sessionId],
      });
      return Number(result) === 1;
    } catch (error) {
      throw new QueueStoreError(error);
    }
  }

  async getCurrentTicket(): Promise<string | null> {
    try {
      const current = await this.redis.hGetAll(QUEUE_KEYS.current);
      if (!current.score) {
        return null;
      }
      return formatTicketId(scoreFrom(current.score));
    } catch (error) {
      throw new QueueStoreError(error);
    }
  }

  async getWaitingTickets(): Promise<string[]> {
    try {
      const waiting = await this.redis.zRangeWithScores(QUEUE_KEYS.waiting, 0, -1);
      return waiting.map(({ score }) => formatTicketId(scoreFrom(score)));
    } catch (error) {
      throw new QueueStoreError(error);
    }
  }
}

export function createRedisClient(url: string): RedisConnection {
  return createClient({ url });
}
