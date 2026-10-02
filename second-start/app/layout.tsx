import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Second Start — Work and home in Abu Dhabi",
  description: "Find work that fits your life, and a home that fits your career in Abu Dhabi.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
