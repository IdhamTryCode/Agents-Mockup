import type { ReactNode } from "react";
import "./globals.css";
import "katex/dist/katex.min.css";

export const metadata = {
  title: "RantAI Agents — Mockup",
  description: "Faithful ke kontrak fine-tuning RantAI Agents: persona Elise + KB Context + figure, via vLLM",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
