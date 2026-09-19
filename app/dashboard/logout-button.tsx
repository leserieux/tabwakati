"use client";

import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      style={{
        background: "transparent",
        border: "1px solid #334155",
        color: "#94a3b8",
        padding: "0.4rem 0.9rem",
        borderRadius: "6px",
        cursor: "pointer",
        fontSize: "0.85rem"
      }}
    >
      Déconnexion
    </button>
  );
}
