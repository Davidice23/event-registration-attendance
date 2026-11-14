import React, { useState } from "react";
import { login, type CurrentUser } from "../api/auth";

interface LoginFormProps {
  onLoginSuccess: (user: CurrentUser) => void;
}

export function LoginForm({ onLoginSuccess }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setErrorMessage("Please enter both email and password.");
      return;
    }

    setIsSubmitting(true);
    try {
      const user = await login({ email: trimmedEmail, password });
      onLoginSuccess(user);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("Invalid email or password.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickFill = (demoEmail: string) => {
    setEmail(demoEmail);
  };

  return (
    <section className="login-card" aria-labelledby="login-title">
      <h2 id="login-title">Sign In</h2>
      <p className="login-desc">Enter your account credentials to access your events.</p>

      {errorMessage && (
        <div className="login-error" role="alert" aria-live="assertive">
          {errorMessage}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="login-form">
        <div className="form-group">
          <label htmlFor="login-email">Email Address</label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isSubmitting}
            placeholder="e.g. organizer-a@example.test"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isSubmitting}
            placeholder="••••••••••••"
            required
          />
        </div>

        <button
          type="submit"
          className="btn-primary"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Signing in…" : "Sign In"}
        </button>
      </form>

      {/* Development-only helper: production builds (the deployed app) omit it entirely. */}
      {import.meta.env.DEV && <div className="demo-accounts-hint">
        <span className="demo-hint-title">Quick demo accounts:</span>
        <div className="demo-hint-buttons">
          <button
            type="button"
            className="btn-chip"
            onClick={() => handleQuickFill("organizer-a@example.test")}
          >
            Organizer A
          </button>
          <button
            type="button"
            className="btn-chip"
            onClick={() => handleQuickFill("participant-a@example.test")}
          >
            Participant A
          </button>
        </div>
      </div>}
    </section>
  );
}
