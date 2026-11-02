import { BrowserRouter, Link, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { QueueProvider } from "./queue/QueueContext";
import { CustomerPage } from "./pages/CustomerPage";
import { HomePage } from "./pages/HomePage";
import { ShopPage } from "./pages/ShopPage";

function QueuePages() {
  return (
    <QueueProvider>
      <Outlet />
    </QueueProvider>
  );
}

function NotFoundPage() {
  return (
    <main className="app-shell">
      <header className="topbar"><Link className="brand" to="/">Queue demo</Link></header>
      <section className="simple-card not-found">
        <h1>Page not found</h1>
        <Link to="/">Back to home</Link>
      </section>
    </main>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route element={<QueuePages />}>
          <Route path="/customer" element={<CustomerPage />} />
          <Route path="/shop" element={<ShopPage />} />
        </Route>
        <Route path="/404" element={<NotFoundPage />} />
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
