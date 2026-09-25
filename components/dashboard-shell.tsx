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
          <div className="wk-brand-copy"><div className="wk-brand-name">Wakati</div><div className="wk-brand-sub">Console d'administration</div></div>
          <button type="button" className="wk-sidebar-toggle" aria-label={collapsed ? "Développer le menu" : "Réduire le menu"} aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)}><span aria-hidden="true">{collapsed ? "›" : "‹"}</span></button>
        </div>
        <Nav collapsed={collapsed} />
        <div className="wk-side-foot">
          {actor && <div className="wk-user-chip"><span className="wk-user-name">{collapsed ? actor.slice(0, 1).toUpperCase() : `Connecté : ${actor}`}</span></div>}
          <LogoutButton />
        </div>
      </aside>
      <main className="wk-main"><div className="wk-page">{children}</div></main>
      <style jsx global>{`
        .wk-shell-modern { grid-template-columns: 260px minmax(0,1fr); transition: grid-template-columns .2s ease; }
        .wk-shell-modern.wk-shell-collapsed { grid-template-columns: 82px minmax(0,1fr); }
        .wk-shell-modern .wk-side { min-width: 0; overflow: hidden; }
        .wk-shell-modern .wk-brand { position: relative; min-width: 0; }
        .wk-brand-copy, .wk-navitem > span:last-child { transition: opacity .15s ease, width .2s ease; white-space: nowrap; }
        .wk-navgroup-items { display: flex; flex-direction: column; gap: 4px; }
        .wk-navitem { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; color: #c4cedb; text-decoration: none; font-size: 14px; font-weight: 500; border: 1px solid transparent; transition: all .18s ease; }
        .wk-navitem:hover { background: rgba(255,255,255,.05); color: #fff; transform: translateX(1px); }
        .wk-navitem.active { background: linear-gradient(90deg,rgba(121,214,204,.18),rgba(255,255,255,.03)); color: #fff; border-color: rgba(121,214,204,.28); box-shadow: inset 0 0 0 1px rgba(121,214,204,.08); }
        .wk-navicon { width: 28px; height: 28px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.06); flex-shrink: 0; }
        .wk-navitem.active .wk-navicon { background: rgba(121,214,204,.14); border-color: rgba(121,214,204,.18); }
        .wk-sidebar-toggle { margin-left: auto; width: 26px; height: 26px; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; background: rgba(255,255,255,.05); color: #dfe9f4; cursor: pointer; font-size: 20px; line-height: 1; }
        .wk-sidebar-toggle:hover { background: rgba(121,214,204,.16); color: #fff; }
        .wk-user-chip { display: inline-flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.06); color: #dfe9f4; font-size: 12px; }
        .wk-user-chip::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 4px rgba(23,115,74,.18); }
        .wk-shell-collapsed .brand-copy, .wk-shell-collapsed .wk-brand-copy, .wk-shell-collapsed .wk-navitem > span:last-child, .wk-shell-collapsed .wk-navgroup-label, .wk-shell-collapsed .wk-user-name { width: 0; opacity: 0; overflow: hidden; }
        .wk-shell-collapsed .wk-brand { justify-content: center; padding-left: 0; padding-right: 0; }
        .wk-shell-collapsed .wk-navitem { justify-content: center; padding-left: 8px; padding-right: 8px; }
        .wk-shell-collapsed .wk-sidebar-toggle { margin-left: 0; position: absolute; right: -9px; top: 44px; z-index: 2; }
        .wk-shell-modern .wk-logout { width: 100%; }
        .wk-shell-collapsed .wk-logout { font-size: 0; text-align: center; padding-left: 4px; padding-right: 4px; }
        .wk-shell-collapsed .wk-logout::after { content: "↪"; font-size: 17px; }
        @media (max-width:960px) { .wk-shell-modern,.wk-shell-modern.wk-shell-collapsed { grid-template-columns:1fr; } .wk-shell-collapsed .wk-brand-copy,.wk-shell-collapsed .wk-navitem > span:last-child,.wk-shell-collapsed .wk-navgroup-label,.wk-shell-collapsed .wk-user-name { width:auto; opacity:1; overflow:visible; } .wk-shell-collapsed .wk-navitem { justify-content:flex-start; } .wk-shell-collapsed .wk-sidebar-toggle { position:static; margin-left:auto; } }
      `}</style>
    </div>
  );
}
