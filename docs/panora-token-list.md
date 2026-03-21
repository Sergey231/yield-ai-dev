## Panora token list (local cache) — how to update

This repo keeps a **cached copy** of Panora token list in `src/lib/data/tokenList.json`.
It is used by `src/lib/tokens/getTokenList.ts` (filtered by `chainId`, default: `1`).

### Why this exists

- **Stability**: the app can rely on a known token list shape.
- **Performance**: avoids fetching the token list at runtime in client code.
- **Development convenience**: makes local dev independent from Panora uptime/rate limits (as long as the cache is up to date).

### Prerequisites

- Set **`PANORA_API_KEY`** in `.env.local` (or `.env`).
- Optional: set **`PANORA_API_URL`** (defaults to `https://api.panora.exchange`).

### Update command

Run from the repo root:

```bash
npm run update-tokens
```

This executes `scripts/update-token-list.js` and overwrites:

- `src/lib/data/tokenList.json`

### Where data is fetched from

The script uses the following fallback logic:

1. Try local Next.js API (if dev server is running):
   - `http://localhost:3000/api/panora/tokenList?chainId=1`
2. If local API is not available, call Panora directly:
   - `${PANORA_API_URL}/tokenlist` with `x-api-key: ${PANORA_API_KEY}`

### Common errors

- **`PANORA_API_KEY is not set`**
  - Add `PANORA_API_KEY=...` to `.env.local` (or `.env`) and rerun.
- **401/403 from Panora**
  - Verify the API key is valid and not rate-limited.
- **Local API fails**
  - Either start the dev server (`npm run dev`) or let the script fall back to direct Panora call (requires `PANORA_API_KEY`).

