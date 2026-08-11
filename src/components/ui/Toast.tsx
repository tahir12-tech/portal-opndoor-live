/* =====================================================================
   Toast — the bottom-centre toasts used across the app.

   TONE IS OPTIONAL AND DEFAULTS TO SUCCESS, deliberately, because every one
   of the ~50 existing call sites passes a message and nothing else. Adding a
   required argument would have meant touching all of them in a change about
   something else, and the ones missed would have failed at compile time in
   files unrelated to the fix.

   The bug this fixes: the icon was hardcoded to a tick, so a caller doing
   `catch (e) { toast(e.message) }` rendered a failure with a green tick beside
   it. In the Dev Centre that meant a replay that errored on every row looked
   like it had worked, which is worse than no feedback at all, because the
   person stops looking.

   useToast() returns toast(message, tone?); the provider renders the stack in
   a portal, animating each in and auto-dismissing it.
   ===================================================================== */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import './Toast.css';

export type ToastTone = 'ok' | 'error';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  shown: boolean;
}

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});

const DURATION = 3200;
/** Errors sit longer: they are usually longer to read and worth reading. */
const ERROR_DURATION = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const toast = useCallback((message: string, tone: ToastTone = 'ok') => {
    const id = ++seq.current;
    const life = tone === 'error' ? ERROR_DURATION : DURATION;
    setToasts((prev) => [...prev, { id, message, tone, shown: false }]);
    // animate in on the next frame
    requestAnimationFrame(() => setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, shown: true } : t))));
    // dismiss
    window.setTimeout(() => setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, shown: false } : t))), life);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), life + 260);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastPortal toasts={toasts} />
    </ToastContext.Provider>
  );
}

function ToastPortal({ toasts }: { toasts: ToastItem[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast--${t.tone}${t.shown ? ' is-in' : ''}`}
          // Errors are announced assertively so a screen reader interrupts
          // rather than queueing behind whatever is being read.
          role={t.tone === 'error' ? 'alert' : 'status'}
          aria-live={t.tone === 'error' ? 'assertive' : 'polite'}
        >
          <Icon name={t.tone === 'error' ? 'alert' : 'check'} strokeWidth={2.4} />
          <span>{t.message}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function useToast(): (message: string, tone?: ToastTone) => void {
  return useContext(ToastContext);
}
