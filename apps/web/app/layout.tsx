import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "ACE Practice Lab",
  description: "Google Cloud engineering practice",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
