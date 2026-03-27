## Yield AI vault cron worker — HTTP trigger

Server-side worker that paginates Yield AI safes and may submit transactions signed by **`YIELD_AI_EXECUTOR_PRIVATE_KEY`** (claim → swap → deposit). The frontend does not sign these transactions.

### Endpoint

- **Method:** `POST`
- **Path:** `/api/protocols/yield-ai/cron/run`
- **Production example:** `https://yieldai.app/api/protocols/yield-ai/cron/run`

### Authentication

Send header:

| Header | Value |
|--------|--------|
| `x-cron-secret` | Must match `YIELD_AI_CRON_SECRET` in the deployment environment (Vercel / `.env.local`). |

If `YIELD_AI_CRON_SECRET` is not set on the server, the route returns **500**.

### Request body (JSON)

The **`dryRun` flag is read only from the JSON body**, not from custom headers. Putting `dryRun` in **Headers** in Postman has **no effect** — use **Body → raw → JSON**.

| Field | Type | Description |
|-------|------|-------------|
| `dryRun` | boolean (or string `"true"`) | If `true`, the worker logs intended actions and does **not** submit transactions (no `submit` / no on-chain hashes). If omitted or `false`, transactions are submitted. |
| `pageSize` | number | Pagination size for `get_safes_range_info` (optional; defaults from env or code). |
| `maxSafesProcessedPerRun` | number | Cap on safes processed per invocation (optional). |
| `maxTxPerRun` | number | Cap on transaction submissions per invocation (optional). |
| `concurrencyReads` | number | Parallelism for balance/view reads (optional). |

**Minimal dry-run body:**

```json
{ "dryRun": true }
```

**Minimal live run (body can be empty):**

```json
{}
```

or explicitly:

```json
{ "dryRun": false }
```

### Response (JSON)

Success shape (via `createSuccessResponse`):

```json
{
  "data": {
    "runId": "run_<timestamp>_<suffix>",
    "startedAtUnixMs": 0,
    "totalSafes": 0,
    "pageSize": 100,
    "maxSafesProcessedPerRun": 500,
    "maxTxPerRun": 200,
    "processedSafes": 0,
    "txCount": 0,
    "claimedSafes": 0,
    "swappedSafes": 0,
    "depositedSafes": 0,
    "txHashes": {
      "claim": [],
      "swap": [],
      "deposit": []
    },
    "dryRun": false
  }
}
```

- **Hashes** are populated only when transactions are actually submitted (`dryRun: false`).
- If the body is invalid JSON, the handler may fall back to defaults and **`dryRun` may be `false`** — fix the JSON (valid JSON uses `:` not `=` in objects, e.g. `{"dryRun":false}` not `{"dryRun":=false}`).

### Error responses

| Status | Meaning |
|--------|---------|
| 401 | Missing or wrong `x-cron-secret` |
| 429 | Another cron run is already in progress (in-process lock) |
| 500 | Missing `YIELD_AI_CRON_SECRET` on server, or worker error |

### `curl` example (dry run)

```bash
curl -X POST "https://yieldai.app/api/protocols/yield-ai/cron/run" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: YOUR_SECRET" \
  --data-raw '{"dryRun":true}'
```

### Postman

1. **POST** → URL above.
2. **Headers:** `x-cron-secret`, `Content-Type: application/json`.
3. **Body** → **raw** → **JSON** with `{"dryRun": true}` as needed.

### Environment variables (server)

| Variable | Purpose |
|----------|---------|
| `YIELD_AI_CRON_SECRET` | Shared secret for `x-cron-secret` (required). |
| `YIELD_AI_EXECUTOR_PRIVATE_KEY` | Executor account that signs vault transactions (required for live runs). |
| `APTOS_API_KEY` | Optional; used for Aptos REST client auth if configured. |
| `YIELD_AI_CRON_PAGE_SIZE` | Optional default for `pageSize`. |
| `YIELD_AI_CRON_MAX_SAFES_PER_RUN` | Optional default max safes per run. |
| `YIELD_AI_CRON_MAX_TX_PER_RUN` | Optional default max txs per run. |
| `YIELD_AI_CRON_CONCURRENCY_READS` | Optional default for parallel reads. |
| `YIELD_AI_APT_SWAP_RESERVE_OCTAS` | Optional APT reserve before swap (if set). |
| `YIELD_AI_USDC_DEPOSIT_RESERVE_BASE_UNITS` | Optional USDC reserve before deposit (if set). |

### Logs

`console.log` / `console.error` from the route and worker appear in **Vercel** → Project → **Logs** (runtime logs for the deployed function). Search by `runId` or `[Yield AI]`.

### Implementation references

- Route: `src/app/api/protocols/yield-ai/cron/run/route.ts`
- Worker: `src/lib/protocols/yield-ai/yieldAiVaultWorker.ts`
- Executor / submit + wait for confirmation: `src/lib/protocols/yield-ai/vaultExecutor.ts`
