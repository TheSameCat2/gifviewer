import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GIF Viewer",
  description: "Self-hosted media gallery for GIFs and videos",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
