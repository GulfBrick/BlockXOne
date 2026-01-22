"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context-v2";

export function EmailLoginForm() {
  const { loginWithToken } = useAuth();
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const endpoint = isSignup ? "/v1/auth/signup" : "/v1/auth/login";
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${endpoint}`, {
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

      // Use the token to log in
      await loginWithToken(data.token);

      // Redirect based on role
      if (data.role === "Investor") {
        window.location.href = "/investor/kyc";
      } else if (data.role === "SuperAdmin") {
        window.location.href = "/admin";
      } else if (data.role === "TokenisationAgent") {
        window.location.href = "/tokenisation-agent";
      } else if (data.role === "IssuerFundManager") {
        window.location.href = "/issuer";
      } else if (data.role === "ComplianceOfficer") {
        window.location.href = "/compliance";
      } else {
        window.location.href = "/";
      }
    } catch (err) {
      setError("Network error - please try again");
      setLoading(false);
    }
  };

  return (
    <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
      <h2 className="text-2xl font-bold mb-6 text-gray-800">
        {isSignup ? "Sign Up as Investor" : "Log In"}
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="your@email.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="••••••••"
          />
        </div>

        {error && (
          <div className="text-red-600 text-sm bg-red-50 p-3 rounded-md">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
        >
          {loading ? "Processing..." : isSignup ? "Sign Up" : "Log In"}
        </button>
      </form>

      <div className="mt-4 text-center">
        <button
          type="button"
          onClick={() => {
            setIsSignup(!isSignup);
            setError("");
          }}
          className="text-sm text-blue-600 hover:text-blue-700"
        >
          {isSignup
            ? "Already have an account? Log in"
            : "New investor? Sign up"}
        </button>
      </div>

      <div className="mt-6 text-center text-sm text-gray-600">
        <p>Super Admin? Use your credentials to log in</p>
      </div>
    </div>
  );
}
