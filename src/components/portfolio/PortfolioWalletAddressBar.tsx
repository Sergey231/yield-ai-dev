"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Copy, ExternalLink, SendHorizontal } from "lucide-react";

function formatShort(addr: string) {
  if (!addr || addr.length < 16) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-8)}`;
}

export interface PortfolioWalletAddressBarProps {
  /** Canonical address for explorer / copy (resolved) */
  resolvedAddress: string;
  explorerUrl: string;
  explorerOpenLabel: string;
  copyLabel?: string;
  editable: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  onApply: () => void;
  placeholder: string;
  /** Tooltip for the apply (send) action */
  applyLabel?: string;
}

export function PortfolioWalletAddressBar({
  resolvedAddress,
  explorerUrl,
  explorerOpenLabel,
  copyLabel = "Copy address",
  editable,
  draft,
  onDraftChange,
  onApply,
  placeholder,
  applyLabel = "Load portfolio for this address",
}: PortfolioWalletAddressBarProps) {
  const openExplorer = () => {
    if (explorerUrl) window.open(explorerUrl, "_blank");
  };

  const copyResolved = () => {
    if (resolvedAddress) void navigator.clipboard.writeText(resolvedAddress);
  };

  const canApply = editable && draft.trim().length > 0;

  return (
    <div className="flex h-9 min-h-9 w-full items-center gap-1 rounded-md border px-2 py-0">
      {editable ? (
        <Input
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (draft.trim()) onApply();
            }
          }}
          placeholder={placeholder}
          className="h-8 flex-1 min-w-0 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm"
          aria-label={placeholder}
        />
      ) : (
        <span className="font-mono text-sm truncate flex-1 min-w-0 px-1">
          {formatShort(resolvedAddress)}
        </span>
      )}
      <div className="flex shrink-0 items-center gap-0.5">
        {editable ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (draft.trim()) onApply();
                }}
                disabled={!canApply}
                className="h-8 w-8 p-0"
                aria-label={applyLabel}
              >
                <SendHorizontal className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{applyLabel}</p>
            </TooltipContent>
          </Tooltip>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={openExplorer}
              disabled={!explorerUrl}
              className="h-8 w-8 p-0"
              aria-label={`Open in new tab — ${explorerOpenLabel}`}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{explorerOpenLabel}</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={copyResolved}
              disabled={!resolvedAddress}
              className="h-8 w-8 p-0"
              title={copyLabel}
              aria-label={copyLabel}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{copyLabel}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

export { formatShort };
