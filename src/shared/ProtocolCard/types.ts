/** Статус позиции: пул (Active/Inactive) или одиночная (Supply/Borrow) */
export enum PositionBadge {
  Active = "Active",
  Inactive = "Inactive",
  Supply = "Supply",
  Borrow = "Borrow",
  /** Delta-neutral pair-trade (spot leg + Decibel perp short) */
  DeltaNeutral = "Delta-neutral",
}

/** Общий тип позиции для отображения в карточке протокола (все протоколы маппят свои данные в этот формат) */
export interface ProtocolPosition {
  id?: string;
  /** Подпись: пара токенов (APT/USDC), символ (APT) или название пула */
  label: string;
  /** Стоимость в USD */
  value: number;
  /** URL логотипа первого токена */
  logoUrl?: string;
  /** Optional fallback logo URL if the primary fails */
  logoUrlFallback?: string;
  /** URL логотипа второго токена (для LP / пула) */
  logoUrl2?: string;
  /** Статус: для пула — Active/Inactive, для одиночной — Supply/Borrow */
  badge?: PositionBadge;
  /** Доп. строка: для одиночной — количество токенов; для пула — опционально */
  subLabel?: string;
  /** Цена за единицу (для одиночной позиции, под лого) */
  price?: number;
  /** APR в процентах (например, 12.5 = 12.5%) */
  apr?: string;
  /** Флаг, что позиция используется как коллатерал (для отображения спец. бейджа) */
  isCollateral?: boolean;
}

/** Группа позиций внутри карточки (например, один safe AI agent): заголовок + позиции + свёрнутая «пыль» */
export interface ProtocolPositionGroup {
  key: string;
  /** Название группы (например, лейбл стратегии safe) */
  title: string;
  /** Доп. подпись после названия (например, слайс адреса safe) */
  subtitle?: string;
  /** Субитог группы в USD */
  subtotal: number;
  positions: ProtocolPosition[];
  /** Мелкие токены, свёрнутые в одну строку «Other · N tokens» */
  dust?: { count: number; valueUsd: number };
  /** Клик по заголовку группы (например, открыть Manage Positions с выбранным safe) */
  onClick?: () => void;
}
