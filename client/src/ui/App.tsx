import { useEffect, useState } from "react";
import { fetchCurrentUser, logout, type CurrentUser } from "../api/auth";
import { isHealthResponse } from "../api/health";
import { LoginForm } from "./LoginForm";

type ApiStatus = "checking" | "available" | "unavailable";

export function App() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
    // 1. Check API health
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Health request failed.");
        const payload: unknown = await response.json();
        if (!isHealthResponse(payload)) throw new Error("Unexpected health response.");
        setApiStatus("available");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setApiStatus("unavailable");
      });

    // 2. Query current user session (/api/auth/me)
    fetchCurrentUser()
      .then((user) => {
        setCurrentUser(user);
      })
      .finally(() => {
        setIsLoadingAuth(false);
      });

    return () => controller.abort();
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      setCurrentUser(null);
    }
  };

  const statusText = {
    checking: "Checking API connection…",
    available: "API is available",
    unavailable: "API is unavailable",
  }[apiStatus];

  return (
    <main className="page-shell">
      <header className="topbar">
        <div className="brand-section">
          <span className="brand-mark" aria-hidden="true">ER</span>
          <span>Event Registration</span>
        </div>

        {currentUser && (
          <div className="user-section">
            <span className="user-badge">
              <span>{currentUser.displayName}</span>
              <span className="role-pill">{currentUser.role}</span>
            </span>
            <button
              type="button"
              className="btn-logout"
              onClick={handleLogout}
              aria-label="Sign out of your account"
            >
              Sign Out
            </button>
          </div>
        )}
      </header>

      <div className="content-container">
        {isLoadingAuth ? (
          <div className="loading-indicator" role="status" aria-live="polite">
            Loading session…
          </div>
        ) : !currentUser ? (
          <LoginForm onLoginSuccess={(user) => setCurrentUser(user)} />
        ) : currentUser.role === "ORGANIZER" ? (
          <section className="dashboard-card" aria-labelledby="organizer-heading">
            <p className="eyebrow">Organizer Workspace</p>
            <h1 id="organizer-heading">Welcome, {currentUser.displayName}</h1>
            <p className="intro">
              You are signed in as an <strong>Organizer</strong>. In the next sprint tasks, you can publish events and monitor registrations.
            </p>
            <div className={`api-status api-status--${apiStatus}`} role="status" aria-live="polite">
              <span className="status-dot" aria-hidden="true" />
              {statusText}
            </div>
          </section>
        ) : (
          <section className="dashboard-card" aria-labelledby="participant-heading">
            <p className="eyebrow">Participant Workspace</p>
            <h1 id="participant-heading">Welcome, {currentUser.displayName}</h1>
            <p className="intro">
              You are signed in as a <strong>Participant</strong>. In the next sprint tasks, you can discover published workshops and manage your registrations.
            </p>
            <div className={`api-status api-status--${apiStatus}`} role="status" aria-live="polite">
              <span className="status-dot" aria-hidden="true" />
              {statusText}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
