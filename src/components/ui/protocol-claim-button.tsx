"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import lendingCardStyles from "@/shared/ProtocolCard/LendingProtocolCard/LendingProtocolCard.module.css";

type ProtocolClaimButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  label?: string;
};

/** Echelon Rewards tile / LendingProtocolCard claim control. */
export function ProtocolClaimButton({
  onClick,
  disabled,
  className,
  label = "Claim",
}: ProtocolClaimButtonProps) {
  return (
    <Button
      size="sm"
      variant="outline"
      className={cn(lendingCardStyles.claimBtn, className)}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </Button>
  );
}

type ProtocolClaimAllButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  label?: string;
  fullWidth?: boolean;
};

/** Hyperion manage-positions footer claim control. */
export function ProtocolClaimAllButton({
  onClick,
  disabled,
  className,
  label = "Claim All Rewards",
  fullWidth = false,
}: ProtocolClaimAllButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "bg-success text-success-foreground rounded text-sm font-semibold disabled:opacity-60",
        fullWidth ? "w-full py-2" : "px-3 py-1",
        className
      )}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  );
}
