import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Click GO → $1,000,000? A funnel projection',
  description:
    'Monte Carlo projection of the traffic, conversion, price and churn assumptions a $1M revenue goal actually requires.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
