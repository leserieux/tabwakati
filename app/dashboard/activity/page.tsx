import { redirect } from "next/navigation";

// L'ancienne page « Activité » dupliquait la Vue d'ensemble : son contenu y a été fusionné.
export default function ActivityRedirect() {
  redirect("/dashboard");
}
