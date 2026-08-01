import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ptt-tracker — 中文社群雷達",
  description: "PTT + Dcard + Threads + 巴哈姆特 跨平台品牌監控",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-TW">
      <body>{children}</body>
    </html>
  );
}