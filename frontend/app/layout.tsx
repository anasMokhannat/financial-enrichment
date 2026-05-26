import type { Metadata } from "next";
import { Poppins } from "next/font/google";

import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";

import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Flugia · Enrichment",
  description:
    "Search Belgian companies, extract legal profiles and financial statements.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={poppins.variable}>
      <body className="font-sans antialiased">
        <div className="flex h-screen flex-col">
          <TopBar />
          <div className="flex min-h-0 flex-1">
            <Sidebar />
            <main className="flex-1 overflow-y-auto bg-surface-page p-6">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
