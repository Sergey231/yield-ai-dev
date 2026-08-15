'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { PanelRightClose, PanelRightOpen, Pin, Wrench, X } from 'lucide-react';
import ChatPanelWrapper from '@/components/ChatPanelWrapper';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'yield-ai:desktop-tools-pinned';
const WIDE_DESKTOP_QUERY = '(min-width: 1440px)';

function readDefaultPinned() {
  if (typeof window === 'undefined') return true;

  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === 'true') return true;
  if (saved === 'false') return false;

  return window.matchMedia(WIDE_DESKTOP_QUERY).matches;
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          title={label}
          onClick={onClick}
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

export default function DesktopToolsPanel() {
  const [isPinned, setIsPinned] = useState(true);
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const [hasLoadedPreference, setHasLoadedPreference] = useState(false);

  useEffect(() => {
    setIsPinned(readDefaultPinned());
    setHasLoadedPreference(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedPreference) return;
    window.localStorage.setItem(STORAGE_KEY, String(isPinned));
    if (isPinned) setIsOverlayOpen(false);
  }, [hasLoadedPreference, isPinned]);

  const pinnedActions = (
    <IconAction label="Collapse Tools" onClick={() => setIsPinned(false)}>
      <PanelRightClose className="h-4 w-4" />
    </IconAction>
  );

  const overlayActions = (
    <>
      <IconAction label="Pin Tools" onClick={() => setIsPinned(true)}>
        <Pin className="h-4 w-4" />
      </IconAction>
      <IconAction label="Close Tools" onClick={() => setIsOverlayOpen(false)}>
        <X className="h-4 w-4" />
      </IconAction>
    </>
  );

  return (
    <>
      <aside
        className={cn(
          'relative z-20 hidden h-full shrink-0 border-l bg-background transition-[width] duration-200 md:block',
          isPinned ? 'w-[300px] 2xl:w-[340px]' : 'w-14'
        )}
      >
        {isPinned ? (
          <div className="h-full overflow-y-auto">
            <ChatPanelWrapper headerActions={pinnedActions} />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center gap-3 px-2 pb-20 pt-3">
            <IconAction label="Open Tools" onClick={() => setIsOverlayOpen(true)}>
              <Wrench className="h-4 w-4" />
            </IconAction>
            <button
              type="button"
              title="Open Tools"
              onClick={() => setIsOverlayOpen(true)}
              className="flex min-h-24 w-full items-center justify-center rounded-md py-2 text-xs font-medium tracking-wide text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span className="select-none [writing-mode:vertical-rl] rotate-180">Tools</span>
            </button>
            <div className="mt-auto">
              <IconAction label="Pin Tools" onClick={() => setIsPinned(true)}>
                <PanelRightOpen className="h-4 w-4" />
              </IconAction>
            </div>
          </div>
        )}
      </aside>

      {!isPinned && isOverlayOpen ? (
        <div className="absolute inset-0 z-30 hidden md:block">
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-transparent"
            aria-label="Close Tools overlay"
            onClick={() => setIsOverlayOpen(false)}
          />
          <aside className="absolute inset-y-0 right-14 w-[320px] max-w-[calc(100%-3.5rem)] border-l bg-background shadow-xl">
            <div className="h-full overflow-y-auto">
              <ChatPanelWrapper headerActions={overlayActions} />
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
