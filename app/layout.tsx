export const metadata = {
  title: "Wakati Dashboard",
  description: "Dashboard interne Wakati"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body style={{ margin: 0, background: "#0f172a" }}>{children}</body>
    </html>
  );
}
