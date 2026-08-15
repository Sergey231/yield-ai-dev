# DN open: миграция с `delta_neutral` V2 на `strategy_journal` (cycle_id)

Статус: **реализовано (task 1), не протестировано на mainnet**. Ветка `feat/dn-journal-migration`
(worktree `.worktrees/dn-journal`). Тип-чек проекта зелёный; новые файлы проходят lint.
Изменено: `strategyJournal.ts` (новый helper), `executor-open-delta-neutral` (→ `open_cycle`),
`executor-close-delta-neutral` (ветка `cycleId` → `close_cycle`), `delta-neutral-cycles` (новый
read-эндпоинт) + хук `useDeltaNeutralCycles`, `YieldAIPositions.tsx` (список циклов + Close,
дизейбл занятого рынка). Осталось: прогон §7 на mainnet; задача 2 (LP-нога) — §8.

Цель — перевести открытие/закрытие дельта-нейтрал Decibel с модуля
`delta_neutral` (бухгалтерия по `(safe, perp_market)`, один открытый DN на сейф) на
`strategy_journal` (бухгалтерия по авто-инкрементному `cycle_id`), чтобы:

1. **Задача 1 (этот документ).** Снять ограничение «один DN на сейф» и дать держать
   несколько DN-позиций одновременно — **на разных рынках** (BTC-DN + APT-DN и т.д.).
2. **Задача 2 (отложена, см. §8).** Открывать спот-ногу как Hyperion LP-пул вместо
   «купить и держать спот». Здесь не реализуется; cycle-модель закладывается так, чтобы
   LP-нога добавлялась без переделки.

Контракт-сторона описана в (репозиторий `yield-ai-agent-smart`):
- `docs/STRATEGY_JOURNAL_EXECUTOR.md` — как звать журнал из исполнителя (ABI, enum'ы, флоу).
- `docs/DN_LP_DECIBEL_STRATEGY.md` — дизайн модуля (storage, события, дрейф дельты).

> **Сверено на mainnet** (пакет `0x333d1890e0aa3762bb256f5caeeb142431862628c63063801f44c152ef154700`,
> модуль `strategy_journal`): `journal_initialized()` → **`true`**. ABI совпадает с доком 1-в-1
> (entry/view сигнатуры и `CycleView` — см. §10). То есть on-chain путь готов, осталась только
> off-chain интеграция этого документа.

---

## 1. Решения (зафиксированы)

| Вопрос | Решение |
|---|---|
| Что значит «2 позиции» | **Только разные рынки.** Один сабаккаунт Decibel; неттинг перпов не мешает, т.к. на рынок не более одного открытого цикла. Дубли на одном рынке — вне scope (требовали бы отдельных сабаккаунтов). |
| Существующие открытые DN (legacy `record_open`) | **Dual-read.** UI читает старые V2-записи И новые journal-циклы, мёржит в один список. Legacy доживают до закрытия по старому пути; новые open идут только в журнал. |
| Спот-нога vs LP-пул | LP — **отложено** (§8). Сейчас спот-нога = купленный спот в сейфе. |
| `deposit_mode` | По умолчанию **0 (`usdc_zap`)** — нога финансируется из USDC сейфа. |
| `base_exposure` | Фактически купленный спот в нативных единицах (`filled_short_human_base` × 10^decimals); `0`, если спот ещё не куплен. |
| Деплой журнала | **Live на mainnet, но не протестирован.** Перед cutover проверяем `journal_initialized() == true`; первый прогон — через интерфейс на реальном mainnet (см. §7). |

---

## 2. Текущее состояние (как есть)

Открытие — 4 транзакции исполнителя в
[`executor-open-delta-neutral/route.ts`](../src/app/api/protocols/decibel/executor-open-delta-neutral/route.ts):

1. `configure_user_settings` — leverage 1x, cross.
2. `place_order` — короткий перп на Decibel.
3. `execute_swap_fa_to_fa` — покупка спота под размер шорта (exact-out квота Hyperion + буфер).
4. `delta_neutral::record_open` — запись.

Блокировка второй позиции: pre-flight `is_delta_neutral_open(safe)` → 409
`DELTA_NEUTRAL_ALREADY_OPEN` (строки ~519–550). Плюс гард `account_positions` по рынку
(строки ~552–588). Итог: **один DN на сейф**.

UI ([`YieldAIPositions.tsx`](../src/components/protocols/manage-positions/protocols/YieldAIPositions.tsx))
построен на допущении «≤1 DN-позиция»: единственная инлайн-форма (актив BTC/APT, один размер,
`maxSizeUsd`, гард `subaccountHasOpenOnSelectedMarket`).

---

## 3. Целевая модель

- Запись о позиции = **cycle** в `strategy_journal`, идентифицируется `(safe, cycle_id)`.
- `get_open_cycles(safe)` → список открытых циклов; на каждый `get_cycle(safe, cycle_id)` — снимок.
- Инвариант UI: **на один `perp_market` — не более одного открытого цикла** (правило «разные рынки»).
- Период миграции: список позиций = (legacy V2-записи) ∪ (journal-циклы), помеченные источником.

---

## 4. Изменения по слоям

### 4.1 Executor route — `executor-open-delta-neutral/route.ts`

**Заменить шаг 4** (`delta_neutral::record_open`) на `strategy_journal::open_cycle`:

```
open_cycle(
  safe              = canonicalSafe,
  strategy_id       = utf8("dn-decibel-<asset>"),   // как текущий strategy_registry тег
  deposit_mode      = 0,                              // usdc_zap (по умолчанию)
  lp_position       = 0x0,                            // спот-нога без LP
  perp_market       = selectedMarket.market_addr,
  spot_metadata     = spotMetadata,
  base_exposure     = desiredSpotOutBaseUnits,        // купленный спот в нативных units (0 если нет)
  perp_short_size   = filledShortSize,
  usdc_notional_open= usdcAmountIn,
)
```

- `open_cycle` ничего не возвращает → сразу после неё прочитать `get_cycle_count(safe)`
  (= только что присвоенный `cycle_id`) и вернуть его в ответе (`data.cycleId`) для
  оптимистичного апдейта UI.
- `related_tx_version`/линковка Decibel-tx — через последующие `record_action`, не на open
  (на open журнал и так фиксирует open-событие). Margin-движения логируем позже при
  необходимости (вне scope MVP).

**Снять гард «один DN на сейф»** (блок `DELTA_NEUTRAL_IS_OPEN_VIEW`, ~519–550). Заменить на
**гард «один открытый цикл на этот рынок»**:

```
cycles = get_open_cycles(safe)
for id in cycles: c = get_cycle(safe, id); if c.perp_market == selectedMarket.market_addr && c.is_open → 409
```

Существующий гард `account_positions` по рынку (~552–588) **оставить** — он страхует ту же
инвариантность со стороны Decibel.

**Pre-flight журнала:** перед записью проверить `journal_initialized()`; если `false` —
вернуть понятную 503 («journal not initialized»), не открывая ноги.

### 4.2 Close route — `executor-close-delta-neutral/route.ts`

- Принимать `cycleId` (новый путь) ИЛИ `perpMarket` (legacy). Если пришёл `cycleId` —
  закрывать через `strategy_journal::close_cycle(safe, cycle_id, usdc_received_on_close,
  perp_funding_abs, perp_funding_positive, perp_realized_abs, perp_realized_positive)`.
  Funding/realized — magnitude + знак (Move без signed int); тянем финальные числа из Decibel.
- Если `perpMarket` (legacy) — оставить текущий `delta_neutral::record_close` без изменений.

### 4.3 Слой чтения (dual-read)

Файлы: `deltaNeutralViews.ts`, `mapDeltaNeutralToProtocolPositions.ts`, хук
`useDeltaNeutralState.ts`.

- Добавить journal-вьюхи: `get_open_cycles(safe)`, `get_cycle(safe, cycle_id)`,
  `get_cycle_count(safe)`, `is_any_cycle_open(safe)`.
- Хук читает оба источника параллельно и мёржит в единый `DeltaNeutralPosition[]`:
  - поле `source: 'journal' | 'v2'`;
  - ключ строки: journal → `cycle-${cycle_id}`, legacy → `market-${perp_market}`;
  - общие поля: asset/market, размер (USD notional), perp_short_size, spot_metadata,
    opened_at, funding/APR (из Decibel API как сейчас).
- Close-флоу выбирает путь по `source`.

### 4.4 UI — `YieldAIPositions.tsx`

Переход от «инлайн-форма ≤1 позиции» к «список + кнопка»:

- **Список DN-позиций**: строка на cycle/legacy-запись — иконка актива, размер (USD),
  funding/APR, возраст, бейдж рынка, `#cycle_id` (для journal). На каждой строке — **Close**.
- **Кнопка «Открыть delta-neutral»** → модалка с текущей формой (актив, размер, `maxSizeUsd`).
  - Актив-селектор **скрывает/дизейблит рынки, по которым уже есть открытый цикл**
    (правило «разные рынки»). Если открыты все поддерживаемые рынки — кнопка disabled с
    подсказкой «закройте позицию, чтобы открыть здесь».
  - `maxSizeUsd` считается на момент открытия конкретной позиции (логика та же).
- Гард `subaccountHasOpenOnSelectedMarket` остаётся (совпадает с правилом «один рынок — один цикл»).
- После успешного open использовать `data.cycleId` для оптимистичной строки до инвалидации.

---

## 5. strategy_id и enum'ы

- `strategy_id`: `dn-decibel-btc` / `dn-decibel-apt` (UTF-8, ≤64 байт) — совпадает с текущими
  тегами `strategy_registry`. LP-вариант позже — `dn-lp-decibel-<asset>`.
- `deposit_mode`: `0=usdc_zap` (дефолт), `1=dual`, `2=base_asset`.
- `action_kind` (для будущих `record_action`): 1 MARGIN_ADD, 2 MARGIN_REMOVE, 3 LIQUIDITY_ADD,
  4 LIQUIDITY_REMOVE, 5 REBALANCE_RANGE, 6 REHEDGE, 7 CLAIM_FEES, 8 CLAIM_REWARDS.

---

## 6. Кодировка ts-sdk (напоминание)

- `vector<u8>` (`strategy_id`): `Array.from(new TextEncoder().encode("dn-decibel-btc"))`,
  не plain-строка.
- `u64` (`base_exposure`, `perp_short_size`, `usdc_notional_open`): `string`/`bigint`.
- `address`: 0x-строка; `deposit_mode: u8`: number.

---

## 7. План тестирования (mainnet через интерфейс)

Журнал live, но не протестирован → первый прогон осторожный, малыми суммами.

1. **Pre-flight:** view `journal_initialized()` на mainnet → `true`. Если нет — стоп, эскалация.
2. **Открыть #1 (BTC), ~$10–15.** Проверить: `place_order` → swap → `open_cycle` прошли;
   `get_open_cycles(safe)` = `[1]`; `get_cycle(safe,1)` поля корректны (perp_market,
   spot_metadata, base_exposure=купленный спот, perp_short_size, usdc_notional_open,
   deposit_mode=0, is_open=true). UI показывает строку с `#1`.
3. **Открыть #2 (APT)** при открытом #1. Проверить: оба в списке; `get_open_cycles` = `[1,2]`.
4. **Повторить BTC при открытом #1** → ожидаем 409 «один цикл на рынок» (open ног не происходит).
5. **Close #1** через `close_cycle` → `is_open=false`, ушёл из списка, `is_any_cycle_open` корректно.
6. **Dual-read:** если на сейфе есть legacy V2-позиция — убедиться, что она видна в списке
   рядом с journal-циклами и закрывается по старому пути.
7. Сверить события `CycleOpenedEvent`/`CycleClosedEvent` в эксплорере по tx.

---

## 8. Задача 2 (отложена): LP-нога вместо спота

Не реализуется в этом этапе. Когда дойдём:
- Спот-нога открывается через `vault::execute_hyperion_open_zap_usdc` (deposit_mode=0) или
  `execute_hyperion_open_dual` (1/2); `lp_position` = адрес позиции из `HyperionLpOpenedEvent`.
- `base_exposure` = фактические base-units в LP после открытия (читается
  `vault::get_hyperion_position_meta`).
- Дрейф дельты в CLMM → `record_action(REHEDGE, ...)` при ребалансе шорта (см. §7
  `DN_LP_DECIBEL_STRATEGY.md`).
- UI: где живёт выбор «спот vs LP» — **решение отложено** (опция в модалке открытия vs
  отдельная стратегия/экран).

---

## 9. Открытые вопросы / риски

- **Тестовость журнала на mainnet.** Первый open реально проверяет контракт впервые —
  идём малыми суммами, готовы к force-close руками при half-open состоянии.
- **`record_action` для margin/funding** — в MVP не пишем; close-cycle берёт финальные числа
  из Decibel разово. Достаточно для простого lifecycle.
- **Полнота `usdc_received_on_close`** на close — как сейчас, считается дельтой USDC-баланса
  сейфа после unwind-свопа.

---

## 10. Сверенный ABI (mainnet, `0x333d…4700::strategy_journal`)

Получено view-вызовом к fullnode mainnet. `journal_initialized()` → `true`.

Entry-функции (после `&signer`):

```
open_cycle(safe: address, strategy_id: vector<u8>, deposit_mode: u8, lp_position: address,
           perp_market: address, spot_metadata: address, base_exposure: u64,
           perp_short_size: u64, usdc_notional_open: u64)
close_cycle(safe: address, cycle_id: u64, usdc_received_on_close: u64, perp_funding_abs: u64,
            perp_funding_positive: bool, perp_realized_abs: u64, perp_realized_positive: bool)
record_action(safe: address, cycle_id: u64, action_kind: u8, base_exposure_after: u64,
              perp_short_size_after: u64, usdc_delta: u64, related_tx_version: u64)
record_external_leg(safe: address, cycle_id: u64, chain_id: u16,
                    external_tx_ref: vector<u8>, note: vector<u8>)
set_cycle_string(safe: address, cycle_id: u64, key: vector<u8>, value: vector<u8>)
set_cycle_extra_u64(safe: address, cycle_id: u64, key: vector<u8>, value: u64)
init_strategy_journal()   // admin, one-time — уже выполнено
```

View-функции:

```
journal_initialized() -> bool
state_version() -> u8
max_strategy_id_bytes() -> u64
is_any_cycle_open(safe: address) -> bool
get_open_cycles(safe: address) -> vector<u64>
get_cycle_count(safe: address) -> u64
get_cycle(safe: address, cycle_id: u64) -> CycleView
get_cycle_string(safe: address, cycle_id: u64, key: vector<u8>) -> StringView
get_cycle_strings(safe: address, cycle_id: u64) -> vector<StringKV>
get_cycle_external_legs(safe: address, cycle_id: u64) -> vector<ExternalLeg>
get_cycle_extra_u64(safe: address, cycle_id: u64, key: vector<u8>) -> ExtraU64View
```

`CycleView` (то, что мапит read-слой §4.3):

```
record_exists: bool, cycle_id: u64, strategy_id_utf8: vector<u8> (hex → UTF-8),
deposit_mode: u8, lp_position: address, perp_market: address, spot_metadata: address,
base_exposure: u64, perp_short_size: u64, usdc_notional_open: u64,
is_open: bool, opened_at: u64, updated_at: u64, closed_at: u64,
usdc_received_on_close: u64, perp_funding_abs: u64, perp_funding_positive: bool,
perp_realized_abs: u64, perp_realized_positive: bool, action_count: u64, version: u8
```

Примечания:
- `extras_u64` **в `CycleView` нет** — читается отдельным `get_cycle_extra_u64`.
- `strategy_id_utf8` и `StringView.value_utf8` приходят как `0x…` hex → декодировать в UTF-8.
- `get_cycle_count(safe)` = `next_cycle_id - 1`; cycle_id'ы плотные от 1 → сразу после `open_cycle`
  это и есть присвоенный id.
