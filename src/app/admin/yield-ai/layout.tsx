'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/admin/yield-ai/activity', label: 'Activity' },
  { href: '/admin/yield-ai/flows', label: 'Flows' },
];

export default function YieldAiAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div>
      <nav className="border-b bg-white sticky top-0 z-10">
        <div className="container mx-auto px-4 flex items-center gap-1">
          <span className="text-sm font-semibold text-gray-900 mr-4 py-3">
            Yield AI Admin
          </span>
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`text-sm px-3 py-3 border-b-2 -mb-px transition-colors ${
                  active
                    ? 'border-black text-black font-medium'
                    : 'border-transparent text-gray-500 hover:text-black'
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>
      {children}
    </div>
  );
}
