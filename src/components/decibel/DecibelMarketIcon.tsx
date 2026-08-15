'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';

interface DecibelMarketIconProps {
  logoUrl?: string;
  marketName: string;
  size?: number;
  className?: string;
}

export function DecibelMarketIcon({
  logoUrl,
  marketName,
  size = 20,
  className,
}: DecibelMarketIconProps) {
  if (!logoUrl) return null;

  return (
    <Image
      src={logoUrl}
      alt=""
      width={size}
      height={size}
      className={cn('shrink-0 rounded-full', className)}
      unoptimized
    />
  );
}
