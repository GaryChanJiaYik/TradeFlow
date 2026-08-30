import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TradeFlow",
  description: "Price alerts and trading reminders for XAUUSD",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
