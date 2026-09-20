import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import LogoutButton from "./logout-button";

export const runtime = "nodejs";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;

  if (!verifySessionToken(token)) {
    redirect("/login");
  }

  return (
    <div style={{ minHeight: "100vh", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "1rem 2rem",
          borderBottom: "1px solid #1e293b",
          background: "#0f172a"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "2rem" }}>
          <strong style={{ color: "#f8fafc", fontSize: "1.1rem" }}>Wakati Dashboard</strong>
          <nav style={{ display: "flex", gap: "1.5rem" }}>
            {[
              ["/dashboard/treasury", "Solvabilité"],
              ["/dashboard/activity", "Activité"]
            ].map(([href, label]) => (
              <a key={href} href={href} style={{ color: "#cbd5e1", textDecoration: "none", fontSize: "0.95rem" }}>
                {label}
              </a>
            ))}
          </nav>
        </div>
        <LogoutButton />
      </header>
      <main style={{ padding: "2rem", background: "#0f172a", minHeight: "calc(100vh - 65px)" }}>
        {children}
      </main>
    </div>
  );
}
