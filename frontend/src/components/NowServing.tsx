import { useQueue } from "../queue/QueueContext";

export function NowServing() {
  const { currentTicket } = useQueue();
  const loading = currentTicket === undefined;
  return (
    <section className="simple-card serving-card" aria-labelledby="now-serving-title" aria-live="polite">
      <h2 id="now-serving-title">Now Serving</h2>
      {loading ? (
        <p className="ticket-display ticket-loading">…</p>
      ) : currentTicket ? (
        <p className="ticket-display">{currentTicket}</p>
      ) : (
        <p className="ticket-display ticket-empty">—</p>
      )}
    </section>
  );
}
