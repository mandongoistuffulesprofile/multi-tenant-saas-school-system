export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  title?: string;
  message: string;
  type: ToastType;
  duration?: number;
}

export interface ToastOptions {
  title?: string;
  type?: ToastType;
  duration?: number;
}

type Listener = (toast: Toast) => void;

const listeners = new Set<Listener>();
let id = 0;

export function toast(message: string, options: ToastOptions = {}) {
  const t: Toast = {
    id: String(++id),
    message,
    type: options.type ?? "info",
    duration: options.duration ?? 4000,
    ...(options.title ? { title: options.title } : {}),
  };
  listeners.forEach((fn) => fn(t));
  return t.id;
}

export function dismiss(id: string) {
  listeners.forEach((fn) => fn({ id, message: "", type: "info", duration: 0 } as Toast));
}

export function subscribe(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
