"use client";

import { useCallback, useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ConfirmOptions {
  title: string;
  /** What will happen, in plain words. Can include lists of consequences. */
  description?: React.ReactNode;
  /** Button text; name the action ("Delete event"), not "OK". Default "Confirm". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for irreversible actions. */
  destructive?: boolean;
  /**
   * Typed confirmation: the confirm button stays disabled until the user types this exact
   * text (case-sensitive, surrounding spaces ignored). Use the event name for deletes/resets.
   */
  confirmText?: string;
  /**
   * Runs when the user confirms. While it runs, the buttons are disabled and a spinner
   * shows. Throw (or return false) to keep the dialog open; a thrown Error's message is
   * shown in the dialog.
   */
  onConfirm?: () => void | boolean | Promise<void | boolean>;
}

export interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Controlled confirmation dialog. For one-off confirmations prefer useConfirm(). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  confirmText,
  onConfirm,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  const needsText = !!confirmText;
  const textOk = !needsText || typed.trim() === confirmText.trim();

  const handleOpenChange = (next: boolean) => {
    if (pending) return; // don't close mid-action
    if (!next) {
      setTyped("");
      setError(null);
    }
    onOpenChange(next);
  };

  const handleConfirm = async () => {
    if (!textOk || pending) return;
    setError(null);
    setPending(true);
    try {
      const result = await onConfirm?.();
      if (result === false) return;
      setTyped("");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription asChild>
              <div className="space-y-2 text-sm text-slate-600">{description}</div>
            </DialogDescription>
          ) : (
            <DialogDescription className="sr-only">Confirm this action</DialogDescription>
          )}
        </DialogHeader>

        {needsText && (
          <div className="space-y-2">
            <Label htmlFor={inputId} className="text-sm font-normal text-slate-700">
              Type <span className="font-semibold text-slate-900">{confirmText}</span> to confirm
            </Label>
            <Input
              id={inputId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleConfirm();
              }}
              autoComplete="off"
              autoFocus
              disabled={pending}
            />
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "destructive" : "default"} onClick={handleConfirm} disabled={!textOk || pending}>
            {pending && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Imperative confirmations without managing dialog state:
 *
 *   const [confirm, confirmDialog] = useConfirm();
 *   ...
 *   if (await confirm({ title: "Delete team?", destructive: true, confirmLabel: "Delete" })) { ... }
 *   ...
 *   return <>{...}{confirmDialog}</>;
 *
 * Resolves true when confirmed (after `onConfirm` succeeds, if given), false when cancelled.
 */
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, React.ReactElement] {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [open, setOpen] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    resolver.current?.(false); // a newer request replaces a pending one
    setOptions(opts);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
  };

  const dialog = (
    <ConfirmDialog
      title=""
      {...options}
      open={open && !!options}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) settle(false); // no-op if already resolved as confirmed
      }}
      onConfirm={async () => {
        const result = await options?.onConfirm?.();
        if (result === false) return false;
        settle(true);
      }}
    />
  );

  return [confirm, dialog];
}
