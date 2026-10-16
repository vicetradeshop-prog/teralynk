/**
 * Système de notifications (toasts) — contexte global léger.
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { IconAlert, IconCheck, IconInfo, IconX } from './Icons';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  durationMs?: number;
}

interface ToastApi {
  push: (kind: ToastKind, message: string, durationMs?: number) => void;
}

const ToastContext = createContext<ToastApi>({ push: () => undefined });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

const ICONS: Record<ToastKind, ReactNode> = {
  success: <IconCheck size={16} />,
  error: <IconX size={16} />,
  info: <IconInfo size={16} />,
  warning: <IconAlert size={16} />
};

const COLORS: Record<ToastKind, string> = {
  success: 'var(--tl-success)',
  error: 'var(--tl-danger)',
  info: 'var(--tl-blue)',
  warning: 'var(--tl-warning)'
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const remove = useCallback((id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (kind: ToastKind, message: string, durationMs = 5000) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev.slice(-3), { id, kind, message, durationMs }]);
      if (durationMs > 0) setTimeout(() => remove(id), durationMs);
    },
    [remove]
  );

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="tl-toast-zone" aria-live="polite">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              className={`tl-toast tl-toast-${toast.kind}`}
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 30, transition: { duration: 0.15 } }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            >
              <span style={{ color: COLORS[toast.kind], marginTop: 1 }}>{ICONS[toast.kind]}</span>
              <span style={{ flex: 1 }}>{toast.message}</span>
              <button className="tl-btn tl-btn-icon" style={{ padding: 2 }} onClick={() => remove(toast.id)} aria-label="Fermer">
                <IconX size={13} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
