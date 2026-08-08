import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const socialImage = `${protocol}://${host}/og.png`;

  return {
    title: "Counterbuild — Deadlock Item-Empfehlungen",
    description: "Datenbasierte Deadlock Item-Empfehlungen für deinen Helden, das Gegnerteam und den aktuellen Carry.",
    openGraph: {
      title: "Counterbuild — Deadlock Item-Empfehlungen",
      description: "Items, die dein Matchup drehen – gerankt mit echten Deadlock-Matchdaten.",
      type: "website",
      images: [{ url: socialImage, width: 1200, height: 630, alt: "Counterbuild – Items, die dein Matchup drehen" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Counterbuild — Deadlock Item-Empfehlungen",
      description: "Items, die dein Matchup drehen – gerankt mit echten Deadlock-Matchdaten.",
      images: [socialImage],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
