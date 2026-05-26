import { Slot } from "@radix-ui/react-slot";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function Button({
  className,
  asChild,
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean; variant?: "primary" | "secondary" | "danger" }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(
        "inline-flex min-h-9 items-center justify-center gap-2 rounded-ui px-3 py-2 text-sm font-medium leading-tight transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-accent text-panel shadow-[0_1px_2px_oklch(24%_0.026_82_/_0.14)] hover:bg-accent/90 active:bg-accent/85",
        variant === "secondary" && "border border-border bg-panel text-ink shadow-[0_1px_0_oklch(100%_0.004_92_/_0.8)_inset] hover:border-ink/15 hover:bg-ink/[0.035] active:bg-ink/[0.06]",
        variant === "danger" && "bg-danger text-panel shadow-[0_1px_2px_oklch(24%_0.026_82_/_0.14)] hover:bg-danger/90 active:bg-danger/85",
        className
      )}
      {...props}
    />
  );
}

export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <section className={cn("rounded-ui border border-border bg-panel p-5 shadow-[0_1px_2px_oklch(24%_0.026_82_/_0.06),0_12px_34px_oklch(65%_0.03_82_/_0.08)]", className)} {...props} />;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "success" | "warning" | "danger" | "accent" }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium leading-tight",
        tone === "neutral" && "border-border bg-ink/[0.035] text-muted",
        tone === "success" && "border-accent/25 bg-accent/10 text-ink",
        tone === "warning" && "border-warn/30 bg-warn/10 text-ink",
        tone === "danger" && "border-danger/25 bg-danger/10 text-danger",
        tone === "accent" && "border-accent/30 bg-accent/10 text-ink",
        className
      )}
      {...props}
    />
  );
}
