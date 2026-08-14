import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://deadlock-counterbuild.febsho.chatgpt.site";
const socialImage = `${siteUrl.replace(/\/$/, "")}/og.png`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Deadlock Counterlock — Matchup & Build Intelligence",
  description: "Data-driven Deadlock counter picks, lane matchups, item recommendations, and full builds.",
  openGraph: {
    title: "Deadlock Counterlock",
    description: "Forge a better Deadlock draft, lane, and item build with live matchup data.",
    type: "website",
    images: [{ url: socialImage, width: 1200, height: 630, alt: "Deadlock Counterlock matchup intelligence" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Deadlock Counterlock",
    description: "Counter picks, lane matchups, and item builds powered by live Deadlock data.",
    images: [socialImage],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
