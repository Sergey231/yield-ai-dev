/**
 * Shared definitions for the Yield AI gas-station activity dashboard.
 * Used by both the API route and the admin page.
 */

/** Yield AI gas station wallet — sponsors gas for all app transactions. */
export const GAS_STATION_ADDRESS =
  '0x8b2de3259a50e92eaee9e17dc2010cd9369d8e9967334093dac73f31451137e0';

export type ActivityCategory =
  | 'vault'
  | 'strategy'
  | 'decibel'
  | 'swap'
  | 'lending'
  | 'bridge'
  | 'other';

export const CATEGORY_META: Record<
  ActivityCategory,
  { label: string; color: string }
> = {
  vault: { label: 'Vault', color: '#10b981' },
  strategy: { label: 'Strategy', color: '#22d3ee' },
  decibel: { label: 'Decibel', color: '#3b82f6' },
  swap: { label: 'Swap', color: '#f59e0b' },
  lending: { label: 'Lending', color: '#a855f7' },
  bridge: { label: 'Bridge', color: '#ec4899' },
  other: { label: 'Other', color: '#94a3b8' },
};

/** Module addresses observed among gas-station-sponsored transactions. */
const YIELD_AI_PACKAGE =
  '0x333d1890e0aa3762bb256f5caeeb142431862628c63063801f44c152ef154700';
const DECIBEL_PACKAGE =
  '0x50ead22afd6ffd9769e3b3d6e0e64a2a350d68e8b102c4e72e33d0b8cfdfdb06';
const PANORA_PACKAGE =
  '0x1c3206329806286fd2223647c9f9b130e66baeb6d7224a18c1f642ffe48f3b4c';
const ECHELON_PACKAGE =
  '0xc6bc659f1649553c1a3fa05d9727433dc03843baac29473c817d06d39e7621ba';
const ARIES_PACKAGE =
  '0x39ddcd9e1a39fa14f25e3f9ec8a86074d05cc0881cbf667df8a6ee70942016fb';

/** Friendly action names for known entry functions (by `module::function`). */
const ACTION_LABELS: Record<string, string> = {
  'vault::init_vault_v2': 'Create safe',
  'vault::deposit': 'Vault deposit',
  'vault::withdraw': 'Vault withdraw',
  'vault::set_safe_paused': 'Pause/unpause safe',
  'vault::set_fa_swap_limits': 'Set swap limits',
  'strategy_registry::attach_strategy': 'Attach strategy',
  'strategy_registry::detach_strategy': 'Detach strategy',
  'strategy_registry::set_strategy_state': 'Set strategy state',
  'panora_swap::router_entry': 'Swap',
  'dex_accounts_entry::delegate_trading_to_for_subaccount': 'Delegate trading',
  'dex_accounts_entry::revoke_delegation': 'Revoke delegation',
  'dex_accounts_entry::approve_max_builder_fee_for_subaccount': 'Approve builder fee',
  'dex_accounts_entry::deposit_to_subaccount_at': 'Decibel deposit',
  'dex_accounts_entry::withdraw_from_cross_collateral': 'Decibel withdraw',
  'dex_accounts_entry::place_order_to_subaccount': 'Place order',
  'bridge::deposit': 'Bridge deposit',
};

export interface CategorizedFunction {
  category: ActivityCategory;
  /** Friendly action label. */
  action: string;
}

/**
 * Maps a full `entry_function_id_str` (e.g. "0xabc::vault::deposit") to a
 * dashboard category and a human-readable action name.
 */
export function categorizeEntryFunction(entryFunction: string): CategorizedFunction {
  const parts = entryFunction.split('::');
  const pkg = parts[0] ?? '';
  const moduleName = parts[1] ?? '';
  const fnName = parts[2] ?? '';
  const moduleFn = `${moduleName}::${fnName}`;

  let category: ActivityCategory;
  if (pkg === YIELD_AI_PACKAGE) {
    category = moduleName === 'strategy_registry' ? 'strategy' : 'vault';
  } else if (pkg === DECIBEL_PACKAGE) {
    category = 'decibel';
  } else if (pkg === PANORA_PACKAGE) {
    category = 'swap';
  } else if (pkg === ECHELON_PACKAGE || pkg === ARIES_PACKAGE) {
    category = 'lending';
  } else if (moduleName === 'bridge') {
    category = 'bridge';
  } else {
    category = 'other';
  }

  const action =
    ACTION_LABELS[moduleFn] ??
    (fnName ? prettify(fnName) : moduleName || entryFunction);

  return { category, action };
}

function prettify(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
