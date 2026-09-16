"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context-v2";
import { getDefaultRouteForRoles } from "@/lib/role-routing";

type EmailLoginFormProps = {
  allowSignup?: boolean;
  initialMode?: "login" | "signup";
  title?: string;
  description?: string;
  footerNote?: string;
  signupLabel?: string;
};

export function EmailLoginForm({
  allowSignup = true,
  initialMode = "login",
  title,
  description,
  footerNote,
  signupLabel = "New investor? Sign up",
}: EmailLoginFormProps) {
  const router = useRouter();
  const { loginWithToken } = useAuth();
  const [isSignup, setIsSignup] = useState(allowSignup && initialMode === "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const endpoint = isSignup ? "/api/auth/signup" : "/api/auth/login";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Authentication failed");
        setLoading(false);
        return;
      }

      if (typeof data.token !== "string" || data.token.length === 0) {
        throw new Error("Authentication response did not contain a session token");
      }

      const verifiedIdentity = await loginWithToken(data.token);
      router.push(getDefaultRouteForRoles(verifiedIdentity.roles));
    } catch {
      setError("Network error - please try again");
      setLoading(false);
    }
  };

  const heading = title || (isSignup ? "Create investor account" : "Secure email access");

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="font-display text-2xl font-bold tracking-tight text-bxo-text-primary">
          {heading}
        </h2>
        {description ? (
          <p className="text-sm leading-6 text-bxo-text-secondary">{description}</p>
        ) : null}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="email" className="block text-sm font-medium text-bxo-text-secondary">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "authentication-error" : undefined}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="h-12 w-full rounded-xl border border-bxo-border-default bg-bxo-bg-primary px-4 text-base text-bxo-text-primary outline-none transition placeholder:text-bxo-text-disabled focus:border-bxo-accent-primary focus:ring-2 focus:ring-bxo-accent-muted"
            placeholder="name@company.com"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="block text-sm font-medium text-bxo-text-secondary">
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete={isSignup ? "new-password" : "current-password"}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "authentication-error" : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="h-12 w-full rounded-xl border border-bxo-border-default bg-bxo-bg-primary px-4 pr-14 text-base text-bxo-text-primary outline-none transition placeholder:text-bxo-text-disabled focus:border-bxo-accent-primary focus:ring-2 focus:ring-bxo-accent-muted"
              placeholder="Enter your password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-1 my-auto flex h-11 w-11 items-center justify-center rounded-lg text-bxo-text-tertiary transition hover:bg-bxo-accent-soft hover:text-bxo-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary"
            >
              {showPassword ? <EyeOff aria-hidden="true" className="h-5 w-5" /> : <Eye aria-hidden="true" className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {error && (
          <div id="authentication-error" role="alert" aria-live="polite" className="rounded-xl border border-bxo-danger-border bg-bxo-danger-soft px-4 py-3 text-sm text-bxo-danger-light">
            {error}
          </div>
        )}

        <Button
          type="submit"
          disabled={loading}
          className="bxo-primary-cta h-12 w-full rounded-xl text-bxo-bg-primary"
        >
          {loading ? "Processing..." : isSignup ? "Create account" : "Continue"}
        </Button>
      </form>

      {allowSignup ? (
        <div className="flex items-center justify-between gap-4 border-t border-bxo-divider pt-4 text-sm">
          <span className="text-bxo-text-tertiary">
            {isSignup ? "Already have investor access?" : "Need investor access?"}
          </span>
          <button
            type="button"
            onClick={() => {
              setIsSignup(!isSignup);
              setError("");
            }}
            className="font-medium text-bxo-accent-primary transition hover:text-bxo-accent-primary-light"
          >
            {isSignup ? "Use login instead" : signupLabel}
          </button>
        </div>
      ) : null}

      <p className="text-xs leading-5 text-bxo-text-tertiary">
        {footerNote || "Use your assigned BlockXOne credentials. Role-based routing happens after authentication."}
      </p>
    </div>
  );
}
