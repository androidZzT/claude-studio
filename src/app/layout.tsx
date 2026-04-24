import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: 'harness-studio',
  description: 'Visual Orchestration for Claude Code Agent Teams. Manage agents, workflows, skills & rules with a drag-and-drop DAG editor.',
  keywords: ['claude code', 'agent orchestration', 'workflow editor', 'visual editor', 'harness-studio'],
  icons: {
    icon: '/icon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
      data-theme="claude-dark"
    >
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
