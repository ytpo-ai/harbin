import { useCallback, useEffect, useState } from 'react';

export type ToastType = 'success' | 'error';

export interface ToastState {
  type: ToastType;
  message: string;
  nonce: number;
}

export function useToast(durationMs = 4000) {
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback((type: ToastType, message: string) => {
    setToast({ type, message, nonce: Date.now() });
  }, []);

  const clearToast = useCallback(() => {
    setToast(null);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      setToast((current) => (current?.nonce === toast.nonce ? null : current));
    }, durationMs);
    return () => window.clearTimeout(timer);
  }, [toast, durationMs]);

  return {
    toast,
    showToast,
    clearToast,
  };
}
