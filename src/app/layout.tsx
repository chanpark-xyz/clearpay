import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "ClearPay — 공개 범위를 말로 정하는 결제", description: "Maroo Verifiable Privacy × LLM" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="ko"><body>{children}</body></html>);
}
