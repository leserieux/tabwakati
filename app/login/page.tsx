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
        setError(data.error || "Erreur de connexion");
        return;
      }
      router.push("/dashboard/treasury");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={styles.main}>
      <form onSubmit={handleSubmit} style={styles.card}>
        <h1 style={styles.title}>Wakati Dashboard</h1>
        <p style={styles.subtitle}>Accès administrateur</p>
        <input
          type="password"
          placeholder="Mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={styles.input}
          autoFocus
        />
        {error && <p style={styles.error}>{error}</p>}
        <button type="submit" disabled={loading} style={styles.button}>
          {loading ? "Connexion..." : "Se connecter"}
        </button>
      </form>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0f172a",
    fontFamily: "system-ui, -apple-system, sans-serif"
  },
  card: {
    background: "#1e293b",
    padding: "2.5rem",
    borderRadius: "12px",
    width: "320px",
    boxShadow: "0 10px 40px rgba(0,0,0,0.3)"
  },
  title: { color: "#f8fafc", margin: 0, fontSize: "1.4rem" },
  subtitle: { color: "#94a3b8", marginTop: "0.25rem", marginBottom: "1.5rem", fontSize: "0.9rem" },
  input: {
    width: "100%",
    padding: "0.75rem",
    borderRadius: "8px",
    border: "1px solid #334155",
    background: "#0f172a",
    color: "#f8fafc",
    fontSize: "1rem",
    boxSizing: "border-box"
  },
  error: { color: "#f87171", fontSize: "0.85rem", marginTop: "0.5rem" },
  button: {
    width: "100%",
    marginTop: "1rem",
    padding: "0.75rem",
    borderRadius: "8px",
    border: "none",
    background: "#3b82f6",
    color: "white",
    fontSize: "1rem",
    fontWeight: 600,
    cursor: "pointer"
  }
};
