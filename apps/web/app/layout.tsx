import "./globals.css";
import type { Metadata } from "next";

// HTML references build-specific assets. Re-render documents on each request so
// shared caches cannot retain an old shell after a Cloud Run deployment.
// Next.js still caches /_next/static/* immutably; API route handlers are separate.
export const revalidate = 0;

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
