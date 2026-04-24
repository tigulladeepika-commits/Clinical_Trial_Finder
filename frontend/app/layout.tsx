// app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title:       "Clinical Trial Navigator",
  description: "Search clinical trials, explore sites, and discover nearby physicians.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.svg", rel: "shortcut icon", type: "image/svg+xml" },
    ],
    apple: [{ url: "/favicon.svg" }],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}