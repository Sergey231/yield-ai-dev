# Handoff: Swap Modal — Yield AI

## Overview
This is a high-fidelity interactive prototype of the **Swap Tokens modal** for the Yield AI app on Aptos. It covers the full swap flow: token selection, amount input, quote fetching, swap execution, and success/error states.

The app is gasless — users don't need APT for gas (paid by Gas Station). The modal also supports xStocks (synthetic stocks on Solana).

## About the Design Files
The files in this bundle are **HTML/React design prototypes** — they show intended look, behavior, and all states. Your task is to **recreate these designs in the existing codebase** using its frameworks, component libraries, and patterns. Do not ship the HTML directly.

Reference file: `Swap Modal.html` — open it in any browser to interact with the full prototype.

## Fidelity
**High-fidelity.** Pixel-perfect mockup with final colors, typography, spacing, and all interactions. Recreate as closely as possible.

---

## Screen: Swap Modal

### Layout
- Modal: `max-width: 440px`, centered with dark backdrop (`rgba(0,0,0,0.32)` + `backdrop-filter: blur(4px)`)
- Border radius: `16px`, box shadow: `0 24px 64px rgba(0,0,0,0.12)`
- Internal padding: `20px` horizontal, `16px` vertical between sections

### Header
- Left: logo circle `28px` (dark bg, "Y" white) + title "Swap Tokens" `16px / 600`
- Right: network badge (green dot + "Aptos") + settings icon + close icon
- Network badge: `background: #faf9f7`, `border: 1.5px solid #e8e6e1`, `border-radius: 6px`, `padding: 3px 8px`, `font-size: 11.5px`

### Token Input Cards ("You pay" / "You receive")
Each card:
- `border: 1.5px solid #e8e6e1`, `border-radius: 10px`, `padding: 14px 16px`
- Label: `11px / 500 / uppercase / letter-spacing: 0.6px`, color `#8a8680`
- **Token selector button**: `background: #faf9f7`, `border: 1.5px solid #e8e6e1`, `border-radius: 8px`, `padding: 8px 10px 8px 8px`
  - Token logo: `24px` circle with token color at 13% opacity + colored border at 27% opacity + 2-letter initials
  - Symbol: `14px / 600`
  - Chevron icon: `12px`
- **Amount input**: `font-size: 24px / 600`, right-aligned, `letter-spacing: -0.5px`, no border, transparent bg
- **USD sub-label**: `12px`, color `#8a8680`, right-aligned
- **Balance row** (bottom, separated by `1px solid #e8e6e1`):
  - Left: "Balance: {amount} {symbol} ≈ ${usd}"
  - Right: `25%` / `50%` / `Max` buttons — `border: 1.5px solid #e8e6e1`, `border-radius: 5px`, `padding: 3px 8px`, `font-size: 11px / 500`
- "You receive" card uses `border-style: dashed` until quote is ready

### Swap Direction Button
- `36px` circle, centered between cards, `border: 2px solid #e8e6e1`
- On hover: border turns `#141210`, rotates `180deg` with `transition: 0.2s`
- Clicking it swaps the two tokens

### Quote Details Panel (shown after quote)
- `background: #faf9f7`, `border: 1.5px solid #e8e6e1`, `border-radius: 10px`, `padding: 12px 14px`
- Rows: Rate, Min received, Price impact, Slippage · Fee
- Price impact green (`#16a34a`) if < 1%, amber (`#d97706`) if ≥ 1%
- Appears with `fadeIn` animation (opacity 0→1, translateY -4px→0, 200ms)

### Action Button
- Full width, `padding: 14px`, `border-radius: 10px`, `font-size: 15px / 600`
- Default (idle): dark bg `#141210`, white text — label "Get Quote"
- After quote: label "Execute Swap"
- Loading states: show spinner + label "Getting Quote…" / "Executing…"
- Disabled: `opacity: 0.4`
- Success: `background: #16a34a`

### Success Card
- `border: 1.5px solid #bbf7d0`, `background: #f0fdf4`, `border-radius: 10px`
- Shows: "Gasless swap executed!" header with green check icon
- Received amount (large `20px / 700`) + USD value
- Gas fee row: "Paid by Gas Station" in green
- Tx hash with copy + external link buttons

### Slippage Settings Panel (toggled via settings icon)
- Options: 0.5% / 1.0% / 2.0% / 5.0%
- Active option: `background: #141210`, `color: white`

### Footer
- `font-size: 11.5px`, `color: #b5b0a8`, centered
- Text: "Gasless · no APT required for gas · 0.25% swap fee"

---

## Token Picker Overlay

Slides up over the modal (`position: absolute, inset: 0`), `animation: slideUp 220ms cubic-bezier(0.4,0,0.2,1)`.

### Structure
1. **Header**: title ("You pay" / "You receive") + close button
2. **Search input**: `padding: 9px 12px 9px 36px`, search icon absolutely positioned left
3. **Category tabs**: horizontal scrollable row
4. **Token list**: scrollable

### Category Tabs
- `All` / `Stablecoins` / `Liquid Staking` / `xStocks` / `Layer 1`
- Only show tabs that have > 0 tokens
- Tab: `padding: 5px 10px`, `border-radius: 7px`, `border: 1.5px solid #e8e6e1`
- Active tab: `background: #141210`, `color: white`, `border-color: #141210`
- Count badge on each tab (smaller, opacity 0.5–0.7)

### Token List Sections
- "Your wallet" section — tokens with balance > 0
- "Other tokens" / "All tokens" section — tokens with balance = 0

### Token Row
- Logo: `36px` circle (same color system as selector)
- Symbol `14px / 600` + category badge + chain badge
- Name `12px / #8a8680`
- Right: balance amount + USD (for wallet tokens); price per token (for zero-balance tokens)
- Selected: `background: #f8f7f5`, border `1.5px solid #e8e6e1`, green checkmark on right
- Excluded token (already selected on other side): `opacity: 0.4`, `pointer-events: none`

### Category Badges (on token rows)
| Category | Label | Color |
|---|---|---|
| stablecoin | `$ Stable` | `#16a34a` |
| lst | `⚡ LST` | `#2563eb` |
| xstock | `📈 Stock` | `#d97706` |
| base | `L1` | `#6b7280` |

Badge style: `font-size: 10px`, `font-weight: 500`, colored bg at 8% opacity, colored border at 16% opacity, `border-radius: 4px`, `padding: 1px 5px`

### Chain Badges
| Chain | Color |
|---|---|
| Aptos | `#8B5CF6` |
| Solana | `#9945FF` |

Same badge style as category badges.

### xStocks Disclaimer
When xStocks tab is active, show a warning notice:
> ⚠️ Synthetic stocks on Solana. Prices track real-time market data. Trading available 24/7.

Style: `background: #fffbeb`, `border: 1px solid #fde68a`, `color: #92400e`, `border-radius: 8px`, `padding: 8px 10px`, `font-size: 11.5px`

---

## Flow States

| State | Description |
|---|---|
| `idle` | Both tokens selected (or not), amount input empty or filled, no quote |
| `quoting` | "Getting Quote…" spinner on button, "Quoting…" pulse animation in "You receive" field |
| `quoted` | Quote details panel visible, "You receive" shows amount, button says "Execute Swap" + "Refresh Quote" secondary button |
| `executing` | "Executing…" spinner on button |
| `success` | Success card visible, button says "Swap Again" with green background |
| `error` | Error card with message, button resets |

**Button disabled when**: no amount entered, amount > balance, or state is loading.

---

## Design Tokens

### Colors
```
--bg:           #f5f4f2   (page background)
--modal-bg:     #ffffff
--border:       #e8e6e1
--border-focus: #c8c4bc
--text:         #141210
--text-muted:   #8a8680
--text-subtle:  #b5b0a8
--input-bg:     #faf9f7
--token-hover:  #f8f7f5
--success:      #16a34a
--success-bg:   #f0fdf4
--error:        #dc2626
--warning:      #d97706
```

### Dark Mode (same structure, different values)
```
--bg:           #0f0e0c
--modal-bg:     #1a1917
--border:       #2e2c28
--border-focus: #4a4740
--text:         #f5f3ef
--text-muted:   #8a8580
--text-subtle:  #524f4a
--input-bg:     #141312
--token-hover:  #242220
--success-bg:   #0f1f13
```

### Typography
- Font: **Geist** (fallback: system-ui, -apple-system)
- Modal title: `16px / 600 / letter-spacing: -0.3px`
- Amount input: `24px / 600 / letter-spacing: -0.5px`
- Body: `13–14px / 400–500`
- Labels: `11–12px / 500 / uppercase`

### Spacing
- Modal padding: `20px`
- Card padding: `14px 16px`
- Gap between cards: `4px` (swap button overlaps with `-2px` negative margin)
- Border radius modal: `16px`
- Border radius cards/buttons: `10px`
- Border radius token selector: `8px`

### Animations
- Quote details appear: `fadeIn` 200ms — `opacity 0→1, translateY -4px→0`
- Token picker slides up: `slideUp` 220ms `cubic-bezier(0.4,0,0.2,1)`
- Swap button hover: `transform: rotate(180deg)` 200ms
- Loading pulse: `opacity 1→0.4→1` 1500ms infinite
- Spinner: `rotate(360deg)` 700ms linear infinite

---

## Token Data Structure

```typescript
interface Token {
  id: string;
  symbol: string;         // e.g. "stkAPT"
  name: string;           // e.g. "Staked Aptos"
  color: string;          // hex, for logo placeholder
  price: number;          // USD price
  decimals: number;       // 6 or 8 or 9
  balance: number;        // user's wallet balance
  category: 'stablecoin' | 'lst' | 'xstock' | 'base';
  chain: 'aptos' | 'solana';
}
```

### Token List (mock data from prototype)
| Symbol | Name | Category | Chain | Price |
|---|---|---|---|---|
| USDC | USD Coin | stablecoin | aptos | $1.00 |
| stkAPT | Staked Aptos | lst | aptos | $1.04 |
| amAPT | Amnis APT | lst | aptos | $6.97 |
| APT | Aptos | base | aptos | $0.96 |
| TruAPT | Trufin APT | lst | aptos | $0.97 |
| USDt | Tether USD | stablecoin | aptos | $1.00 |
| WBTC | Wrapped Bitcoin | base | aptos | $84,200 |
| WETH | Wrapped Ethereum | base | aptos | $3,180 |
| sthAPT | Staked thAPT | lst | aptos | $0.94 |
| thAPT | Thala APT | lst | aptos | $0.95 |
| goAPT | Tortuga APT | lst | aptos | $0.96 |
| USD1 | World Liberty USD | stablecoin | aptos | $1.00 |
| xAAPL | Apple Inc. | xstock | solana | $207.40 |
| xTSLA | Tesla Inc. | xstock | solana | $248.10 |
| xNVDA | NVIDIA Corp. | xstock | solana | $876.30 |
| xMSFT | Microsoft Corp. | xstock | solana | $415.80 |
| xGOOG | Alphabet Inc. | xstock | solana | $173.50 |
| xSPY | S&P 500 ETF | xstock | solana | $538.20 |
| xQQQ | Nasdaq-100 ETF | xstock | solana | $462.70 |

---

## Key Business Logic

1. **Quote flow**: user enters amount → clicks "Get Quote" → simulate/fetch rate → show quote details → "Execute Swap"
2. **Rate formula**: `toAmount = fromAmount * (fromToken.price / toToken.price) * 0.9975`
3. **Min received**: `toAmount * (1 - slippage/100)`
4. **Fee**: 0.25% of input amount in USD
5. **Gasless**: gas is paid by Gas Station — never charge APT for gas
6. **Validation**: disable button if `amount > balance` OR `amount <= 0` OR tokens not selected
7. **Swap direction**: clicking ↕ button swaps fromToken ↔ toToken, sets amount to previous quote output
8. **Slippage options**: 0.5% (default), 1.0%, 2.0%, 5.0%

---

## Files in This Package
- `Swap Modal.html` — fully interactive prototype (open in browser)
- `README.md` — this document
