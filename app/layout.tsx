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
    title: "Counterbuild — Deadlock Item Recommendations",
    description: "Data-driven Deadlock item recommendations for your hero, the enemy team, and their carry.",
    openGraph: {
      title: "Counterbuild — Deadlock Item Recommendations",
      description: "Items that turn your matchup—ranked with real Deadlock match data.",
      type: "website",
      images: [{ url: socialImage, width: 1200, height: 630, alt: "Counterbuild — items that turn your matchup" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Counterbuild — Deadlock Item Recommendations",
      description: "Items that turn your matchup—ranked with real Deadlock match data.",
      images: [socialImage],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
