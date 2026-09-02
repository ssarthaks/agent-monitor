import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Agent Monitor — Activity Monitor & Control Plane for AI Agents',
  description: 'Pure, real-time observability, action timeline, diff inspection, and deterministic risk control plane for AI agents',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-white text-charcoal min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
