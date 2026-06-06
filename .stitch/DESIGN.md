---
name: Yield AI
colors:
  surface: '#fcfcfc'
  surface-dim: '#e5e5e5'
  surface-bright: '#ffffff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f5f5'
  surface-container: '#f5f5f5'
  surface-container-high: '#f0f0f0'
  surface-container-highest: '#e5e5e5'
  on-surface: '#262626'
  on-surface-variant: '#737373'
  inverse-surface: '#1f1f1f'
  inverse-on-surface: '#f2f2f2'
  outline: '#e5e5e5'
  outline-variant: '#d4d4d4'
  surface-tint: '#333333'
  primary: '#333333'
  on-primary: '#fcfcfc'
  primary-container: '#262626'
  on-primary-container: '#a3a3a3'
  inverse-primary: '#f2f2f2'
  secondary: '#f5f5f5'
  on-secondary: '#262626'
  secondary-container: '#f0f0f0'
  on-secondary-container: '#525252'
  tertiary: '#333333'
  on-tertiary: '#fcfcfc'
  tertiary-container: '#2e2e2e'
  on-tertiary-container: '#a3a3a3'
  error: '#d14530'
  on-error: '#ffffff'
  error-container: '#fef2f0'
  on-error-container: '#9a3412'
  primary-fixed: '#f5f5f5'
  primary-fixed-dim: '#e5e5e5'
  on-primary-fixed: '#262626'
  on-primary-fixed-variant: '#525252'
  secondary-fixed: '#f5f5f5'
  secondary-fixed-dim: '#e5e5e5'
  on-secondary-fixed: '#262626'
  on-secondary-fixed-variant: '#525252'
  tertiary-fixed: '#f0f0f0'
  tertiary-fixed-dim: '#d4d4d4'
  on-tertiary-fixed: '#1f1f1f'
  on-tertiary-fixed-variant: '#525252'
  background: '#fcfcfc'
  on-background: '#262626'
  surface-variant: '#f5f5f5'
  success: '#333333'
  success-foreground: '#fcfcfc'
  success-muted: '#737373'
  warning: '#d4a72c'
  warning-foreground: '#262626'
  warning-muted: '#fef9e8'
  chart-1: '#c8762e'
  chart-2: '#3d8f8a'
  chart-3: '#4a5f7a'
  chart-4: '#d4b84a'
  chart-5: '#c9a03d'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: '-0.01em'
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: '0'
  title-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: '0'
  body-base:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: '0'
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: '0'
  body-bold:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: '0'
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: '0'
  stat-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '500'
    lineHeight: 28px
    letterSpacing: '0'
  mono-sm:
    fontFamily: ui-monospace
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: '0'
rounded:
  sm: 0.375rem
  DEFAULT: 0.625rem
  md: 0.625rem
  lg: 0.625rem
  xl: 0.875rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 24px
---

# Design System: Yield AI

**Project ID:** yield-ai  
**Source:** `src/` (Next.js 15, React 19, Tailwind CSS v4, shadcn/ui, Radix UI)

## 1. Visual Theme & Atmosphere

Yield AI presents as a **professional fintech dashboard** for cross-chain yield farming (Aptos and Solana). The interface prioritizes clarity, trust, and data density without visual noise. Light mode uses an almost-white canvas with near-black accents; dark mode inverts to charcoal surfaces with high-luminance text and controls. The palette is deliberately **achromatic** (OKLCH with zero chroma for neutrals), so color appears only where it carries meaning—charts, protocol badges, success/warning/error states, and marketing accents.

Whitespace is **moderate**: cards use generous horizontal padding (`px-6`) but compact vertical rhythm (`py-2` on cards). The product feels **mobile-first**: full viewport height, fixed bottom navigation, 44px minimum touch targets, and 16px input font size to prevent iOS zoom. On desktop (`md: 768px+`), scrolling is restored and layouts expand to two-column grids with `gap-8`. The overall mood is **clean, modern, and institutional**—closer to a trading terminal than a playful consumer app.

## 2. Color Palette & Roles

Tokens are defined in `src/app/globals.css` using **OKLCH** CSS variables, bridged to Tailwind via `@theme inline`. Light and dark themes share the same semantic names.

### Primary Foundation

| Descriptive name | Light (approx.) | Dark (approx.) | Role |
|:---|:---|:---|:---|
| **Canvas White** | `#fcfcfc` (`--background`) | `#1f1f1f` | Page background, mobile nav bar |
| **Pure Surface** | `#ffffff` (`--card`) | `#2e2e2e` | Cards, popovers, elevated panels |
| **Soft Mist** | `#f5f5f5` (`--secondary`, `--muted`, `--accent`) | `#404040` / `#383838` | Secondary fills, hover states, table stripes |
| **Whisper Border** | `#e5e5e5` (`--border`) | `#4d4d4d` | Card borders, dividers, inputs |

### Accent & Interactive

| Descriptive name | Light | Dark | Role |
|:---|:---|:---|:---|
| **Ink Primary** | `#333333` (`--primary`) | `#f2f2f2` | Primary buttons, focus rings, success token (monochrome) |
| **Inverse on Ink** | `#fcfcfc` (`--primary-foreground`) | `#1f1f1f` | Text on primary buttons |
| **Focus Halo** | `#333333` at 50% ring (`ring-[3px]`) | `#f2f2f2` | Focus-visible on inputs and buttons |

Comments in source explicitly describe **"High contrast monochrome"** for accents in both themes.

### Typography & Text Hierarchy

| Descriptive name | Light | Dark | Role |
|:---|:---|:---|:---|
| **Charcoal Body** | `#262626` (`--foreground`) | `#f2f2f2` | Headings, body, card titles |
| **Slate Muted** | `#737373` (`--muted-foreground`) | `#a6a6a6` | Descriptions, labels, helper text |

### Functional States

| Descriptive name | Value | Role |
|:---|:---|:---|
| **Coral Alert** | `oklch(0.55 0.2 25)` ≈ `#d14530` (`--destructive`, `--error`) | Errors, destructive actions, invalid inputs |
| **Harvest Amber** | `oklch(0.7 0.15 85)` ≈ `#d4a72c` (`--warning`) | Warnings, pending states |
| **Muted Warning Wash** | `oklch(0.97 0.05 85)` | Warning backgrounds |
| **Live Green** (CSS modules) | `rgb(22, 163, 74)` on `rgba(34,197,94,0.1)` | Success badges (`.variant-success`) |
| **Signal Blue** | `rgb(37, 99, 235)` on blue tint | Info badges (`.variant-info`) |
| **Chart Spectrum** | `--chart-1` … `--chart-10` | Portfolio charts, protocol analytics (10 distinct hues in OKLCH) |

## 3. Typography Rules

### Font families

- **Inter** (Google Font via `next/font`) is the sole UI typeface on `body`, giving a neutral, highly legible geometric sans suitable for financial figures and dense tables.
- **Monospace** (`font-mono`, Geist Mono token referenced in theme) appears for wallet addresses in `PortfolioWalletAddressBar`.

### Hierarchy & Weights

| Level | Typical classes / CSS | Size | Weight | Usage |
|:---|:---|:---|:---|:---|
| **Section title** | `text-xl`, `CardTitle` | 20px / 1.25rem | 600 | Portfolio page headers |
| **Card / wallet title** | `text-lg`, `.title` | 18px | 500–600 | Asset totals, protocol card headers |
| **Body / UI** | `text-sm`, `text-base` on buttons | 14–16px | 400–500 | Buttons, table cells, forms |
| **Caption** | `text-xs`, `.totalRewardsLabel` | 12px | 500 | Metadata, domain names, filters |
| **Stat emphasis** | `text-lg font-medium` | 18px | 500 | Currency totals in portfolio cards |

`CardTitle` uses `leading-none font-semibold`. Button default is `text-sm font-medium`. Inputs use `text-base` (16px) globally in `@layer base` for mobile accessibility.

### Spacing Principles

- Tight line-height on titles (`leading-none`) for compact headers.
- Muted descriptions use `text-sm text-muted-foreground` with comfortable `leading-tight` in portfolio subtitles.
- Letter-spacing is default (no wide tracking); the system relies on weight and color for hierarchy.

## 4. Component Stylings

### Buttons

shadcn `Button` (`src/components/ui/button.tsx`):

- **Shape:** `rounded-md` (maps to `--radius-md` ≈ 10px base).
- **Primary:** `bg-primary text-primary-foreground shadow-xs`, hover `bg-primary/90`.
- **Outline:** bordered, `hover:bg-accent`; dark mode uses `dark:bg-input/30`.
- **Sizes:** default `h-9 px-4`, sm `h-8`, lg `h-10`, icon `size-9`.
- **Focus:** `ring-[3px]` with `ring-ring/50`, `transition-all`.
- Global override: **min 44×44px** touch target except checkboxes.

### Cards & Protocol Containers

- **shadcn Card:** `rounded-xl border shadow-sm`, `bg-card`, header/content `px-6`, `gap-1.5` in header grid.
- **ProtocolCard** (CSS modules): `border-radius: var(--radius-lg)`, `1px solid var(--border)`, collapsible header with `hover: background var(--accent)`, chevron rotate `0.2s ease`, content fade-in animation `0.2s`.
- **Domain pattern:** Protocol positions stack in collapsible cards with logo (1.25rem), title `1.125rem/600`, and right-aligned currency values.

### Navigation

- **Desktop:** Sidebar layout with wallet selector, protocol lists, collapsible sections (`CollapsibleControls`).
- **Mobile:** `MobileTabs` — bottom tab bar (`ideas` | `assets` | `chat`), fixed `z-50`, border-top, safe-area padding; full viewport `100dvh`, `overflow: hidden` until `768px`.
- **Theme:** `next-themes` + `ThemeProviderWrapper` toggles `.dark` class on root.

### Inputs & Forms

- **Input:** `h-9`, `rounded-md`, `border-input`, `shadow-xs`, `px-3`, focus ring 3px, `dark:bg-input/30`.
- **Selection:** `selection:bg-primary selection:text-primary-foreground`.
- **Invalid:** `aria-invalid` triggers destructive ring/border.
- Modals (`dialog`, `deposit-modal`, `swap-modal`) reuse card tokens and shadcn patterns.

### Domain-Specific Components

- **Portfolio / yield cards:** Two-column `lg:grid-cols-2 gap-8`, token rows with avatars, `formatCurrency` for values, optional chain logos.
- **APY / protocol badges:** Pill badges (`rounded-full` in legacy CSS modules) with semantic green/red/blue/amber fills at 10% opacity.
- **Charts:** `lightweight-charts` and pie components use `--chart-1` through `--chart-10` for series differentiation.
- **Loading:** `.loading-dot` pulsing animation, `.animate-spin-slow` (3s rotation).

## 5. Layout Principles

### Grid & Structure

- **Breakpoint:** `768px` (`md`) switches mobile shell ↔ desktop scroll.
- **Dashboard grids:** `grid-cols-1 lg:grid-cols-2 gap-8` for portfolio sections; inner `flex flex-col lg:flex-row gap-4`.
- **Cards:** `@container/card-header` for responsive card headers.
- **Max width:** Content largely fluid within sidebar + main panel; no explicit `max-w-*` site container in globals (app-shell driven).

### Whitespace Strategy

- **Base radius unit:** `--radius: 0.625rem` (10px); derived `sm` (−4px), `md` (−2px), `xl` (+4px).
- **Spacing scale:** Tailwind defaults; common gaps `gap-1`, `gap-2`, `gap-4`, `gap-8`; card padding `px-6`, protocol content `0.75rem`.
- **Section rhythm:** `mt-4`, `p-4` on informational blocks; `py-2` on card shell.

### Alignment & Visual Balance

- Headers: `flex items-center justify-between` (title left, value/actions right).
- Tables: right-aligned numeric columns in portfolio views.
- Icons: Lucide at `size-4` in buttons, protocol logos at 1.25rem.

### Responsive Behavior & Touch

- **Mobile-first:** No user zoom (`maximumScale: 1`), fixed bottom nav, safe-area insets.
- **Touch:** 44px minimum buttons; `touch-manipulation` on key actions.
- **Scroll:** Hidden scrollbars via `.scrollbar-hide` where needed; Radix ScrollArea viewport fix for wide flex rows.
- **Dark mode:** Class-based `.dark` with inverted primary (white buttons on dark ground).

## 6. Design System Notes for Stitch Generation

### Language to Use

Describe screens as a **clean DeFi portfolio dashboard**: monochrome foundation, crisp borders, soft shadows (`shadow-sm` / `shadow-xs`), and **high-contrast black-or-white CTAs**. Avoid rainbow gradients on chrome; reserve color for data (charts, APY badges, protocol icons). Tone: trustworthy, precise, slightly dense with information.

### Color References

- Canvas: **Canvas White** `#fcfcfc` / dark **Charcoal Canvas** `#1f1f1f`
- Cards: **Pure Surface** `#ffffff` / **Elevated Graphite** `#2e2e2e`
- CTA: **Ink Primary** `#333333` (light) or **Frost Primary** `#f2f2f2` (dark)
- Muted text: **Slate Muted** `#737373`
- Danger: **Coral Alert** `#d14530`
- Warning: **Harvest Amber** `#d4a72c`
- Success chips: **Live Green** `#16a34a` on 10% green tint

### Component Prompts

1. *"Yield farming dashboard card with rounded-xl white surface, 1px light gray border, subtle shadow-sm. Header row: 18px semibold title left, currency total right. Collapsible protocol sections with 10px rounded hover rows on soft gray accent."*

2. *"Primary button: 36px height, 10px corner radius, near-black fill (#333) and off-white label, subtle shadow-xs, 3px focus ring. Secondary: outline with white/gray background and hover wash."*

3. *"Mobile bottom tab bar: fixed, three tabs (Ideas, Assets, Chat), top border #e5e5e5, safe-area padding, 44px touch targets, Inter 14px medium labels."*

### Incremental Iteration

- Start with **light theme** monochrome shell, then add `.dark` variant by inverting primary/background pairs.
- Add **chart colors** only in data visualization zones, not navigation.
- Keep **border + shadow-sm** on cards; avoid heavy glassmorphism (not used in source).
- For protocol-specific screens, reuse **collapsible card + badge** patterns before inventing new containers.
