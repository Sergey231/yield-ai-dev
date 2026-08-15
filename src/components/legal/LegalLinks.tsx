import Link from "next/link";
import { cn } from "@/lib/utils";

const legalLinkClass =
  "text-muted-foreground/80 transition-colors hover:text-foreground";

type LegalLinksProps = {
  className?: string;
  linkClassName?: string;
};

export function LegalLinks({ className, linkClassName }: LegalLinksProps) {
  return (
    <div className={cn("flex items-center gap-1.5 text-[10px] leading-none", className)}>
      <Link href="/terms" className={cn(legalLinkClass, linkClassName)}>
        Terms
      </Link>
      <span className="text-muted-foreground/50" aria-hidden>
        ·
      </span>
      <Link href="/privacy" className={cn(legalLinkClass, linkClassName)}>
        Privacy
      </Link>
    </div>
  );
}

export function HomeCornerLink({ className }: { className?: string }) {
  return (
    <Link
      href="https://home.yieldai.app/"
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "p-1 text-muted-foreground/80 transition-colors hover:text-foreground",
        className,
      )}
      title="Yield AI Home"
      aria-label="Yield AI Home"
    >
      <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
      </svg>
    </Link>
  );
}
