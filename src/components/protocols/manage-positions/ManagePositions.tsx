import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Protocol } from "@/lib/protocols/getProtocolsList";
import Image from "next/image";
import { EchelonPositions } from "./protocols/EchelonPositions";
import { JoulePositions } from "./protocols/JoulePositions";
import { HyperionPositions } from "./protocols/HyperionPositions";
import { TappPositions } from "./protocols/TappPositions";
import { MesoPositions } from "./protocols/MesoPositions";
import { AuroPositions } from "./protocols/AuroPositions";
import { AmnisPositions } from "./protocols/AmnisPositions";
import { EarniumPositionsManaging } from "./protocols/EarniumPositions";
import { AavePositions } from "./protocols/AavePositions";
import { MoarPositions } from "./protocols/MoarPositions";
import { AptreePositions } from "./protocols/AptreePositions";
import { JupiterPositions } from "./protocols/JupiterPositions";
import { KaminoPositions } from "./protocols/KaminoPositions";
import { MeteoraPositions } from "./protocols/MeteoraPositions";
import { RaydiumPositions } from "./protocols/RaydiumPositions";
import { OrcaPositions } from "./protocols/OrcaPositions";
import { TramplinPositions } from "./protocols/TramplinPositions";
import { ThalaPositions } from "./protocols/ThalaPositions";
import { EchoPositions } from "./protocols/EchoPositions";
import { DecibelPositions } from "./protocols/DecibelPositions";
import { YieldAIPositions } from "./protocols/YieldAIPositions";
import { RefreshCw, Info, ExternalLink, Gift, X } from "lucide-react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useState } from "react";
import { useToast } from "@/components/ui/use-toast";
import { ProtocolSocialLinks } from "@/components/ui/protocol-social-links";
import { AirdropInfoTooltip } from "@/components/ui/airdrop-info-tooltip";
import { useSolanaPortfolio } from "@/hooks/useSolanaPortfolio";

interface ManagePositionsProps {
  protocol: Protocol;
  onClose: () => void;
}

export function ManagePositions({ protocol, onClose }: ManagePositionsProps) {
  const { account } = useWallet();
  const { protocolsAddress: solanaProtocolsAddress } = useSolanaPortfolio();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { toast } = useToast();

  const handleRefresh = async () => {
    const protocolNameLower = protocol.name.toLowerCase();
    const isJupiter = protocolNameLower.includes('jupiter');
    const isKamino = protocolNameLower.includes('kamino');
    const isMeteora = protocolNameLower.includes('meteora');
    const isRaydium = protocolNameLower.includes('raydium');
    const isOrca = protocolNameLower.includes('orca');
    const isTramplin = protocolNameLower.includes('tramplin');
    const isSolanaProtocol = isJupiter || isKamino || isMeteora || isRaydium || isOrca || isTramplin;
    if (!account?.address && !isSolanaProtocol) return;
    if (isSolanaProtocol && !solanaProtocolsAddress) return;
    
    try {
      setIsRefreshing(true);

      // Специальная обработка для разных протоколов
      let apiPath = protocol.name.toLowerCase();
      let endpoint = 'userPositions';
      
      if (protocol.name.toLowerCase().includes('tapp')) {
        apiPath = 'tapp';
      } else if (protocol.name.toLowerCase().includes('auro')) {
        apiPath = 'auro';
      } else if (protocol.name.toLowerCase().includes('meso')) {
        apiPath = 'meso';
      } else if (protocol.name.toLowerCase().includes('amnis')) {
        apiPath = 'amnis';
      } else if (protocol.name.toLowerCase().includes('aave')) {
        apiPath = 'aave';
        endpoint = 'positions'; // AAVE использует endpoint 'positions' вместо 'userPositions'
      } else if (protocol.name.toLowerCase().includes('moar')) {
        // For Moar we now rely entirely on TanStack Query hooks + cache invalidation.
        // Just dispatch the refresh event; protocol components will invalidate and refetch.
        apiPath = 'moar';
        endpoint = 'userPositions';

        window.dispatchEvent(new CustomEvent('refreshPositions', { 
          detail: { protocol: apiPath }
        }));

        toast({
          title: "Success",
          description: `${protocol.name} positions refreshed successfully`,
        });

        return;
      } else if (protocol.name.toLowerCase().includes('earnium')) {
        apiPath = 'earnium';
        endpoint = 'userPositions';
      } else if (protocol.name.toLowerCase().includes('echo')) {
        apiPath = 'echo';
        endpoint = 'userPositions';
      } else if (protocol.key === 'decibel' || protocol.name.toLowerCase().includes('decibel')) {
        apiPath = 'decibel';
        endpoint = 'userPositions';
      } else if (protocol.key === 'aptree' || protocol.name.toLowerCase().includes('aptree')) {
        apiPath = 'aptree';
        endpoint = 'userPositions';
      } else if (protocol.key === 'yield-ai' || protocol.name.toLowerCase().includes('ai agent')) {
        apiPath = 'yield-ai';
        endpoint = 'safes';
        window.dispatchEvent(new CustomEvent('refreshPositions', { detail: { protocol: 'yield-ai' } }));
        toast({
          title: "Success",
          description: `${protocol.name} positions refreshed successfully`,
        });
        return;
      } else if (protocol.name.toLowerCase().includes('jupiter')) {
        apiPath = 'jupiter';
        endpoint = 'userPositions';
      } else if (protocol.name.toLowerCase().includes('kamino')) {
        apiPath = 'kamino';
        endpoint = 'userPositions';
      } else if (protocol.name.toLowerCase().includes('meteora')) {
        apiPath = 'meteora';
        endpoint = 'userPositions';
      } else if (protocol.name.toLowerCase().includes('raydium')) {
        apiPath = 'raydium';
        endpoint = 'userPositions';
      } else if (protocol.name.toLowerCase().includes('orca')) {
        apiPath = 'orca';
        endpoint = 'userPositions';
      } else if (protocol.name.toLowerCase().includes('tramplin')) {
        apiPath = 'tramplin';
        endpoint = 'userPositions';
      }
      
      const refreshAddress = isSolanaProtocol
        ? String(solanaProtocolsAddress || "")
        : String(account?.address || "");
      const response = await fetch(`/api/protocols/${apiPath}/${endpoint}?address=${encodeURIComponent(refreshAddress)}`);
      
      if (!response.ok) {
        throw new Error(`API returned status ${response.status}`);
      }
      
      // Обновляем данные в компоненте протокола
      const data = await response.json();
      if (data.success) {
        console.log('ManagePositions - Dispatching refreshPositions event:', { 
          protocol: apiPath, 
          data: data.data,
          eventDetail: { protocol: apiPath, data: data.data }
        });
        
        // Вызываем обновление через событие
        window.dispatchEvent(new CustomEvent('refreshPositions', { 
          detail: { protocol: apiPath, data: data.data }
        }));
        
        toast({
          title: "Success",
          description: `${protocol.name} positions refreshed successfully`,
        });
      } else {
        throw new Error('Failed to refresh positions');
      }
    } catch (error) {
      console.error('Error refreshing positions:', error);
      toast({
        title: "Error",
        description: `Failed to refresh ${protocol.name} positions`,
        variant: "destructive"
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const renderProtocolContent = () => {
    const protocolName = protocol.name.toLowerCase();
    
    // Специальная обработка для Tapp Exchange
    if (protocolName.includes('tapp')) {
      return <TappPositions />;
    }
    
    switch (protocolName) {
      case 'joule':
        return <JoulePositions />;
      case 'echelon':
        return <EchelonPositions />;
      case 'hyperion':
        return <HyperionPositions />;
      case 'meso finance':
        return <MesoPositions />;
      case 'auro finance':
        return <AuroPositions />;
      case 'amnis finance':
        return <AmnisPositions />;
      case 'earnium':
        return <EarniumPositionsManaging />;
      case 'aave':
        return <AavePositions />;
      case 'moar market':
        return <MoarPositions />;
      case 'aptree':
        return <AptreePositions />;
      case 'jupiter':
        return <JupiterPositions />;
      case 'kamino':
        return <KaminoPositions />;
      case 'meteora':
        return <MeteoraPositions />;
      case 'raydium':
        return <RaydiumPositions />;
      case 'orca':
        return <OrcaPositions />;
      case 'tramplin':
        return <TramplinPositions />;
      case 'thala':
        return <ThalaPositions />;
      case 'echo protocol':
        return <EchoPositions />;
      case 'decibel':
        return <DecibelPositions />;
      case 'ai agent':
        return <YieldAIPositions />;
      case 'aptree':
        return <AptreePositions />;
      default:
        return (
          <div className="text-sm text-muted-foreground">
            Managing positions for {protocol.name}
          </div>
        );
    }
  };

  return (
    <Card className="mb-6 w-full min-w-0 max-w-full">
      <CardHeader className="flex flex-col gap-0 space-y-0 px-3 pb-2 pt-3 sm:pt-6">
        <div className="flex w-full min-w-0 flex-row items-center justify-between gap-2 sm:gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
            {protocol.logoUrl != null && protocol.logoUrl !== "" ? (
              <Image
                src={protocol.logoUrl}
                alt={protocol.name}
                width={32}
                height={32}
                className="h-6 w-6 shrink-0 object-contain sm:h-8 sm:w-8"
                unoptimized
              />
            ) : null}
            {/* Мобилка: только название протокола */}
            <span className="min-w-0 truncate text-base font-bold leading-tight sm:hidden">{protocol.name}</span>
            <CardTitle className="hidden min-w-0 flex-1 flex-nowrap items-center gap-1.5 text-base font-bold leading-tight sm:flex sm:gap-2 sm:text-xl">
              <span className="min-w-0 truncate">{protocol.name} positions</span>
              {protocol.airdropInfo != null ? (
                <AirdropInfoTooltip airdropInfo={protocol.airdropInfo} size="sm">
                  <div className="flex h-6 w-6 shrink-0 cursor-help items-center justify-center rounded-full bg-muted transition-colors hover:bg-muted/80 sm:h-8 sm:w-8">
                    <Gift className="h-2.5 w-2.5 text-muted-foreground sm:h-3.5 sm:w-3.5" />
                  </div>
                </AirdropInfoTooltip>
              ) : null}
            </CardTitle>
          </div>
          <div className="flex shrink-0 flex-row items-center justify-end gap-0.5 sm:gap-1">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-foreground sm:h-8 sm:w-8"
                >
                  <Info className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-80 max-w-[90vw] p-4"
                side="left"
                sideOffset={10}
                align="start"
                avoidCollisions={true}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-sm">{protocol.name}</h4>
                    <span className="text-xs px-2 py-1 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded-full">{protocol.category}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{protocol.description}</p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs text-foreground border-border hover:bg-accent hover:text-accent-foreground"
                      onClick={() => window.open(protocol.url, '_blank')}
                    >
                      Go to app
                      <ExternalLink className="h-3 w-3 ml-1" />
                    </Button>
                    <ProtocolSocialLinks
                      socialMedia={protocol.socialMedia}
                      size="sm"
                      disableTooltips={true}
                    />
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-foreground h-8 w-8 shrink-0 p-0 sm:h-8 sm:w-8 sm:p-0"
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${isRefreshing ? "animate-spin" : ""}`} />
                    <span className="sr-only">Refresh positions</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Refresh positions</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground h-8 w-8 shrink-0 p-0 sm:h-8 sm:w-auto sm:px-3 sm:text-sm"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5 sm:hidden" aria-hidden strokeWidth={2} />
              <span className="hidden text-xs font-medium sm:inline">Close</span>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-3">
        {renderProtocolContent()}
      </CardContent>
    </Card>
  );
} 
