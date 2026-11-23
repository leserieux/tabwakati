import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySessionToken, getSessionActor, getSessionRole, SESSION_COOKIE_NAME } from "@/core/auth/auth";
import DashboardShell from "@/components/dashboard-shell";
import SectionTabs from "@/components/section-tabs";

export const runtime = "nodejs";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;

  if (!verifySessionToken(token)) {
    redirect("/login");
  }

  const role = getSessionRole(token);
  return <DashboardShell actor={getSessionActor(token)} role={role} readOnly={role === "viewer"}><div><SectionTabs role={role} />{children}</div></DashboardShell>;
}
