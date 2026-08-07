import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Noise Lab",
  description: "Design, audition, and review deterministic Audacity noise variants.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
