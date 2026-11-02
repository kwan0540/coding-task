import type { ConnectionState } from "../queue/types";

const labels: Record<ConnectionState, string> = {
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  disconnected: "Offline",
};

export function StatusPill({ state }: { state: ConnectionState }) {
  return (
    <span className={`status-pill status-${state}`}>
      <span className="status-dot" aria-hidden="true" />
      {labels[state]}
    </span>
  );
}
