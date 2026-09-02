import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Agent Monitor — DevTools for AI Agents',
  description: 'Real-time observability, timeline, and risk control plane for AI agents',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#090d16] text-slate-100 min-h-screen antialiased selection:bg-cyan-500/30 selection:text-cyan-200">
        {children}
      </body>
    </html>
  );
}
