import { useState } from "react";
import { Link } from "react-router-dom";
import { NowServing } from "../components/NowServing";
import { StatusPill } from "../components/StatusPill";
import { cancelTicket, joinQueue } from "../queue/api";
import {
  clearCustomerSession,
  readCustomerSession,
  writeCustomerSession,
  type CustomerSession,
} from "../queue/customerSession";
import { useQueue } from "../queue/QueueContext";

export function CustomerPage() {
  const { currentTicket, connection } = useQueue();
  const [session, setSession] = useState<CustomerSession | null>(() => readCustomerSession());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const takeNumber = async () => {
    if (busy || session?.ticketId) return;
    setBusy(true);
    setError("");
    setNotice("");

    try {
      let activeSession = session;
      if (!activeSession) {
        activeSession = { sessionId: crypto.randomUUID() };
        writeCustomerSession(activeSession);
        setSession(activeSession);
      }
      const result = await joinQueue(activeSession.sessionId);
      const savedSession = { ...activeSession, ticketId: result.ticketId };
      writeCustomerSession(savedSession);
      setSession(savedSession);
      setNotice("Ticket added.");
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!session?.ticketId || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await cancelTicket(session.sessionId);
      clearCustomerSession();
      setSession(null);
      setNotice(result.removed ? "Ticket cancelled." : "This ticket is no longer waiting.");
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setBusy(false);
    }
  };

  const takingTurn = Boolean(session?.ticketId && currentTicket === session.ticketId);

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" to="/">Queue demo</Link>
        <StatusPill state={connection} />
      </header>

      <h1>Customer</h1>
      <section className="ticket-grid" aria-label="Queue ticket">
        <div className="simple-card customer-ticket">
          <h2>My Ticket</h2>
          <p className="ticket-display">{session?.ticketId ?? "—"}</p>
          {takingTurn && <p className="inline-notice">Your turn</p>}
          {!session?.ticketId && (
            <button className="button" onClick={takeNumber} disabled={busy}>
              {busy ? "Joining…" : session ? "Retry" : "Take a number"}
            </button>
          )}
          {session?.ticketId && (
            <button className="button button-secondary" onClick={cancel} disabled={busy}>
              {busy ? "Cancelling…" : "Cancel ticket"}
            </button>
          )}
        </div>
        <NowServing />
      </section>

      {error && <p className="message error" role="alert">{error}</p>}
      {notice && <p className="message" role="status">{notice}</p>}
    </main>
  );
}

function messageFor(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Something went wrong. Please try again.";
}
