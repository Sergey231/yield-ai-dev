"use client";

import { useEffect, useRef } from "react";
import { useNativeWalletStore } from "@/lib/stores/nativeWalletStore";

type BridgeMessage = {
  source: "yield-ai-web";
  version: 1;
  type: string;
  nonce: string | null;
  payload?: Record<string, unknown>;
  ts: number;
};

type NativeCommand = {
  type: string;
  payload?: Record<string, unknown>;
};

type WindowWithBridge = Window & {
  ReactNativeWebView?: {
    postMessage: (message: string) => void;
  };
  YieldAIBridge?: {
    post: (type: string, payload?: Record<string, unknown>) => void;
    handleNativeCommand: (command: NativeCommand) => void;
  };
};

function stringifyMessage(
  type: string,
  nonce: string | null,
  payload?: Record<string, unknown>,
) {
  const message: BridgeMessage = {
    source: "yield-ai-web",
    version: 1,
    type,
    nonce,
    payload,
    ts: Date.now(),
  };
  return JSON.stringify(message);
}

function getClickableElement(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  return target.closest("a,button,[role='button']");
}

export function WebViewBridge() {
  const sessionNonce = useRef<string | null>(null);

  useEffect(() => {
    const w = window as WindowWithBridge;
    const isInWebView = !!w.ReactNativeWebView?.postMessage;

    if (!isInWebView) {
      console.log("[Bridge] ReactNativeWebView not found — running in browser");
    }

    const postToNative = (type: string, payload?: Record<string, unknown>) => {
      if (!w.ReactNativeWebView?.postMessage) return;
      // bridge_ready is sent before nonce is known — all others require nonce
      if (type !== "bridge_ready" && !sessionNonce.current) return;
      console.log("[Bridge →RN]", type, payload ?? "");
      w.ReactNativeWebView.postMessage(
        stringifyMessage(type, sessionNonce.current, payload),
      );
    };

    const emitRouteChange = () => {
      postToNative("route_change", {
        href: window.location.href,
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
      });
    };

    const onClick = (event: MouseEvent) => {
      const element = getClickableElement(event.target);
      if (!element) return;

      const basePayload = {
        tag: element.tagName,
        id: element.id || null,
        className: element.className || null,
        text: (element.textContent || "").trim().slice(0, 140),
      };

      if (element instanceof HTMLAnchorElement) {
        postToNative("link_click", {
          ...basePayload,
          href: element.href || null,
          target: element.target || null,
        });
        return;
      }

      const action = (element as HTMLElement).dataset.action;
      if (action) {
        postToNative(action, basePayload);
        return;
      }

      postToNative("button_click", basePayload);
    };

    const onNativeCommand = (event: Event) => {
      const customEvent = event as CustomEvent<NativeCommand>;
      postToNative("native_command_received", {
        type: customEvent.detail?.type || "unknown",
      });
    };

    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    history.pushState = function pushState(...args) {
      originalPushState(...args);
      emitRouteChange();
    };

    history.replaceState = function replaceState(...args) {
      originalReplaceState(...args);
      emitRouteChange();
    };

    w.YieldAIBridge = {
      post: postToNative,
      handleNativeCommand: (command: NativeCommand) => {
        if (command.type === "native_ready") {
          const nonce = command.payload?.nonce;
          if (typeof nonce === "string") {
            sessionNonce.current = nonce;
            console.log("[Bridge] Session nonce received");
          }
          // emit initial route after handshake completes
          emitRouteChange();
          return;
        }

        console.log("[Bridge ←RN]", command.type, command.payload ?? "");

        // Keep injected wallet state in sync (WebView mode).
        if (command.type === "wallet_connected") {
          const chain = command.payload?.chain;
          const address = command.payload?.address;
          const walletId = command.payload?.walletId;
          if (
            (chain === "aptos" || chain === "solana") &&
            typeof address === "string" &&
            address.trim()
          ) {
            useNativeWalletStore
              .getState()
              .setConnected({ chain, address, walletId: typeof walletId === "string" ? walletId : null });

            // Notify the app to refresh read-only portfolio/positions for the injected address.
            window.dispatchEvent(
              new CustomEvent("yieldai:wallet-changed", {
                detail: { chain, address, walletId: typeof walletId === "string" ? walletId : null },
              }),
            );
          }
        } else if (command.type === "wallet_disconnected") {
          const chain = command.payload?.chain;
          if (chain === "aptos" || chain === "solana") {
            useNativeWalletStore.getState().setDisconnected(chain);
            window.dispatchEvent(
              new CustomEvent("yieldai:wallet-changed", {
                detail: { chain, address: null, walletId: null },
              }),
            );
          }
        }

        postToNative("web_log", {
          message: `[Bridge ←RN] ${command.type}`,
          payload: command.payload ?? null,
        });
        window.dispatchEvent(
          new CustomEvent<NativeCommand>("yieldai:native-command", {
            detail: command,
          }),
        );
      },
    };

    postToNative("bridge_ready", {
      userAgent: navigator.userAgent,
      href: window.location.href,
    });

    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", emitRouteChange);
    window.addEventListener("hashchange", emitRouteChange);
    window.addEventListener("yieldai:native-command", onNativeCommand);

    return () => {
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;

      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", emitRouteChange);
      window.removeEventListener("hashchange", emitRouteChange);
      window.removeEventListener("yieldai:native-command", onNativeCommand);
    };
  }, []);

  return null;
}
