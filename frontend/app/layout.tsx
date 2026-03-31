import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Navbar from '@/components/Navbar';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'FOSSHACK — Open Source Issue Recommendations',
  description:
    'Find open source issues matched to your skills. Stop scrolling through hundreds of issues — get personalized recommendations based on your tech stack, experience, and goals.',
  keywords: ['open source', 'github', 'issues', 'contributions', 'hacktoberfest'],
  openGraph: {
    title: 'FOSSHACK',
    description: 'Personalized open source issue recommendations',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} h-full`}>
        <Navbar />
        <main className="min-h-[calc(100vh-4rem)]">{children}</main>
      </body>
    </html>
  );
}
