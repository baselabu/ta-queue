import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "danger";
  size?: "md" | "lg";
};

const VARIANTS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-ink text-paper hover:bg-ink-soft disabled:bg-muted",
  secondary: "bg-paper text-ink border border-line hover:border-ink disabled:text-muted",
  quiet: "bg-transparent text-muted hover:text-ink underline underline-offset-4",
  danger: "bg-help text-paper hover:brightness-110",
};

export function Button({ variant = "primary", size = "md", className = "", ...props }: ButtonProps) {
  const sizing = size === "lg" ? "px-7 py-4 text-lg" : "px-5 py-3 text-base";
  const base = variant === "quiet" ? "" : `${sizing} rounded-lg font-semibold transition-colors`;
  return <button {...props} className={`${base} ${VARIANTS[variant]} ${className}`} />;
}

export function Field({
  label,
  hint,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = props.id ?? props.name ?? label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="w-full">
      <label htmlFor={id} className="block text-sm font-semibold text-muted mb-1.5">
        {label}
      </label>
      <input
        {...props}
        id={id}
        className={`w-full rounded-lg border border-line bg-paper px-4 py-3 text-lg
          placeholder:text-muted/60 focus:border-ink focus:outline-none ${className}`}
      />
      {hint && <p className="mt-1.5 text-sm text-muted">{hint}</p>}
    </div>
  );
}

/** Errors say what happened and what to do; they never apologise. */
export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-lg bg-help-soft px-4 py-3 text-help font-medium">
      {children}
    </p>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  return <main className="min-h-dvh flex flex-col">{children}</main>;
}
