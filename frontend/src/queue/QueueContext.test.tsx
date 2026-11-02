import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueueProvider, useQueue } from "./QueueContext";

const socketHarness = vi.hoisted(() => {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const managerHandlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const add = (map: Map<string, Set<(...args: unknown[]) => void>>, event: string, callback: (...args: unknown[]) => void) => {
    const set = map.get(event) ?? new Set();
    set.add(callback);
    map.set(event, set);
  };
  const remove = (map: Map<string, Set<(...args: unknown[]) => void>>, event: string, callback: (...args: unknown[]) => void) => {
    map.get(event)?.delete(callback);
  };
  const socket = {
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) => add(handlers, event, callback)),
    off: vi.fn((event: string, callback: (...args: unknown[]) => void) => remove(handlers, event, callback)),
    disconnect: vi.fn(),
    io: {
      on: vi.fn((event: string, callback: (...args: unknown[]) => void) => add(managerHandlers, event, callback)),
      off: vi.fn((event: string, callback: (...args: unknown[]) => void) => remove(managerHandlers, event, callback)),
    },
  };
  return {
    socket,
    fire(event: string, ...args: unknown[]) { handlers.get(event)?.forEach((handler) => handler(...args)); },
    fireManager(event: string, ...args: unknown[]) { managerHandlers.get(event)?.forEach((handler) => handler(...args)); },
    clear() { handlers.clear(); managerHandlers.clear(); },
  };
});

vi.mock("socket.io-client", () => ({ io: vi.fn(() => socketHarness.socket) }));

function Probe() {
  const { currentTicket, waitingTickets, connection } = useQueue();
  const waiting = waitingTickets === undefined
    ? "waiting-loading"
    : waitingTickets.length === 0
      ? "waiting-empty"
      : waitingTickets.join(",");
  return <output>{`${connection}|${currentTicket === undefined ? "loading" : currentTicket ?? "none"}|${waiting}`}</output>;
}

describe("QueueProvider", () => {
  beforeEach(() => {
    socketHarness.clear();
    vi.clearAllMocks();
  });

  it("shows the connection state, socket snapshot, updates, and a reconnect snapshot", () => {
    render(<QueueProvider><Probe /></QueueProvider>);
    expect(screen.getByText("connecting|loading|waiting-loading")).toBeInTheDocument();

    act(() => {
      socketHarness.fire("connect");
      socketHarness.fire("queue:current", { currentTicket: null });
      socketHarness.fire("queue:waiting", { waitingTickets: [] });
    });
    expect(screen.getByText("connected|none|waiting-empty")).toBeInTheDocument();

    act(() => socketHarness.fire("queue:current", { currentTicket: "A001" }));
    expect(screen.getByText("connected|A001|waiting-empty")).toBeInTheDocument();

    act(() => socketHarness.fire("queue:waiting", { waitingTickets: ["A001", "A002"] }));
    expect(screen.getByText("connected|A001|A001,A002")).toBeInTheDocument();

    act(() => socketHarness.fire("queue:waiting", { waitingTickets: ["A001", "invalid"] }));
    expect(screen.getByText("connected|A001|A001,A002")).toBeInTheDocument();

    act(() => {
      socketHarness.fire("disconnect", "transport close");
      socketHarness.fireManager("reconnect_attempt");
    });
    expect(screen.getByText("reconnecting|A001|A001,A002")).toBeInTheDocument();

    act(() => {
      socketHarness.fire("connect");
      socketHarness.fire("queue:current", { currentTicket: "A002" });
      socketHarness.fire("queue:waiting", { waitingTickets: ["A003"] });
    });
    expect(screen.getByText("connected|A002|A003")).toBeInTheDocument();
  });

  it("disconnects its one socket and removes listeners on unmount", () => {
    const view = render(<QueueProvider><Probe /></QueueProvider>);
    view.unmount();
    expect(socketHarness.socket.disconnect).toHaveBeenCalledTimes(1);
  });
});
