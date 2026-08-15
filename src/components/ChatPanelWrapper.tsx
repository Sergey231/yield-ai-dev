'use client';

import { type ReactNode, Suspense } from 'react';
import ChatPanel from './ChatPanel';

interface ChatPanelWrapperProps {
  headerActions?: ReactNode;
}

export default function ChatPanelWrapper({ headerActions }: ChatPanelWrapperProps) {
  return (
    <Suspense fallback={<div className="p-4">Loading...</div>}>
      <ChatPanel headerActions={headerActions} />
    </Suspense>
  );
}

