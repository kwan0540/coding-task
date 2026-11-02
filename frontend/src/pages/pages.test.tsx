import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerPage } from "./CustomerPage";
import { HomePage } from "./HomePage";
import { ShopPage } from "./ShopPage";
import { QueueContext, type QueueContextValue } from "../queue/QueueContext";
import { CUSTOMER_SESSION_KEY } from "../queue/customerSession";
import * as queueApi from "../queue/api";

vi.mock("../queue/api", () => ({
  joinQueue: vi.fn(),
  callNext: vi.fn(),
  cancelTicket: vi.fn(),
}));

const joinQueue = vi.mocked(queueApi.joinQueue);
const callNext = vi.mocked(queueApi.callNext);
const cancelTicket = vi.mocked(queueApi.cancelTicket);
const demoSessionId = "123e4567-e89b-42d3-a456-426614174000";

function renderRoute(path: string, page: ReactNode, queue: QueueContextValue = {
  currentTicket: null,
  waitingTickets: undefined,
  connection: "connected",
}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueueContext.Provider value={queue}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/customer" element={page} />
          <Route path="/shop" element={page} />
        </Routes>
      </QueueContext.Provider>
    </MemoryRouter>,
  );
}

describe("role navigation", () => {
  it("offers direct Customer and Shop paths from the landing page", () => {
    renderRoute("/", <HomePage />);
    expect(screen.getByRole("link", { name: /^Customer/i })).toHaveAttribute("href", "/customer");
    expect(screen.getByRole("link", { name: /^Shop/i })).toHaveAttribute("href", "/shop");
  });
});

describe("customer ticket flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("restores a locally saved ticket without creating another join", () => {
    window.localStorage.setItem(CUSTOMER_SESSION_KEY, JSON.stringify({ sessionId: demoSessionId, ticketId: "A021" }));
    renderRoute("/customer", <CustomerPage />);
    expect(screen.getByText("A021")).toBeInTheDocument();
    expect(joinQueue).not.toHaveBeenCalled();
  });

  it("saves the UUID before joining and reuses it after a failed request", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(demoSessionId);
    joinQueue.mockRejectedValueOnce(new Error("Queue service unavailable"));
    joinQueue.mockResolvedValueOnce({ ticketId: "A001" });
    renderRoute("/customer", <CustomerPage />);

    fireEvent.click(screen.getByRole("button", { name: "Take a number" }));
    await screen.findByRole("alert");
    expect(JSON.parse(window.localStorage.getItem(CUSTOMER_SESSION_KEY) ?? "{}")).toEqual({ sessionId: demoSessionId });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("A001")).toBeInTheDocument();
    expect(joinQueue.mock.calls.map(([sessionId]) => sessionId)).toEqual([demoSessionId, demoSessionId]);
    expect(JSON.parse(window.localStorage.getItem(CUSTOMER_SESSION_KEY) ?? "{}")).toEqual({ sessionId: demoSessionId, ticketId: "A001" });
  });

  it.each([
    { removed: true, message: "Ticket cancelled." },
    { removed: false, message: "This ticket is no longer waiting." },
  ])("clears the saved ticket when cancellation returns removed=$removed", async ({ removed, message }) => {
    window.localStorage.setItem(CUSTOMER_SESSION_KEY, JSON.stringify({ sessionId: demoSessionId, ticketId: "A001" }));
    cancelTicket.mockResolvedValueOnce({ removed });
    renderRoute("/customer", <CustomerPage />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel ticket" }));
    expect(await screen.findByText(message, { exact: true })).toBeInTheDocument();
    await waitFor(() => expect(window.localStorage.getItem(CUSTOMER_SESSION_KEY)).toBeNull());
    expect(cancelTicket).toHaveBeenCalledWith(demoSessionId);
  });

  it("marks the customer ticket as being served when the socket snapshot matches", () => {
    window.localStorage.setItem(CUSTOMER_SESSION_KEY, JSON.stringify({ sessionId: demoSessionId, ticketId: "A001" }));
    renderRoute("/customer", <CustomerPage />, { currentTicket: "A001", waitingTickets: undefined, connection: "connected" });
    expect(document.querySelector(".inline-notice")).toHaveTextContent("Your turn");
    expect(screen.queryByRole("heading", { name: "Waiting Queue" })).not.toBeInTheDocument();
  });
});

describe("shop flow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the socket-owned current ticket when Call Next reports an empty queue", async () => {
    callNext.mockResolvedValueOnce({ currentTicket: null });
    renderRoute("/shop", <ShopPage />, { currentTicket: "A006", waitingTickets: [], connection: "connected" });
    expect(screen.getByText("A006")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Call next" }));
    expect(await screen.findByText("No one is waiting.", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("A006")).toBeInTheDocument();
  });

  it("prevents duplicate Call Next submissions while one is pending", async () => {
    let finish!: (value: { currentTicket: string | null }) => void;
    callNext.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    renderRoute("/shop", <ShopPage />, { currentTicket: null, waitingTickets: [], connection: "connected" });

    const button = screen.getByRole("button", { name: "Call next" });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    finish({ currentTicket: "A001" });
    await waitFor(() => expect(button).toBeEnabled());
    expect(callNext).toHaveBeenCalledTimes(1);
  });

  it("renders loading, empty, and FIFO waiting ticket states", () => {
    const loading = renderRoute("/shop", <ShopPage />, {
      currentTicket: null,
      waitingTickets: undefined,
      connection: "connected",
    });
    expect(screen.getByText("Loading waiting queue…")).toBeInTheDocument();
    loading.unmount();

    const empty = renderRoute("/shop", <ShopPage />, {
      currentTicket: null,
      waitingTickets: [],
      connection: "connected",
    });
    expect(screen.getByText("No tickets are waiting.")).toBeInTheDocument();
    empty.unmount();

    renderRoute("/shop", <ShopPage />, {
      currentTicket: null,
      waitingTickets: ["A002", "A003"],
      connection: "connected",
    });
    const tickets = screen.getByRole("list", { name: "Waiting tickets" });
    expect([...tickets.querySelectorAll("li")].map((ticket) => ticket.textContent)).toEqual(["A002", "A003"]);
  });
});
