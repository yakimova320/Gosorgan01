import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';

/**
 * UX 26.11: открыть и закрыть меню, список или окно (бургер, язык, чат).
 * Esc и клик мимо закрывают, фокус возвращается на кнопку.
 */
export function useDisclosure<B extends HTMLElement = HTMLButtonElement, P extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<B>(null);
  const panelRef = useRef<P>(null);
  const panelId = useId();

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, close]);

  return {
    open,
    setOpen,
    close,
    toggle: () => setOpen((v) => !v),
    buttonRef,
    panelRef,
    panelId,
    buttonProps: { 'aria-expanded': open, 'aria-controls': panelId },
  };
}

/* Плавающий чат: один на страницу, открыть его может и пункт меню «Задать вопрос». */
let chatOpen = false;
const chatListeners = new Set<() => void>();

export function setChatOpen(value: boolean): void {
  if (value === chatOpen) return;
  chatOpen = value;
  chatListeners.forEach((l) => l());
}

export function useChatOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      chatListeners.add(l);
      return () => chatListeners.delete(l);
    },
    () => chatOpen,
    () => false,
  );
}
