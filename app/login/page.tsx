"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Connexion impossible. Vérifie le mot de passe.");
        return;
      }
      router.push("/dashboard/treasury");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="wk-login">
      <div className="wk-login-art">
        <div className="wk-brand" style={{ padding: 0 }}>
          <div className="wk-mark">W</div>
          <div className="wk-brand-name">Wakati</div>
        </div>
        <div>
          <h2>Les fonds de tes utilisateurs, sous contrôle.</h2>
          <p>Vérifie en un coup d'œil que ce que tu détiens couvre ce que tu dois, et suis l'activité de la plateforme.</p>
        </div>
        <span style={{ fontSize: 13, color: "#8b99ac" }}>Accès réservé aux administrateurs</span>
      </div>
      <div className="wk-login-form-side">
        <form onSubmit={handleSubmit} className="wk-login-form">
          <h1>Connexion</h1>
          <p>Entre le mot de passe administrateur.</p>
          <label className="wk-label" htmlFor="password">Mot de passe</label>
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="wk-input" autoFocus autoComplete="current-password" />
          {error && <p className="wk-form-error" role="alert">{error}</p>}
          <button type="submit" disabled={loading} className="wk-submit">
            {loading ? "Connexion en cours" : "Se connecter"}
          </button>
        </form>
      </div>
    </div>
  );
}
