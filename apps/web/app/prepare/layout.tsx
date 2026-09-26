import type { ReactNode } from 'react';
import Home from '../page';

export default function PrepareLayout({ children }: { children: ReactNode }) {
  return <><Home />{children}</>;
}
