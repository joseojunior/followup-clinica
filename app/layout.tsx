import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cadências | Clínica",
  description: "Painel independente de follow-up",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}

