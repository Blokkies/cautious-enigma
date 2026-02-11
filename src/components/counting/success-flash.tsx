"use client";

import { useEffect } from "react";
import { Check } from "lucide-react";

interface SuccessFlashProps {
  onComplete: () => void;
}

export function SuccessFlash({ onComplete }: SuccessFlashProps) {
  useEffect(() => {
    const timer = setTimeout(onComplete, 400);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-green-500/90 rounded-lg animate-in fade-in duration-150">
      <Check className="h-16 w-16 text-white" strokeWidth={3} />
    </div>
  );
}
