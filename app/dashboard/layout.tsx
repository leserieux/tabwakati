import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import LogoutButton from "./logout-button";
import Nav from "@/components/nav";

export const runtime = "nodejs";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;

  if (!verifySessionToken(token)) {
    redirect("/login");
  }

  return (
    <div className="wk-shell">
      <aside className="wk-side">
        <div className="wk-brand">
          <div className="wk-mark">W</div>
          <div>
            <div className="wk-brand-name">Wakati</div>
            <div className="wk-brand-sub">Console d'administration</div>
          </div>
        </div>
        <Nav />
        <div className="wk-side-foot">
          <LogoutButton />
        </div>
      </aside>
      <main className="wk-main">
        <div className="wk-page">{children}</div>
      </main>
    </div>
  );
}
