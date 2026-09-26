import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Trao — Interview prep, made personal', description: 'A focused workspace for your next interview.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
