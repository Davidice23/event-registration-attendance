import { useEffect, useState } from "react";
import { fetchCurrentUser, logout, type CurrentUser, type Role } from "../api/auth";
import { isHealthResponse } from "../api/health";
import { LoginForm } from "./LoginForm";
import { EventWorkspace } from "./EventWorkspace";
import { MyRegistrations } from "./MyRegistrations";
import { OrganizerRoster } from "./OrganizerRoster";

type ApiStatus = "checking" | "available" | "unavailable";
const ORGANIZER_ROSTER_PATH = /^\/organizer\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/registrations$/i;

const ROLE_PATHS: Record<Role, string[]> = {
  ORGANIZER: ["/organizer/events"],
  PARTICIPANT: ["/events", "/my/registrations"],
};

function defaultPath(user: CurrentUser): string {
  return ROLE_PATHS[user.role][0];
}

function canOpenPath(user: CurrentUser, path: string): boolean {
  if (user.role === "ORGANIZER" && ORGANIZER_ROSTER_PATH.test(path)) return true;
  return ROLE_PATHS[user.role].includes(path);
}

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
        // Keep the current page on reload when the role may see it (e.g. /my/registrations).
        else if (!canOpenPath(user, window.location.pathname)) navigate(defaultPath(user));
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

        {currentUser?.role === "ORGANIZER" && (
          <nav className="main-nav" aria-label="Organizer">
            <a href="/organizer/events" aria-current={pathname === "/organizer/events" || ORGANIZER_ROSTER_PATH.test(pathname) ? "page" : undefined} onClick={(event) => { event.preventDefault(); navigate("/organizer/events"); }}>กิจกรรมของฉัน</a>
          </nav>
        )}

        {currentUser?.role === "PARTICIPANT" && (
          <nav className="main-nav" aria-label="Participant">
            {[["/events", "กิจกรรม"], ["/my/registrations", "รายการของฉัน"]].map(([path, label]) => (
              <a
                key={path}
                href={path}
                aria-current={pathname === path ? "page" : undefined}
                onClick={(event) => { event.preventDefault(); navigate(path); }}
              >
                {label}
              </a>
            ))}
          </nav>
        )}

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
            navigate(defaultPath(user));
          }} />
        ) : currentUser.role === "ORGANIZER" && pathname === "/organizer/events" ? (
          <EventWorkspace user={currentUser} onViewRoster={(eventId) => navigate(`/organizer/events/${eventId}/registrations`)} />
        ) : currentUser.role === "ORGANIZER" && ORGANIZER_ROSTER_PATH.test(pathname) ? (
          <OrganizerRoster eventId={pathname.match(ORGANIZER_ROSTER_PATH)![1]} onBack={() => navigate("/organizer/events")} />
        ) : currentUser.role === "PARTICIPANT" && pathname === "/events" ? (
          <EventWorkspace key="events" user={currentUser} />
        ) : currentUser.role === "PARTICIPANT" && pathname === "/my/registrations" ? (
          <MyRegistrations key="my-registrations" />
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
