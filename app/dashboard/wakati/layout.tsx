import { loadWakati, EXPLORER } from "@/lib/wakati";
import { formatPrice, formatPct, shortAddress, formatDateTime } from "@/lib/format";
import { Pill, Icon } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function WakatiLayout({ children }: { children: React.ReactNode }) {
  const w = await loadWakati();
  const atFloor = w.state ? w.price <= w.state.floorUsd * 1.0001 : false;
  const contract = w.asset?.contract || "";

  return (
    <div>
      <div className="wk-token">
        <div className="wk-token-mark">W</div>
        <div className="wk-token-id">
          <div className="wk-token-name">
            WAKATI
            <span className="wk-token-net">{w.asset?.network ?? "Polygon"}</span>
            {atFloor && <Pill tone="warn">Prix au plancher</Pill>}
          </div>
          <div className="wk-token-sub">
            <span>Contrat {contract ? shortAddress(contract) : "introuvable"}</span>
            {contract && (
              <a className="wk-link" href={`${EXPLORER}/token/${contract}`} target="_blank" rel="noopener noreferrer">
                Voir sur PolygonScan
              </a>
            )}
          </div>
        </div>
        <div className="wk-token-price">
          <div className="wk-token-price-label">Prix interne</div>
          <div className="wk-token-price-value">{formatPrice(w.price)}</div>
          <div className="wk-token-price-sub">{formatPct(w.change24h, 2)} sur 24 h</div>
        </div>
        <div className="wk-token-actions">
          <span className="wk-updated">Actualisé le {formatDateTime(new Date())}</span>
          <a className="wk-btn" href="">
            <Icon name="refresh" size={15} />
            Actualiser
          </a>
        </div>
      </div>
      {children}
    </div>
  );
}
