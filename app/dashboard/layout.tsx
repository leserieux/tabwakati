import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySessionToken, getSessionActor, SESSION_COOKIE_NAME } from "@/lib/auth";
import DashboardShell from "@/components/dashboard-shell";

export const runtime = "nodejs";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;

  if (!verifySessionToken(token)) {
    redirect("/login");
  }

  return <DashboardShell actor={getSessionActor(token)}>{children}</DashboardShell>;
}
