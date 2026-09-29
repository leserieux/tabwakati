"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/data";
import { logAdminAction } from "@/lib/audit";

const PATH = "/dashboard/tasks";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

async function afterAction(action: string, summary: string, target: string, error?: { message: string } | null) {
  await logAdminAction({ action, summary, target, status: error ? "error" : "success", errorMessage: error?.message });
  revalidatePath(PATH);
  if (error) redirect(`${PATH}?error=${encodeURIComponent(summary)}&msg=${encodeURIComponent(error.message)}`);
  redirect(`${PATH}?saved=${encodeURIComponent(summary)}`);
}

export async function addTask(formData: FormData) {
  const title = str(formData, "title");
  const row = {
    title,
    description: str(formData, "description"),
    category: str(formData, "category") || "autre",
    priority: str(formData, "priority") || "medium",
    source: "manual" as const
  };
  const { error } = await getSupabaseAdmin().from("admin_tasks").insert(row);
  await afterAction("tasks.create", title, "admin_tasks#new", error);
}

export async function updateTaskStatus(formData: FormData) {
  const id = str(formData, "id");
  const title = str(formData, "title") || id;
  const status = str(formData, "status");
  const { error } = await getSupabaseAdmin().from("admin_tasks").update({ status }).eq("id", id);
  await afterAction("tasks.status_change", `${title} → ${status}`, `admin_tasks#${id}`, error);
}

export async function deleteTask(formData: FormData) {
  const id = str(formData, "id");
  const title = str(formData, "title") || id;
  const { error } = await getSupabaseAdmin().from("admin_tasks").delete().eq("id", id);
  await afterAction("tasks.delete", `${title} supprimée`, `admin_tasks#${id}`, error);
}

export async function createTaskFromSuggestion(formData: FormData) {
  const title = str(formData, "title");
  const description = str(formData, "description");
  const category = str(formData, "category") || "autre";
  const priority = str(formData, "priority") || "medium";
  const sourceKey = str(formData, "source_key");

  const db = getSupabaseAdmin();
  const { data: existing } = await db
    .from("admin_tasks")
    .select("id")
    .eq("source_key", sourceKey)
    .not("status", "in", "(done,wontfix)")
    .maybeSingle();

  if (existing) {
    // Déjà suivie en tâche ouverte : on ne duplique pas, on redirige juste dessus.
    revalidatePath(PATH);
    redirect(`${PATH}?saved=${encodeURIComponent("Déjà suivi")}`);
  }

  const { error } = await db.from("admin_tasks").insert({ title, description, category, priority, source: "auto", source_key: sourceKey });
  await afterAction("tasks.create_from_suggestion", title, `admin_tasks#${sourceKey}`, error);
}
