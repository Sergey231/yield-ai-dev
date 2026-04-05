# Protocol Card + useQuery: мини-гайд

## Короткий вывод

- Для протоколов используется общий UI-слой: `ProtocolCard` + `ProtocolCardPosition` + `Badge`.
- Данные приходят через Next API routes (`userPositions`, `pools`, `rewards`), затем в клиенте загружаются через `useQuery`-хуки.
- Перед рендером данные приводятся к единому формату `ProtocolPosition` в маппере.
- Кеширование построено на TanStack Query: централизованные `queryKeys`, глобальные default options, адресная инвалидация после мутаций.
- Паттерн универсальный и подходит для любого нового протокола.

## Универсальная структура карточки протокола

### 1) Entry points (где карточка подключается)

- `src/components/Sidebar.tsx`
- `src/components/PortfolioPage.tsx`
- `src/components/MobileTabs.tsx`
- Главный контейнер: `src/components/protocols/<protocol>/PositionsList.tsx`

### 2) Слой данных и маппинг

- Хуки:
  - `src/lib/query/hooks/protocols/<protocol>/use<Protocol>Positions.ts`
  - `src/lib/query/hooks/protocols/<protocol>/use<Protocol>Pools.ts`
  - `src/lib/query/hooks/protocols/<protocol>/use<Protocol>Rewards.ts` (опционально)
- Маппер в единый формат карточки:
  - `src/components/protocols/<protocol>/map<Protocol>ToProtocolPositions.ts`
- Общий контракт:
  - `src/shared/ProtocolCard/types.ts` (`ProtocolPosition`, `PositionBadge`)

### 3) Рендер UI

- Карточка протокола:
  - `src/shared/ProtocolCard/ProtocolCard.tsx`
- Позиция внутри карточки:
  - `src/shared/ProtocolCard/ProtocolCardPosition/ProtocolCardPosition.tsx`
- Бейджи:
  - `src/shared/Badge/Badge.tsx`

## Как сделано кеширование (useQuery)

### Query keys

- Ключи централизованы в `src/lib/query/queryKeys.ts`:
  - `queryKeys.protocols.<protocol>.pools()`
  - `queryKeys.protocols.<protocol>.userPositions(address)`
  - `queryKeys.protocols.<protocol>.rewards(address)` (если есть rewards)

### Глобальные настройки QueryClient

- В `src/lib/query/config.ts` и `src/lib/query/QueryProvider.tsx`:
  - `staleTime` по умолчанию: `STALE_TIME.POSITIONS` (5 мин)
  - `gcTime` по умолчанию: `CACHE_TIME.MEDIUM` (5 мин)
  - `retry: 3`
  - `refetchOnWindowFocus: false`
  - `refetchOnMount: true`
  - `refetchOnReconnect: true`

### Что обычно переопределяется в hooks протокола

- `use<Protocol>Positions` / `use<Protocol>Rewards`:
  - `staleTime: STALE_TIME.POSITIONS`
  - `enabled` только при валидном `address`
  - опциональный `refetchOnMount`
- `use<Protocol>Pools`:
  - `staleTime: STALE_TIME.POOLS`

### Инвалидация

- После действий пользователя (`withdraw`, `claim`, refresh-события) делается адресная инвалидация через `queryClient.invalidateQueries(...)`:
  - `queryKeys.protocols.<protocol>.userPositions(address)`
  - `queryKeys.protocols.<protocol>.rewards(address)` (если есть)
  - при необходимости `queryKeys.protocols.<protocol>.pools()`

## Мини-инструкция: как добавить новый протокол на общей карточке + useQuery

1. Добавь ключи в `queryKeys.ts`  
   Минимум: `pools()`, `userPositions(address)`, опционально `rewards(address)`.

2. Создай protocol hooks в `src/lib/query/hooks/protocols/<protocol>/`  
   Обычно:
   - `use<Protocol>Positions(address, options?)`
   - `use<Protocol>Pools(options?)`
   - `use<Protocol>Rewards(address, options?)` (если нужно)

3. Реализуй маппер в `ProtocolPosition`  
   Файл вида `map<Protocol>ToProtocolPositions.ts`, чтобы UI не зависел от сырого API формата.

4. В контейнере `PositionsList` собери данные и передай в `ProtocolCard`  
   - `totalValue`
   - `positions` (`ProtocolPosition[]`)
   - `totalRewardsUsd` (опционально)
   - `isLoading`

5. После мутаций делай точечную инвалидацию query cache  
   Инвалидируй только ключи конкретного протокола и конкретного адреса.

6. Для экранов управления позициями ставь `refetchOnMount: 'always'`  
   Это уменьшает риск устаревших данных после переходов.

## Практический шаблон (чеклист)

- [ ] Добавлены `queryKeys` для протокола  
- [ ] Созданы `useQuery` hooks с `enabled` guard  
- [ ] Есть маппер в `ProtocolPosition`  
- [ ] Рендер через `ProtocolCard`, без дублирования верстки  
- [ ] Добавлена адресная `invalidateQueries` после мутаций  
- [ ] Проверены loading/error/empty states

## На какие протоколы ориентироваться

- Если нужен полный паттерн `ProtocolCard + useQuery + invalidateQueries`, ориентируйся на:
  - `Moar Market` (`src/components/protocols/moar/PositionsList.tsx`)
  - `Aave` (`src/components/protocols/aave/PositionsList.tsx`)
  - `Yield AI` (`src/components/protocols/yield-ai/PositionsList.tsx`)
- Если нужен ориентир только по общей карточке (`ProtocolCard`) без полного query-паттерна:
  - `Aptree` (`src/components/protocols/aptree/PositionsList.tsx`)
  - `Jupiter` (`src/components/protocols/jupiter/PositionsList.tsx`)

## Короткий промт для реализации нового протокола

```text
Добавь протокол <ProtocolName> в портфель через общий `ProtocolCard`.
Ориентируйся на эту документацию: `docs/protocol-card-usequery-mini-guide.md`.
Сделай по паттерну `Moar/Aave`: добавь `queryKeys`, `useQuery` hooks (`positions/pools/rewards` при необходимости), маппер в `ProtocolPosition`, и `PositionsList` в `src/components/protocols/<protocol>/`.
Подключи протокол в `Sidebar`, `PortfolioPage`, `MobileTabs`.
После мутаций добавь точечную `queryClient.invalidateQueries` по ключам протокола и адресу.
Не дублируй верстку карточки, используй только shared-компоненты.
В конце проверь линтер и приложи список измененных файлов.
```
