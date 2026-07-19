import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// --- buttons ---------------------------------------------------------------

type BtnVariant = 'primary' | 'ghost' | 'danger' | 'quiet';
export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg' }) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed select-none';
  const sizes = { sm: 'h-8 px-3 text-sm', md: 'h-11 px-4 text-sm', lg: 'h-13 min-h-12 px-5 text-base' };
  const variants: Record<BtnVariant, string> = {
    primary: 'bg-brand text-brand-ink hover:opacity-90 active:opacity-80',
    ghost: 'border border-line bg-card text-ink hover:border-steel/50',
    danger: 'bg-alarm text-white hover:opacity-90',
    quiet: 'text-steel hover:text-ink hover:bg-line/40',
  };
  return <button className={cx(base, sizes[size], variants[variant], className)} {...rest} />;
}

// --- forms -----------------------------------------------------------------

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-medium text-steel">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-steel/80">{hint}</span>}
    </label>
  );
}

const inputCls =
  'w-full h-11 rounded-lg border border-line bg-card px-3 text-[15px] text-ink placeholder:text-steel/50 focus:border-brand';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}
export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, 'h-auto min-h-24 py-2', props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputCls, 'appearance-auto', props.className)} />;
}

// --- surfaces --------------------------------------------------------------

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-xl border border-line bg-card p-4', className)}>{children}</div>;
}

export function Tile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: 'signal' | 'alarm' }) {
  return (
    <Card className="min-w-0">
      <div className="text-xs font-medium uppercase tracking-wide text-steel">{label}</div>
      <div className={cx('score mt-1 text-3xl', tone === 'signal' && 'text-signal', tone === 'alarm' && 'text-alarm')}>{value}</div>
      {sub && <div className="mt-1 truncate text-xs text-steel">{sub}</div>}
    </Card>
  );
}

export function Badge({ children, tone = 'steel' }: { children: ReactNode; tone?: 'steel' | 'signal' | 'alarm' | 'brand' }) {
  const tones = {
    steel: 'bg-line/60 text-steel',
    signal: 'bg-signal/10 text-signal',
    alarm: 'bg-alarm/10 text-alarm',
    brand: 'bg-brand/10 text-brand',
  };
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold', tones[tone])}>{children}</span>;
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-steel">{sub}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center py-10 text-center">
      <div className="font-display text-lg font-semibold">{title}</div>
      <p className="mt-1 max-w-sm text-sm text-steel">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </Card>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-steel" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-brand" />
      <span className="text-sm">{label ?? 'Loading…'}</span>
    </div>
  );
}

// --- tables ----------------------------------------------------------------

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-steel">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/70">{children}</tbody>
      </table>
    </div>
  );
}
export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cx('px-3 py-2.5 align-middle', className)}>{children}</td>;
}

// --- modal -----------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cx(
        'w-[92vw] rounded-xl border border-line bg-card p-0 text-ink shadow-xl backdrop:bg-ink/40 m-auto',
        wide ? 'max-w-3xl' : 'max-w-md',
      )}
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="font-display text-base font-bold">{title}</h2>
        <Button variant="quiet" size="sm" onClick={onClose} aria-label="Close">✕</Button>
      </div>
      <div className="max-h-[75vh] overflow-y-auto p-4">{children}</div>
    </dialog>
  );
}

// --- tabs ------------------------------------------------------------------

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-line/40 p-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cx(
            'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold transition-colors',
            value === t.key ? 'bg-card text-ink shadow-sm' : 'text-steel hover:text-ink',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// --- toast (tiny) ----------------------------------------------------------

interface ToastMsg { id: number; text: string; tone: 'ok' | 'err' }
let toastSeq = 0;
export function toast(text: string, tone: 'ok' | 'err' = 'ok') {
  window.dispatchEvent(new CustomEvent('app-toast', { detail: { id: ++toastSeq, text, tone } }));
}
export function Toaster() {
  const [msgs, setMsgs] = useState<ToastMsg[]>([]);
  useEffect(() => {
    const onToast = (e: Event) => {
      const msg = (e as CustomEvent<ToastMsg>).detail;
      setMsgs((m) => [...m, msg]);
      setTimeout(() => setMsgs((m) => m.filter((x) => x.id !== msg.id)), 3500);
    };
    window.addEventListener('app-toast', onToast);
    return () => window.removeEventListener('app-toast', onToast);
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2 sm:bottom-6">
      {msgs.map((m) => (
        <div
          key={m.id}
          className={cx(
            'pointer-events-auto rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-lg',
            m.tone === 'ok' ? 'bg-ink' : 'bg-alarm',
          )}
        >
          {m.text}
        </div>
      ))}
    </div>
  );
}
