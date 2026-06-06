'use client';

import { useCallback, useState } from 'react';
import { useDragDrop } from '@/contexts/DragDropContext';
import { normalizeAddress } from '@/lib/utils/addressNormalization';

export interface DropAcceptToken {
  symbol: string;
  /** FA metadata object address. */
  address: string;
}

interface UseCardTokenDropOptions {
  /** Tokens this card accepts as a drop. */
  acceptedTokens: DropAcceptToken[];
  /** Called with the matched accepted token when a valid token is dropped. */
  onDrop: (token: DropAcceptToken) => void;
}

function matchToken(
  accepted: DropAcceptToken[],
  symbol: string | undefined,
  address: string | undefined
): DropAcceptToken | null {
  const normAddr = address ? normalizeAddress(address) : null;
  const lowSym = symbol?.toLowerCase();
  return (
    accepted.find(
      (t) =>
        (normAddr != null && normalizeAddress(t.address) === normAddr) ||
        (lowSym != null && t.symbol.toLowerCase() === lowSym)
    ) ?? null
  );
}

/**
 * Makes a card a native-HTML5 drop target for wallet tokens. Reads the live
 * drag payload from DragDropContext for highlight state and the dropped
 * payload from `dataTransfer` (set by TokenItem) on drop.
 *
 * Native DnD has no touch support — this is a desktop-only convenience;
 * mobile users use the card's button instead.
 */
export function useCardTokenDrop({ acceptedTokens, onDrop }: UseCardTokenDropOptions) {
  const { state, endDrag } = useDragDrop();
  const [isOver, setIsOver] = useState(false);

  const draggedMatch =
    state.dragData?.type === 'token'
      ? matchToken(acceptedTokens, state.dragData.symbol, state.dragData.address)
      : null;
  const isDraggingAccepted = draggedMatch != null;

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsOver(false), []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsOver(false);
      let matched: DropAcceptToken | null = null;
      try {
        const raw = e.dataTransfer.getData('application/json');
        if (raw) {
          const parsed = JSON.parse(raw) as {
            type?: string;
            symbol?: string;
            address?: string;
          };
          if (parsed?.type === 'token') {
            matched = matchToken(acceptedTokens, parsed.symbol, parsed.address);
          }
        }
      } catch {
        // ignore malformed payloads
      }
      endDrag();
      if (matched) onDrop(matched);
    },
    [acceptedTokens, endDrag, onDrop]
  );

  return {
    /** True while a compatible token is being dragged anywhere. */
    isDraggingAccepted,
    /** True while a compatible token is hovering this card. */
    isOver: isOver && isDraggingAccepted,
    dragHandlers: {
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  };
}
