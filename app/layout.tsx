import "./globals.css";
import "./dashboard/users/[id]/behavior-summary.css";

export const metadata = {
  title: "Wakati Console",
  description: "Console d'administration Wakati"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
