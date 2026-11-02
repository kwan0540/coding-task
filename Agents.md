
# AGENTS.md — Real-Time Queue Management

## Goal and Scope
- Build a small, working full-stack queue-calling MVP for an interview assignment.
- Home page offers **Customer** and **Shop**; either role is available without login.
- One demo queue, one latest-called ticket, no multiple service counters.
- Customer takes a number, sees their number and the current number, and can cancel waiting.
- Shop sees the current number, the ordered waiting-ticket list, and can call the next customer.
- Prioritize a working end-to-end demo, tests, and simple setup over extra features.

## Architecture
- Frontend: React + TypeScript + Vite.
- Backend: Node.js + TypeScript + Express.
- Real-time updates: Socket.IO.
- Data store and source of truth: Redis; no other database or message broker.
- Atomic multi-command mutations: Redis Lua scripts.
- Docker Compose runs frontend, backend, and Redis; no separate workers.
- REST performs queue mutations and exposes a read-only waiting-list endpoint.
- Socket.IO delivers the latest called ticket and authoritative waiting-list snapshots.
- The server owns ticket allocation and queue order; never calculate them in React.

```text
Customer / Shop UI --HTTP--> Express routes --> Queue service --> Redis
Customer / Shop UI <-- Socket.IO queue:current, queue:waiting -- Socket.IO server
```

## Repository Structure
- `frontend/` — role selection, Customer/Shop views, API and socket clients.
- `backend/src/server.ts` — Express, Socket.IO, and startup wiring.
- `backend/src/routes/` — input validation and thin HTTP handlers.
- `backend/src/services/queue.ts` — queue operations, Redis access, and inline Lua scripts.
- `backend/tests/` — integration and concurrency tests using real Redis.
- `compose.yaml` — one-command startup.
- `README.md` — run instructions, architecture, demo, AI workflow, limitations.

## Redis Data Model
Use exactly these three queue keys for the single demo queue:
- `queue:{demo}:sequence` — STRING integer, last issued number (starts at 0).
- `queue:{demo}:waiting` — ZSET: member = session UUID, score = issued number.
- `queue:{demo}:current` — HASH: `sessionId` and `score` of latest called ticket.
- Display the numeric score as a ticket ID such as `A001` or `A002`.
- UUID identifies a customer's session; it is not the displayed ticket number.
- Never derive the next number from ZSET size or maximum waiting score.
- Do not add ticket-details, historical status, or waiting-count storage.

## Queue Operations
- **Join:** Client generates a UUID and submits it to the backend.
- In one Lua script, check `ZSCORE waiting sessionId`; if present, return that score.
- Also check whether `current.sessionId` matches; if so, return its score.
- Otherwise, run `INCR sequence`, then `ZADD waiting score sessionId` atomically.
- Join returns `{ ticketId: "A001" }`; use a new UUID for a new queue session.
- **Call Next:** In one Lua script, `ZPOPMIN waiting`, then update `current`.
- If waiting is empty, return `null` without modifying `current`.
- Each successful call replaces the previous current display; simultaneous calls may advance consecutive tickets.
- **Cancel:** `ZREM waiting sessionId`; do not change `sequence` or `current`.
- **List Waiting:** Read the waiting ZSET by ascending score and format scores as ticket IDs. Return ticket IDs only; never expose session UUIDs.
- Lua prevents command interleaving but does not automatically roll back earlier writes on errors.

## REST API
- `POST /api/queue/join` with `{ "sessionId": "<uuid>" }` → `{ "ticketId": "A001" }`.
- `POST /api/queue/next` → `{ "currentTicket": "A001" }` or `{ "currentTicket": null }`.
- `DELETE /api/queue/tickets/:sessionId` → `{ "removed": true | false }`.
- `GET /api/queue/waiting` → `{ "waitingTickets": ["A001", "A002"] }` in FIFO order; an empty queue returns an empty array.
- Validate session UUIDs; handle Redis failures with consistent JSON errors.
- Do not add REST GETs for current-ticket status or waiting count.
- All endpoints are public for this local demo; document the limitation.

## Socket.IO Contract
- Emit `queue:current` with `{ "currentTicket": "A001" | null }` and `queue:waiting` with `{ "waitingTickets": ["A001", "A002"] }`.
- On connection and reconnection, read `current` and the ordered waiting list from Redis and send snapshots to that client.
- Broadcast an updated waiting snapshot after joins, successful calls, and cancellations that remove a ticket. A successful Call Next also broadcasts `queue:current`.
- Empty Call Next and cancellations that remove nothing do not broadcast a changed waiting snapshot.
- Waiting snapshots contain ticket IDs only; never send session UUIDs, internal ZSET members, waiting counts as separate data, or personal positions.
- Clients must not reconstruct authoritative state by counting socket events.

## Frontend Behavior
- Landing page: **Customer** and **Shop** buttons; no authentication.
- Customer generates a session UUID and persists it and the assigned ticket ID in localStorage.
- Customer displays **My Ticket** and **Now Serving**; allow cancel while waiting.
- Repeated join attempts with the same UUID should not allocate another waiting ticket.
- Shop displays **Now Serving**, the FIFO **Waiting Queue**, and a **Call Next** button. Show loading and empty states for the waiting list.
- The shared socket context consumes `queue:current` and `queue:waiting`; Shop renders the waiting list while Customer renders only the current ticket. Show connection/loading/error states.
- On refresh/reconnect, show the locally saved customer ticket and restore current and waiting snapshots from Socket.IO.
- No position, waiting count, or reliable historical status after current changes.

## Tests and Delivery
- Verify 100 concurrent joins with distinct UUIDs produce unique sequential ticket numbers.
- Verify repeated joins with the same waiting UUID do not consume extra numbers.
- Verify concurrent Call Next operations never return the same waiting ticket.
- Verify empty Call Next leaves `current` untouched; cancel never reuses a number.
- Verify the waiting-list GET returns FIFO ticket IDs only, including empty, cancelled, and called-ticket cases.
- Verify current and waiting snapshots reach two browser windows on connection/reconnection and after queue changes.
- Verify Shop renders loading, empty, and ordered waiting-ticket states; malformed socket payloads are ignored.
- Test against real Redis, not only frontend mocks.
- `docker compose up --build` must start the working demo from a clean checkout.
- README must include setup, demo steps, architecture, AI tools, actual time, checks, and limitations.

## Agent Rules
- Keep scope minimal; do not add authentication, SQL, RabbitMQ, workers, or new Redis structures.
- Keep each Redis Lua script inline in `backend/src/services/queue.ts` beside its queue operation; do not create separate Lua files.
- Work incrementally: Redis scripts → REST/tests → Socket.IO → UI → Docker/README.
- Follow these contracts unless there is a concrete blocker; explain deviations.
- Execute available checks and report actual outcomes; never claim unverified success.
- Never expose secrets or modify unrelated files.
