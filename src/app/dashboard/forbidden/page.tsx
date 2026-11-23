import Link from "next/link";
import { PageHeader, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function ForbiddenPage({ searchParams }: { searchParams?: { from?: string } }) {
  return (
    <div>
      <PageHeader title="Accès refusé" />
      <Empty text="Ton rôle ne permet pas d'ouvrir cette page. Si tu penses que c'est une erreur, demande à un super-administrateur." />
      {searchParams?.from && <p className="wk-asset-sub">Page demandée : {searchParams.from}</p>}
      <p><Link href="/dashboard" className="wk-tab">Retour à l'accueil</Link></p>
    </div>
  );
}
