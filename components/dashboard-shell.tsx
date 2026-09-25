"use client";

import { useState } from "react";
import Nav from "@/components/nav";
import LogoutButton from "@/app/dashboard/logout-button";

export default function DashboardShell({ actor, children }: { actor: string | null; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`wk-shell wk-shell-modern ${collapsed ? "wk-shell-collapsed" : ""}`}>
      <aside className="wk-side" aria-label="Console Wakati">
        <div className="wk-brand">
          <div className="wk-mark">W</div>
          <div className="wk-brand-copy">
            <div className="wk-brand-name">Wakati</div>
            <div className="wk-brand-sub">Console d'administration</div>
          </div>
          <button
            type="button"
            className="wk-sidebar-toggle"
            aria-label={collapsed ? "Développer le menu" : "Réduire le menu"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
          >
            <span aria-hidden="true">{collapsed ? "›" : "‹"}</span>
          </button>
        </div>
        <Nav collapsed={collapsed} />
        <div className="wk-side-foot">
          {actor && <div className="wk-user-chip"><span className="wk-user-name">{collapsed ? actor.slice(0, 1).toUpperCase() : `Connecté : ${actor}`}</span></div>}
          <LogoutButton />
        </div>
      </aside>
      <main className="wk-main"><div className="wk-page">{children}</div></main>
      <style jsx global>{`
        .wk-shell-modern { grid-template-columns: 260px minmax(0, 1fr); transition: grid-template-columns .2s ease; }
        .wk-shell-modern.wk-shell-collapsed { grid-template-columns: 82px minmax(0, 1fr); }
        .wk-shell-modern .wk-side { min-width: 0; overflow: hidden; }
        .wk-shell-modern .wk-brand { position: relative; min-width: 0; }
        .wk-shell-modern .wk-brand-copy, .wk-shell-modern .wk-navitem > span:last-child { transition: opacity .15s ease, width .2s ease; white-space: nowrap; }
        .wk-shell-collapsed .wk-brand-copy, .wk-shell-collapsed .wk-navitem > span:last-child, .wk-shell-collapsed .wk-navgroup-label, .wk-shell-collapsed .wk-user-name { width: 0; opacity: 0; overflow: hidden; }
        .wk-shell-collapsed .wk-brand { justify-content: center; padding-left: 0; padding-right: 0; }
        .wk-shell-collapsed .wk-navitem { justify-content: center; padding-left: 8px; padding-right: 8px; }
        .wk-shell-collapsed .wk-navgroup-items { gap: 6px; }
        .wk-sidebar-toggle { margin-left: auto; width: 26px; height: 26px; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; background: rgba(255,255,255,.05); color: #dfe9f4; cursor: pointer; font-size: 20px; line-height: 1; }
        .wk-sidebar-toggle:hover { background: rgba(121,214,204,.16); color: #fff; }
        .wk-shell-collapsed .wk-sidebar-toggle { margin-left: 0; position: absolute; right: -9px; top: 44px; z-index: 2; }
        .wk-shell-modern .wk-logout { width: 100%; }
        .wk-shell-collapsed .wk-logout { font-size: 0; text-align: center; padding-left: 4px; padding-right: 4px; }
        .wk-shell-collapsed .wk-logout::after { content: "↪"; font-size: 17px; }
        @media (max-width: 960px) {
          .wk-shell-modern, .wk-shell-modern.wk-shell-collapsed { grid-template-columns: 1fr; }
          .wk-shell-collapsed .wk-brand-copy, .wk-shell-collapsed .wk-navitem > span:last-child, .wk-shell-collapsed .wk-navgroup-label, .wk-shell-collapsed .wk-user-name { width: auto; opacity: 1; overflow: visible; }
          .wk-shell-collapsed .wk-navitem { justify-content: flex-start; }
          .wk-shell-collapsed .wk-sidebar-toggle { position: static; margin-left: auto; }
        }
      `}</style>
    </div>
  );
}
