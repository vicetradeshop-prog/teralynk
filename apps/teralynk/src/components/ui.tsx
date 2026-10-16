/**
 * Primitives UI Teralynk — chaque composant gère ses états
 * (normal, survol, actif, désactivé, chargement, erreur).
 */
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { IconX } from './Icons';

/* ---------------- Bouton ---------------- */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', loading, icon, children, disabled, className = '', ...rest }: ButtonProps) {
  const classes = [
    'tl-btn',
    `tl-btn-${variant}`,
    size === 'lg' ? 'tl-btn-lg' : size === 'sm' ? 'tl-btn-sm' : '',
    className
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading ? <span className="tl-spinner" aria-hidden /> : icon}
      {children}
    </button>
  );
}

/* ---------------- Badge ---------------- */

export function Badge({ kind = 'neutral', children }: { kind?: string; children: ReactNode }) {
  return (
    <span className={`tl-badge tl-badge-${kind}`}>
      <span className="tl-badge-dot" aria-hidden />
      {children}
    </span>
  );
}

/* ---------------- Progression ---------------- */

export function Progress({ percent, indeterminate }: { percent?: number; indeterminate?: boolean }) {
  return (
    <div className={`tl-progress ${indeterminate ? 'tl-progress-indeterminate' : ''}`} role="progressbar" aria-valuenow={percent ?? undefined}>
      <div className="tl-progress-bar" style={indeterminate ? undefined : { width: `${Math.min(100, Math.max(0, percent ?? 0))}%` }} />
    </div>
  );
}

/* ---------------- Modale ---------------- */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  small,
  children,
  footer
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  small?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="tl-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            ref={ref}
            tabIndex={-1}
            className={`tl-modal ${small ? 'tl-modal-sm' : ''}`}
            initial={{ opacity: 0, scale: 0.96, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-modal="true"
          >
            <button className="tl-btn tl-btn-icon tl-modal-close" onClick={onClose} aria-label="Fermer">
              <IconX size={18} />
            </button>
            <div className="tl-modal-head">
              {icon}
              <div>
                <h2 style={{ fontSize: 'var(--tl-text-lg)', fontWeight: 680 }}>{title}</h2>
                {subtitle && <div className="tl-page-sub">{subtitle}</div>}
              </div>
            </div>
            <div className="tl-modal-body">{children}</div>
            {footer && <div className="tl-modal-foot">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------------- État vide ---------------- */

export function EmptyState({ icon, title, message, action }: { icon: ReactNode; title: string; message: string; action?: ReactNode }) {
  return (
    <motion.div className="tl-empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="tl-empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{message}</p>
      {action}
    </motion.div>
  );
}

/* ---------------- État d'erreur ---------------- */

export function ErrorState({ title, message, detail, onRetry }: { title: string; message: string; detail?: string; onRetry?: () => void }) {
  return (
    <div className="tl-empty">
      <div className="tl-empty-icon" style={{ color: 'var(--tl-danger)', borderColor: 'rgba(248,113,113,0.4)', background: 'radial-gradient(circle at 30% 30%, rgba(248,113,113,0.15), transparent)' }}>
        <IconX size={30} />
      </div>
      <h3>{title}</h3>
      <p>{message}</p>
      {detail && <pre className="tl-gate-error-detail">{detail}</pre>}
      {onRetry && <Button variant="primary" onClick={onRetry}>Réessayer</Button>}
    </div>
  );
}
