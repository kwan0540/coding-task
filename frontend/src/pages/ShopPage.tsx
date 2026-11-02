import { useState } from "react";
import { Link } from "react-router-dom";
import { NowServing } from "../components/NowServing";
import { StatusPill } from "../components/StatusPill";
import { callNext } from "../queue/api";
import { useQueue } from "../queue/QueueContext";

export function ShopPage() {
  const { connection, waitingTickets } = useQueue();
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const handleCallNext = async () => {
    if (calling) return;
    setCalling(true);
    setError("");
    setNotice("");
    try {
      const result = await callNext();
      setNotice(result.currentTicket ? `${result.currentTicket} called.` : "No one is waiting.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not call the next ticket.");
    } finally {
      setCalling(false);
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" to="/">Queue demo</Link>
        <StatusPill state={connection} />
      </header>

      <h1>Shop</h1>
      <section className="simple-card shop-panel" aria-label="Queue controls">
        <NowServing />
        <button className="button" onClick={handleCallNext} disabled={calling}>
          {calling ? "Calling…" : "Call next"}
        </button>
      </section>

      <section className="simple-card waiting-queue" aria-labelledby="waiting-queue-title">
        <h2 id="waiting-queue-title">Waiting Queue</h2>
        {waitingTickets === undefined ? (
          <p className="waiting-queue-state" role="status">Loading waiting queue…</p>
        ) : waitingTickets.length === 0 ? (
          <p className="waiting-queue-state">No tickets are waiting.</p>
        ) : (
          <ul className="waiting-ticket-list" aria-label="Waiting tickets">
            {waitingTickets.map((ticket) => <li key={ticket}>{ticket}</li>)}
          </ul>
        )}
      </section>

      {error && <p className="message error" role="alert">{error}</p>}
      {notice && <p className="message" role="status">{notice}</p>}
    </main>
  );
}
