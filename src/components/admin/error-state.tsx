import { AlertCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ErrorStateProps {
  title?: string;
  /** What went wrong, in plain words (e.g. the API's error message). */
  message?: React.ReactNode;
  /** Shows a "Try again" button. */
  onRetry?: () => void;
  /** Disables the retry button and spins its icon. */
  retrying?: boolean;
  className?: string;
}

/** Inline error panel with an optional retry button. */
export function ErrorState({ title = "Could not load this page", message, onRetry, retrying, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn("flex flex-col items-center rounded-lg border border-red-200 bg-red-50/60 px-6 py-10 text-center", className)}
    >
      <AlertCircle className="h-6 w-6 text-red-600" aria-hidden="true" />
      <h3 className="mt-3 text-sm font-semibold text-slate-900">{title}</h3>
      {message && <p className="mt-1 max-w-md text-sm text-slate-600">{message}</p>}
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-5 bg-white" onClick={onRetry} disabled={retrying}>
          <RotateCw className={cn(retrying && "animate-spin motion-reduce:animate-none")} />
          Try again
        </Button>
      )}
    </div>
  );
}
