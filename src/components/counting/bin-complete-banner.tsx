"use client";

import { useEffect } from "react";
import { CheckCircle2 } from "lucide-react";

interface BinCompleteBannerProps {
  binName: string;
  onComplete: () => void;
}

export function BinCompleteBanner({ binName, onComplete }: BinCompleteBannerProps) {
  useEffect(() => {
    const timer = setTimeout(onComplete, 1500);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-4 animate-in zoom-in-95 duration-200">
        <CheckCircle2 className="h-16 w-16 text-green-500" />
        <div className="text-2xl font-bold">Bin Complete!</div>
        <div className="text-muted-foreground font-mono">{binName}</div>
      </div>
    </div>
  );
}
