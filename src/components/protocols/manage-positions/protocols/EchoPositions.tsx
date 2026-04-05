'use client';

import { useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/shared/Badge/Badge';
import { cn } from '@/lib/utils';
import { formatCurrency, formatNumber } from '@/lib/utils/numberFormat';
import { ProtocolIcon } from '@/shared/ProtocolIcon/ProtocolIcon';
import tokenList from '@/lib/data/tokenList.json';
import { useEchoPositions, type EchoPosition } from '@/lib/query/hooks/protocols/echo';
import { queryKeys } from '@/lib/query/queryKeys';

const tokensData = (tokenList as { data: { data: Array<{ tokenAddress?: string; faAddress?: string; symbol?: string; logoUrl?: string }> } }).data.data;

function normalizeAddress(addr: string): string {
  if (!addr || !addr.startsWith('0x')) return addr;
  return '0x' + addr.slice(2).replace(/^0+/, '') || '0x0';
}

function getTokenLogoUrl(underlyingAddress: string, symbol: string): string | null {
  const normalized = normalizeAddress(underlyingAddress?.startsWith('0x') ? underlyingAddress : `0x${underlyingAddress}`);
  const byAddress = tokensData.find((t) => {
    const fa = t.faAddress ? normalizeAddress(t.faAddress) : null;
    const ta = t.tokenAddress ? normalizeAddress(t.tokenAddress) : null;
    return fa === normalized || ta === normalized;
  });
  if (byAddress?.logoUrl) return byAddress.logoUrl;
  const bySymbol = tokensData.find((t) => t.symbol?.toLowerCase() === symbol?.toLowerCase());
  return bySymbol?.logoUrl ?? null;
}

function EchoPositionRow({ position }: { position: EchoPosition }) {
  const isBorrow = position.type === 'borrow';
  const price = position.priceUSD > 0 ? position.priceUSD : null;
  const valueDisplay = formatCurrency(position.valueUSD, 2);
  const amountDisplay = formatNumber(position.amount, 6);
  const logo = position.logoUrl || getTokenLogoUrl(position.underlyingAddress, position.symbol);
  const displayLogo = logo ?? '/file.svg';

  return (
    <div className="p-3 sm:p-4 border-b last:border-b-0 transition-colors">
      {/* Desktop layout */}
      <div className="hidden sm:flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ProtocolIcon
            logoUrl={displayLogo}
            name={position.symbol}
            size="sm"
          />
          <div>
            <div className="flex items-center gap-2">
              <div className="text-lg font-semibold">{position.symbol}</div>
              <Badge
                variant={isBorrow ? 'danger' : 'success'}
                className="text-xs font-normal px-2 py-0.5 h-5"
              >
                {isBorrow ? 'Borrow' : 'Supply'}
              </Badge>
            </div>
            <div className="text-base text-muted-foreground">
              {price ? formatCurrency(price, 2) : 'Price: N/A'}
            </div>
          </div>
        </div>
        <div className="text-right space-y-1">
          <div className="flex items-center justify-end gap-2">
            <Badge
              variant={isBorrow ? 'danger' : 'success'}
              className="text-xs font-normal px-2 py-0.5 h-5"
            >
              APR: {position.apyFormatted ?? '0.00%'}
            </Badge>
            <div className={cn('text-lg font-bold', isBorrow && 'text-red-600')}>
              {isBorrow ? '-' : ''}
              {valueDisplay}
            </div>
          </div>
          <div className="text-base text-muted-foreground">{amountDisplay}</div>
        </div>
      </div>

      {/* Mobile layout */}
      <div className="sm:hidden space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <ProtocolIcon
              logoUrl={displayLogo}
              name={position.symbol}
              size="sm"
            />
            <div>
              <div className="flex items-center gap-2">
                <div className="text-base font-semibold">{position.symbol}</div>
                <Badge
                  variant={isBorrow ? 'danger' : 'success'}
                  className="text-xs font-normal px-1.5 py-0.5 h-4"
                >
                  {isBorrow ? 'Borrow' : 'Supply'}
                </Badge>
              </div>
              <div className="text-sm text-muted-foreground">
                {price ? formatCurrency(price, 2) : 'Price: N/A'}
              </div>
            </div>
          </div>
          <div className="text-right space-y-1">
            <div className="flex items-center justify-end gap-2">
              <Badge
                variant={isBorrow ? 'danger' : 'success'}
                className="text-xs font-normal px-1.5 py-0.5 h-4"
              >
                APR: {position.apyFormatted ?? '0.00%'}
              </Badge>
              <div className={cn('text-base font-semibold', isBorrow && 'text-red-600')}>
                {isBorrow ? '-' : ''}
                {valueDisplay}
              </div>
            </div>
            <div className="text-sm text-muted-foreground">{amountDisplay}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function sortByValueDesc(items: EchoPosition[]): EchoPosition[] {
  return [...items].sort((a, b) => (b.valueUSD || 0) - (a.valueUSD || 0));
}

export function EchoPositions() {
  const { account } = useWallet();
  const queryClient = useQueryClient();
  const walletAddress = account?.address?.toString();
  const {
    data: positions = [],
    isLoading: loading,
    error,
  } = useEchoPositions(walletAddress, { refetchOnMount: 'always' });

  useEffect(() => {
    const handleRefresh = (evt: Event) => {
      const event = evt as CustomEvent<{ protocol: string }>;
      if (event?.detail?.protocol === 'echo') {
        if (walletAddress) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.protocols.echo.userPositions(walletAddress),
          });
        }
      }
    };
    window.addEventListener('refreshPositions', handleRefresh);
    return () => window.removeEventListener('refreshPositions', handleRefresh);
  }, [walletAddress, queryClient]);

  const sortedPositions = useMemo(() => sortByValueDesc(positions), [positions]);

  if (loading) {
    return <div className="py-4 text-muted-foreground">Loading positions...</div>;
  }
  if (error) {
    return <div className="py-4 text-red-500">Failed to load positions</div>;
  }
  if (sortedPositions.length === 0) {
    return (
      <div className="py-4 text-muted-foreground">
        No positions on Echo Protocol. Manage deposits at{' '}
        <a href="https://vault.echo-protocol.xyz/lending" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
          vault.echo-protocol.xyz
        </a>
      </div>
    );
  }

  const supplyTotal = sortedPositions.filter((p) => p.type !== 'borrow').reduce((sum, p) => sum + (p.valueUSD || 0), 0);
  const borrowTotal = sortedPositions.filter((p) => p.type === 'borrow').reduce((sum, p) => sum + (p.valueUSD || 0), 0);
  const netTotal = supplyTotal - borrowTotal;

  return (
    <div className="space-y-4 text-base">
      <ScrollArea>
        {sortedPositions.map((position) => (
          <EchoPositionRow key={`${position.type ?? 'supply'}-${position.positionId}`} position={position} />
        ))}
      </ScrollArea>
      <div className="flex items-center justify-between pt-6 pb-6">
        <span className="text-xl">Total assets in Echo:</span>
        <span className={cn('text-xl font-bold text-primary', netTotal < 0 && 'text-red-600')}>
          {formatCurrency(netTotal)}
        </span>
      </div>
    </div>
  );
}
