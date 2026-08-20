import type { Metadata } from "next";
import { IBM_Plex_Mono, Outfit } from "next/font/google";
import { DemoPreviewBanner, SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { Providers } from "@/components/Providers";
import "./globals.css";

const sans = Outfit({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: "HexBounty — reconstruction arcade",
    template: "%s · HexBounty",
  },
  description:
    "Fund Game Boy reconstruction work on Monad Testnet, publish accepted results, and let players pay creators for access.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <Providers>
          <a className="skip-link" href="#main">
            Skip to main content
          </a>
          <SiteHeader />
          <DemoPreviewBanner />
          <main id="main">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
