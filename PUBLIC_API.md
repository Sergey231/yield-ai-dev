# Public Wallet API

External integrator documentation:

**[docs/public-wallet-api.md](./docs/public-wallet-api.md)**

Quick reference:

- **Production:** `https://yieldai.app`
- **Auth:** header `x-api-key` or query `api_key`
- **Endpoints:**
  - `GET /api/public/v1/wallet/{address}/balance` — wallet tokens (Aptos + Solana)
  - `GET /api/public/v1/wallet/{address}/protocols` — DeFi positions + USD totals
  - `GET /api/public/v1/wallet/{address}/lp` — Aptos LP price proxy (auxiliary)
