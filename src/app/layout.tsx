import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "TenderPilot AI", template: "%s · TenderPilot AI" },
  description: "Veille, qualification et préparation des réponses aux appels d'offres informatiques",
  robots: { index: false, follow: false },
};

// Applique le thème avant le premier rendu (évite le flash clair/sombre).
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
