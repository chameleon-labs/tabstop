import {Button, LiveRegion} from '@chameleon-labs/lattice-react';
import {useCallback, useEffect, useId, useRef, useState} from 'react';
import {AlertCircle, AlertTriangle, Check, Info, X} from '@/screens/components/Icons';
import './toast-region.css';

export const TOAST_DURATION_MS = 5_000;
export const TOAST_ANNOUNCEMENT_GAP_MS = 1_000;
export const MAX_VISIBLE_TOASTS = 3;

export type ToastVariant = 'success' | 'info' | 'warning' | 'danger';

export type ToastAction = {label: string; onClick: () => void};

export type ToastInput = {
  variant: ToastVariant;
  message: string;
  action?: ToastAction;
};

export type ToastMessage = ToastInput & {id: string};

export type ToastQueue = {
  toasts: readonly ToastMessage[];
  push: (toast: ToastInput) => void;
  dismiss: (id: string) => void;
};

/** Warning and danger report something to act on, so they wait to be read. */
const PERSISTS: Readonly<Record<ToastVariant, boolean>> = {
  success: false,
  info: false,
  warning: true,
  danger: true,
};

const ICONS: Readonly<Record<ToastVariant, typeof Check>> = {
  success: Check,
  info: Info,
  warning: AlertTriangle,
  danger: AlertCircle,
};

export const useToastQueue = (): ToastQueue => {
  const prefix = useId();
  const next = useRef(0);
  const [toasts, setToasts] = useState<readonly ToastMessage[]>([]);

  const push = useCallback(
    (input: ToastInput): void => {
      setToasts((current) => {
        const duplicate = current.some((toast) => toast.variant === input.variant && toast.message === input.message);
        if (duplicate) {
          return current;
        }

        next.current += 1;
        return [...current, {...input, id: `${prefix}-${next.current}`}];
      });
    },
    [prefix],
  );

  const dismiss = useCallback((id: string): void => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  return {toasts, push, dismiss};
};

type ToastItemProps = {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
};

const ToastItem = ({toast, onDismiss}: ToastItemProps): React.JSX.Element => {
  const {id, variant, message, action} = toast;
  const Icon = ICONS[variant];
  const persists = PERSISTS[variant];

  const element = useRef<HTMLLIElement>(null);
  const remaining = useRef(TOAST_DURATION_MS);
  const startedAt = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovered = useRef(false);
  const focused = useRef(false);
  const dismiss = useRef(onDismiss);

  dismiss.current = onDismiss;

  const stop = useCallback((): void => {
    if (timer.current === null) {
      return;
    }

    clearTimeout(timer.current);
    timer.current = null;

    if (startedAt.current !== null) {
      remaining.current -= Date.now() - startedAt.current;
      startedAt.current = null;
    }
  }, []);

  const start = useCallback((): void => {
    if (persists || timer.current !== null || hovered.current || focused.current) {
      return;
    }

    startedAt.current = Date.now();
    timer.current = setTimeout(
      () => {
        timer.current = null;
        dismiss.current(id);
      },
      Math.max(0, remaining.current),
    );
  }, [id, persists]);

  useEffect(() => {
    start();

    return stop;
  }, [start, stop]);

  // Listeners rather than JSX props: a countdown that pauses under the pointer
  // is not an interaction the element offers, and `<li onMouseEnter>` reads to
  // a linter as a control built out of the wrong element.
  useEffect(() => {
    const node = element.current;
    if (node === null) {
      return undefined;
    }

    const hold = (flag: React.RefObject<boolean>) => (): void => {
      flag.current = true;
      stop();
    };
    const release = (flag: React.RefObject<boolean>) => (): void => {
      flag.current = false;
      start();
    };

    const listeners = [
      ['mouseenter', hold(hovered)],
      ['mouseleave', release(hovered)],
      ['focusin', hold(focused)],
      ['focusout', release(focused)],
    ] as const;

    for (const [event, listener] of listeners) {
      node.addEventListener(event, listener);
    }

    return (): void => {
      for (const [event, listener] of listeners) {
        node.removeEventListener(event, listener);
      }
    };
  }, [start, stop]);

  return (
    <li ref={element} className="toast" data-variant={variant}>
      <span className="toast__icon">
        <Icon size="sm" />
      </span>
      <p className="toast__message">{message}</p>
      {action !== undefined && (
        <Button
          variant="ghost"
          size="sm"
          className="toast__action"
          onClick={() => {
            action.onClick();
            dismiss.current(id);
          }}
        >
          {action.label}
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="toast__dismiss"
        aria-label={`Dismiss ${message}`}
        onClick={() => {
          dismiss.current(id);
        }}
      >
        <X size="sm" />
      </Button>
    </li>
  );
};

export type ToastRegionProps = {
  toasts: readonly ToastMessage[];
  onDismiss: (id: string) => void;
};

export const ToastRegion = ({toasts, onDismiss}: ToastRegionProps): React.JSX.Element => {
  const [queued, setQueued] = useState<readonly string[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const announced = useRef(new Set<string>());

  useEffect(() => {
    const fresh = toasts.filter(({id}) => !announced.current.has(id));
    if (fresh.length === 0) {
      return;
    }

    for (const {id} of fresh) {
      announced.current.add(id);
    }
    setQueued((current) => [...current, ...fresh.map(({message}) => message)]);
  }, [toasts]);

  useEffect(() => {
    if (announcement === '') {
      const next = queued.at(0);
      if (next !== undefined) {
        setAnnouncement(next);
        setQueued((current) => current.slice(1));
      }

      return undefined;
    }

    // Returning to empty is what lets an identical sentence be read again:
    // `LiveRegion` ignores a repeated value.
    const timer = setTimeout(() => {
      setAnnouncement('');
    }, TOAST_ANNOUNCEMENT_GAP_MS);

    return (): void => {
      clearTimeout(timer);
    };
  }, [announcement, queued]);

  return (
    <div className="toast-region">
      <LiveRegion message={announcement} />
      <ul className="toast-region__stack">
        {toasts.slice(0, MAX_VISIBLE_TOASTS).map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </ul>
    </div>
  );
};
