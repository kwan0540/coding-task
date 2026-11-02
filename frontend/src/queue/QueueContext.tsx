import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import type { ConnectionState, CurrentTicketEvent, WaitingTicketsEvent } from "./types";

const socketUrl = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || "http://localhost:3000";

export interface QueueContextValue {
  currentTicket: string | null | undefined;
  waitingTickets: string[] | undefined;
  connection: ConnectionState;
}

export const QueueContext = createContext<QueueContextValue | null>(null);

export function QueueProvider({ children }: { children: ReactNode }) {
  const [currentTicket, setCurrentTicket] = useState<string | null | undefined>(undefined);
  const [waitingTickets, setWaitingTickets] = useState<string[] | undefined>(undefined);
  const [connection, setConnection] = useState<ConnectionState>("connecting");

  useEffect(() => {
    const socket: Socket = io(socketUrl, { reconnection: true });
    const onConnect = () => setConnection("connected");
    const onDisconnect = (reason: string) => {
      setConnection(reason === "io server disconnect" ? "disconnected" : "reconnecting");
    };
    const onReconnectAttempt = () => setConnection("reconnecting");
    const onConnectError = () => setConnection("reconnecting");
    const onCurrent = (event: CurrentTicketEvent) => {
      if (event && (typeof event.currentTicket === "string" || event.currentTicket === null)) {
        setCurrentTicket(event.currentTicket);
      }
    };
    const onWaiting = (event: unknown) => {
      if (isWaitingTicketsEvent(event)) {
        setWaitingTickets(event.waitingTickets);
      }
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.io.on("reconnect_attempt", onReconnectAttempt);
    socket.on("queue:current", onCurrent);
    socket.on("queue:waiting", onWaiting);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.io.off("reconnect_attempt", onReconnectAttempt);
      socket.off("queue:current", onCurrent);
      socket.off("queue:waiting", onWaiting);
      socket.disconnect();
    };
  }, []);

  const value = useMemo(() => ({ currentTicket, waitingTickets, connection }), [currentTicket, waitingTickets, connection]);
  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}

export function useQueue(): QueueContextValue {
  const context = useContext(QueueContext);
  if (!context) throw new Error("useQueue must be used inside QueueProvider");
  return context;
}

function isWaitingTicketsEvent(value: unknown): value is WaitingTicketsEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "waitingTickets" in value &&
    Array.isArray(value.waitingTickets) &&
    value.waitingTickets.every((ticket) => typeof ticket === "string" && /^A\d{3,}$/.test(ticket))
  );
}
