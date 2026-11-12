import { useEffect, useState } from "react";
import { fetchCurrentUser, logout, type CurrentUser } from "../api/auth";
import { isHealthResponse } from "../api/health";
import { LoginForm } from "./LoginForm";
import { EventWorkspace } from "./EventWorkspace";

type ApiStatus = "checking" | "available" | "unavailable";

export function App() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [pathname, setPathname] = useState(window.location.pathname);

  const navigate = (path: string) => {
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
    setPathname(path);
  };

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
        if (!user) navigate("/login");
        else navigate(user.role === "ORGANIZER" ? "/organizer/events" : "/events");
      })
      .finally(() => {
        setIsLoadingAuth(false);
      });

    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => {
      controller.abort();
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  const handleLogout = async () => {
    setLogoutError(null);
    try {
      await logout();
      // Only clear user state once logout has succeeded
      setCurrentUser(null);
      navigate("/login");
    } catch (err: unknown) {
      // Do not clear user state if revocation failed on the server
      if (err instanceof Error) {
        setLogoutError(err.message);
      } else {
        setLogoutError("Failed to sign out. Please try again.");
      }
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
        {logoutError && (
          <div className="logout-error-banner" role="alert" aria-live="assertive">
            <span>{logoutError}</span>
            <button
              type="button"
              className="btn-dismiss"
              onClick={() => setLogoutError(null)}
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}

        {isLoadingAuth ? (
          <div className="loading-indicator" role="status" aria-live="polite">
            Loading session…
          </div>
        ) : !currentUser ? (
          <LoginForm onLoginSuccess={(user) => {
            setCurrentUser(user);
            navigate(user.role === "ORGANIZER" ? "/organizer/events" : "/events");
          }} />
        ) : currentUser.role === "ORGANIZER" && pathname === "/organizer/events" ? (
          <EventWorkspace user={currentUser} />
        ) : currentUser.role === "PARTICIPANT" && pathname === "/events" ? (
          <EventWorkspace user={currentUser} />
        ) : (
          <section className="dashboard-card" aria-labelledby="workspace-heading">
            <p className="eyebrow">Workspace</p>
            <h1 id="workspace-heading">{currentUser.displayName}</h1>
            <p className="intro">{statusText}</p>
          </section>
        )}
      </div>
    </main>
  );
}
