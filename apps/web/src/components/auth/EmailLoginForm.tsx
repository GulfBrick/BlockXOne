"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  const { loginDirect } = useAuth();
  const [isSignup, setIsSignup] = useState(allowSignup && initialMode === "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

      // Set user directly from login response (avoids CORS call to /v1/me)
      loginDirect(data);

      router.push(getDefaultRouteForRoles(data.role ? [data.role] : []));
    } catch {
      setError("Network error - please try again");
      setLoading(false);
    }
  };

  const heading = title || (isSignup ? "Create investor account" : "Secure email access");

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight text-white">
          {heading}
        </h2>
        {description ? (
          <p className="text-sm leading-6 text-white/65">{description}</p>
        ) : null}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="email" className="block text-sm font-medium text-white/80">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="h-12 w-full rounded-xl border border-white/12 bg-white/5 px-4 text-base text-white outline-none transition focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/30 placeholder:text-white/35"
            placeholder="name@company.com"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="block text-sm font-medium text-white/80">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="h-12 w-full rounded-xl border border-white/12 bg-white/5 px-4 text-base text-white outline-none transition focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/30 placeholder:text-white/35"
            placeholder="Enter your password"
          />
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        <Button
          type="submit"
          disabled={loading}
          className="h-12 w-full rounded-xl bg-gradient-to-r from-[#06B6D4] via-[#0894E6] to-[#3B82F6] text-white shadow-lg shadow-cyan-500/10 hover:opacity-95"
        >
          {loading ? "Processing..." : isSignup ? "Create account" : "Continue"}
        </Button>
      </form>

      {allowSignup ? (
        <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-4 text-sm">
          <span className="text-white/45">
            {isSignup ? "Already have investor access?" : "Need investor access?"}
          </span>
          <button
            type="button"
            onClick={() => {
              setIsSignup(!isSignup);
              setError("");
            }}
            className="font-medium text-cyan-300 transition hover:text-cyan-200"
          >
            {isSignup ? "Use login instead" : signupLabel}
          </button>
        </div>
      ) : null}

      <p className="text-xs leading-5 text-white/45">
        {footerNote || "Use your assigned BlockXOne credentials. Role-based routing happens after authentication."}
      </p>
    </div>
  );
}
