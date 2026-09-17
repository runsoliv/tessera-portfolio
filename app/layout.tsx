import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

import { AppShell } from '@/components/app-shell';
import { PortfolioProvider } from '@/components/portfolio-provider';

import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('http://localhost:3000'),
  title: {
    default: 'Tessera — Local Crypto Portfolio',
    template: '%s · Tessera',
  },
  description:
    'A local crypto portfolio dashboard with live market data, spot and perpetual position analytics.',
  openGraph: {
    title: 'Tessera — Local Crypto Portfolio',
    description:
      'Local portfolio tracking with live crypto prices, position analytics and risk metrics.',
    type: 'website',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'Tessera crypto portfolio dashboard',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tessera — Local Crypto Portfolio',
    description:
      'Local portfolio tracking with live crypto prices, position analytics and risk metrics.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var saved=localStorage.getItem('tessera.theme');var theme=saved==='light'||saved==='dark'?saved:(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.classList.remove('light','dark');document.documentElement.classList.add(theme);document.documentElement.style.colorScheme=theme;}catch(e){document.documentElement.classList.add('dark');}})();`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <PortfolioProvider>
          <AppShell>{children}</AppShell>
        </PortfolioProvider>
      </body>
    </html>
  );
}
