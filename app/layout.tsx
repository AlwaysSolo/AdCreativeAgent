import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Resort Ad Creative Generator",
  description: "Local web app for resort ad creative generation."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
