import { Link } from "react-router-dom";

export function HomePage() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" to="/">Queue demo</Link>
      </header>

      <section className="home-content">
        <h1>Queue Management</h1>
        <p>Choose a view to get started.</p>

        <nav className="role-list" aria-label="Choose a role">
          <Link className="role-link" to="/customer">
            <span>Customer</span>
            <span className="role-description">Take or cancel a ticket</span>
            <span aria-hidden="true">→</span>
          </Link>
          <Link className="role-link" to="/shop">
            <span>Shop</span>
            <span className="role-description">Call the next customer</span>
            <span aria-hidden="true">→</span>
          </Link>
        </nav>
      </section>
    </main>
  );
}
