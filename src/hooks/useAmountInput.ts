import { useCallback, useMemo, useState } from 'react';

interface UseAmountInputProps {
  balance: bigint;
  decimals: number;
  initialValue?: bigint;
}

function bigintToDecimalString(amount: bigint, decimals: number) {
  if (decimals <= 0) return amount.toString();
  const negative = amount < 0n;
  const v = negative ? -amount : amount;

  const s = v.toString();
  const pad = decimals + 1;
  const whole = s.length > decimals ? s.slice(0, -decimals) : '0';
  const fracRaw = s.length > decimals ? s.slice(-decimals) : s.padStart(decimals, '0');
  const frac = fracRaw.replace(/0+$/, '');

  const out = frac ? `${whole}.${frac}` : whole;
  return negative ? `-${out}` : out;
}

/** Comma as decimal separator → dot; strip junk; keep a single decimal point. */
function normalizeTypedDecimal(raw: string): string {
  let v = raw.replace(/,/g, '.');
  v = v.replace(/[^0-9.]/g, '');
  const firstDot = v.indexOf('.');
  if (firstDot !== -1) {
    v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
  }
  return v;
}

function decimalStringToBigint(value: string, decimals: number) {
  let v = value.trim();
  if (!v) return { normalized: '', amount: 0n };

  // allow partial inputs like "." or "0."
  if (v === '.') return { normalized: '0.', amount: 0n };
  if (v.startsWith('.')) v = `0${v}`;

  // split and normalize
  const [intRaw, decRaw = ''] = v.split('.');
  const intPart = intRaw ? intRaw.replace(/^0+(?=\d)/, '') : '0';
  const decPart = decRaw.slice(0, Math.max(0, decimals));
  /** e.g. "0." → keep the dot so the user can type "0.15" */
  const trailingDot = v.endsWith('.') && decRaw === '';

  const normalized = trailingDot
    ? `${intPart}.`
    : decRaw.length > 0
      ? `${intPart}.${decPart}`
      : intPart;

  const base = 10n ** BigInt(Math.max(0, decimals));
  const whole = BigInt(intPart || '0') * base;

  if (trailingDot || !decPart) return { normalized, amount: whole };
  const padded = decPart.padEnd(Math.max(0, decimals), '0');
  return { normalized, amount: whole + BigInt(padded || '0') };
}

export function useAmountInput({ balance, decimals, initialValue }: UseAmountInputProps) {
  const initialAmount = useMemo(() => (initialValue ?? balance), [initialValue, balance]);
  const [amount, setAmount] = useState<bigint>(initialAmount);
  const [amountString, setAmountString] = useState<string>(
    bigintToDecimalString(initialAmount, decimals)
  );

  const setHalf = useCallback(() => {
    const next = balance / 2n;
    setAmount(next);
    setAmountString(bigintToDecimalString(next, decimals));
  }, [balance]);

  const setMax = useCallback(() => {
    setAmount(balance);
    setAmountString(bigintToDecimalString(balance, decimals));
  }, [balance]);

  const setAmountFromString = useCallback((value: string) => {
    const parsed = decimalStringToBigint(normalizeTypedDecimal(value), decimals);
    setAmountString(parsed.normalized);
    setAmount(parsed.amount);
  }, [decimals]);

  return {
    amount,
    amountString,
    setAmount,
    setAmountFromString,
    setHalf,
    setMax,
    isValid: amount > BigInt(0) && amount <= balance
  };
} 