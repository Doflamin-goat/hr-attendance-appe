import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react";

export type ToastTone = "success" | "error" | "warning" | "info";

export type ToastOptions = {
  tone?: ToastTone;
  title?: string;
  description?: string;
  duration?: number;
};

type ToastItem = Required<Pick<ToastOptions, "tone">> & {
  id: number;
  title?: string;
  description?: string;
  duration: number;
};

type Listener = (toast: ToastItem) => void;

const listeners = new Set<Listener>();
let nextId = 1;

function emit(options: ToastOptions): number {
  const item: ToastItem = {
    id: nextId++,
    tone: options.tone ?? "info",
    title: options.title,
    description: options.description,
    duration: options.duration ?? 4500,
  };

  listeners.forEach((listener) => listener(item));
  return item.id;
}

export const toast = {
  show: (options: ToastOptions) => emit(options),
  success: (title: string, description?: string) =>
    emit({ tone: "success", title, description }),
  error: (title: string, description?: string) =>
    emit({ tone: "error", title, description }),
  warning: (title: string, description?: string) =>
    emit({ tone: "warning", title, description }),
  info: (title: string, description?: string) =>
    emit({ tone: "info", title, description }),
};

const toneStyles: Record<
  ToastTone,
  { wrap: string; iconWrap: string; Icon: typeof CheckCircle2 }
> = {
  success: {
    wrap: "border-success-100 bg-white",
    iconWrap: "bg-success-50 text-success-700 border-success-100",
    Icon: CheckCircle2,
  },
  error: {
    wrap: "border-danger-100 bg-white",
    iconWrap: "bg-danger-50 text-danger-700 border-danger-100",
    Icon: AlertCircle,
  },
  warning: {
    wrap: "border-warning-100 bg-white",
    iconWrap: "bg-warning-50 text-warning-700 border-warning-100",
    Icon: AlertTriangle,
  },
  info: {
    wrap: "border-brand-100 bg-white",
    iconWrap: "bg-brand-50 text-brand-700 border-brand-100",
    Icon: Info,
  },
};

export function ToastProvider() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const listener: Listener = (item) => {
      setItems((prev) => [...prev, item]);

      if (item.duration > 0) {
        window.setTimeout(() => {
          setItems((prev) => prev.filter((t) => t.id !== item.id));
        }, item.duration);
      }
    };

    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const dismiss = (id: number) =>
    setItems((prev) => prev.filter((t) => t.id !== id));

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-[min(360px,calc(100vw-2rem))] pointer-events-none"
    >
      {items.map((item) => {
        const style = toneStyles[item.tone];
        const Icon = style.Icon;

        return (
          <div
            key={item.id}
            role={item.tone === "error" ? "alert" : "status"}
            className={`ui-toast-in pointer-events-auto rounded-xl border shadow-[0_8px_24px_rgba(15,23,42,0.10)] px-3.5 py-3 flex items-start gap-3 ${style.wrap}`}
          >
            <div
              className={`w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0 ${style.iconWrap}`}
            >
              <Icon className="w-4 h-4" />
            </div>

            <div className="min-w-0 flex-1">
              {item.title && (
                <p className="text-sm font-semibold text-slate-900">
                  {item.title}
                </p>
              )}
              {item.description && (
                <p className="mt-0.5 text-xs text-slate-600 leading-relaxed">
                  {item.description}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => dismiss(item.id)}
              className="text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
