import "./globals.css";
import "@radix-ui/themes/styles.css";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { WalletProvider } from "@/lib/WalletProvider";
import { AppCornerLinks } from "@/components/legal/AppCornerLinks";
import { SolanaProvider } from "@/lib/SolanaProvider";
import { WalletDataProvider } from "@/contexts/WalletContext";
import { ProtocolProvider } from "@/lib/contexts/ProtocolContext";
import { DragDropProvider } from "@/contexts/DragDropContext";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Analytics } from "@vercel/analytics/next";
import { AptosClientProvider } from "@/contexts/AptosClientContext";
import { ThemeProviderWrapper } from "@/components/ThemeProviderWrapper";
import { SolanaWalletRestore } from "@/components/SolanaWalletRestore";
import { QueryProvider } from "@/lib/query/QueryProvider";
import { WebViewBridge } from "@/components/mobile/WebViewBridge";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Yield AI",
  description: "AI-powered yield farming platform",
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
    other: [
      {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        url: "/favicon-32x32.png",
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "16x16",
        url: "/favicon-16x16.png",
      },
      {
        rel: "android-chrome-192x192",
        url: "/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        rel: "android-chrome-512x512",
        url: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1.0,
  maximumScale: 1.0,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <WebViewBridge />
        <QueryProvider>
          <ThemeProviderWrapper>
            <AptosClientProvider>
              <WalletProvider>
                <SolanaProvider>
                  <SolanaWalletRestore>
                  <WalletDataProvider>
                    <ProtocolProvider>
                    <DragDropProvider>
                      <TooltipProvider>
                        {/*<AlphaBanner />*/}
                        {children}
                        <AppCornerLinks />
                      </TooltipProvider>
                    </DragDropProvider>
                  </ProtocolProvider>
                </WalletDataProvider>
                </SolanaWalletRestore>
              </SolanaProvider>
              <Toaster />
            </WalletProvider>
          </AptosClientProvider>
        </ThemeProviderWrapper>
        </QueryProvider>
        <Analytics />
      </body>
    </html>
  );
}
