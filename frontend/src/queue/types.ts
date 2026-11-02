export interface CurrentTicketEvent {
  currentTicket: string | null;
}

export interface WaitingTicketsEvent {
  waitingTickets: string[];
}

export interface JoinQueueResponse {
  ticketId: string;
}

export interface CallNextResponse {
  currentTicket: string | null;
}

export interface CancelTicketResponse {
  removed: boolean;
}

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";
