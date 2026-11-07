import type { Metadata } from "next";
import "./globals.css";

export const viewport = { width: "device-width", initialScale: 1 };
export const metadata: Metadata = { title: "ClearPay — 모두의 송금 비서", description: "Maroo Verifiable Privacy × LLM" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="ko"><body>{children}</body></html>);
}
