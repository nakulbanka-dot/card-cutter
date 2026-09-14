import type { Metadata } from "next";
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

const sans = Geist({ variable: "--font-sans-stack", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono-stack", subsets: ["latin"] });
const serif = Source_Serif_4({
  variable: "--font-serif-stack",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Card Cutter — evidence for debate, in one line",
    template: "%s · Card Cutter",
  },
  description:
    "Say what you want the card to prove. Card Cutter finds the sources, pulls the full text, and hands you the passages worth cutting — with the citation already built.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} ${serif.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-bg text-fg">
        <SiteNav />
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
