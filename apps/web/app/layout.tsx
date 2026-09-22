import type { Metadata } from 'next';
import { Public_Sans, Schibsted_Grotesk, Spline_Sans_Mono } from 'next/font/google';
import './global.css';

const display = Schibsted_Grotesk({ subsets: ['latin'], variable: '--font-schibsted', weight: ['500', '700', '800'] });
const body = Public_Sans({ subsets: ['latin'], variable: '--font-public' });
const mono = Spline_Sans_Mono({ subsets: ['latin'], variable: '--font-spline-mono', weight: ['400', '500', '600'] });

export const metadata: Metadata = {
  title: 'FX Desk',
  description: 'Orders priced in dollars, paid in pounds, reported in euros.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
