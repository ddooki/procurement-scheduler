import type {Metadata} from 'next';
import { Literata, Nunito_Sans } from 'next/font/google';
import './globals.css';

const literata = Literata({ subsets: ['latin'], variable: '--font-headline' });
const nunitoSans = Nunito_Sans({ subsets: ['latin'], variable: '--font-body' });

export const metadata: Metadata = {
  title: '외주구매팀 업무관리표',
  description: '외주구매팀을 위한 오프라인 지원 업무 및 일정 관리 대시보드',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="ko" className={`${literata.variable} ${nunitoSans.variable}`}>
      <body className="font-body antialiased" suppressHydrationWarning>{children}</body>
    </html>
  );
}
