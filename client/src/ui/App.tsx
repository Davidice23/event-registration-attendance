import { useEffect, useState } from "react";
import { isHealthResponse } from "../api/health";

type ApiStatus = "checking" | "available" | "unavailable";

export function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
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

    return () => controller.abort();
  }, []);

  const statusText = {
    checking: "Checking API connection…",
    available: "API is available",
    unavailable: "API is unavailable",
  }[apiStatus];

  return (
    <main className="page-shell">
      <header className="topbar">
        <span className="brand-mark" aria-hidden="true">ER</span>
        <span>Event Registration</span>
      </header>
      <section className="welcome-card" aria-labelledby="page-title">
        <p className="eyebrow">CPE334 · Theme 3</p>
        <h1 id="page-title">Event Registration and Attendance</h1>
        <p className="intro">The project scaffold is running. Event and registration workflows will be added in the next issues.</p>
        <div className={`api-status api-status--${apiStatus}`} role="status" aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          {statusText}
        </div>
      </section>
    </main>
  );
}
