import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Sidebar } from "@/components/Sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Guest Post Links",
  description: "Guest post backlink discovery dashboard",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex h-full bg-bg text-text">
        <ThemeProvider>
          <Sidebar />
          <div className="flex-1 overflow-y-auto">
            <main className="mx-auto w-full max-w-6xl px-8 py-8">{children}</main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
