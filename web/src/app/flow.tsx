import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DraftKind } from '../api/types';
import { useSession } from '../store';

/*
 * Состояние сценариев, которое не хранится на сервере (TechBriefing v5, 4.1).
 * Выбранный файл письма и адрес его превью: File не сериализуется, поэтому не в Redux.
 * Результат загрузки и решения по фактам здесь не хранятся: письмо открывается по ID из URL,
 * решения до сохранения живут в состоянии страницы проверки, после — на сервере.
 * При входе, выходе и смене пользователя всё сбрасывается, адреса превью освобождаются.
 */

export interface PickedFile {
  file: File;
  url: string; // временный адрес превью в браузере, не сохраняется на сервере
}

interface FlowValue {
  /** Пока одно фото или один PDF на письмо (несколько фото: B11). */
  picked: PickedFile | null;
  pickFile: (file: File) => void;
  clearFile: () => void;
  answer: { kind: DraftKind; question: string };
  setAnswer: (a: { kind: DraftKind; question: string }) => void;
}

const FlowContext = createContext<FlowValue | null>(null);

export function FlowProvider({ children }: { children: ReactNode }) {
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [answer, setAnswer] = useState<{ kind: DraftKind; question: string }>({ kind: 'CLARIFICATION', question: '' });

  /** Новый файл заменяет прежний; адрес прежнего превью освобождается. */
  const pickFile = useCallback((file: File) => {
    setPicked((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return { file, url: URL.createObjectURL(file) };
    });
  }, []);

  const clearFile = useCallback(() => {
    setPicked((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return null;
    });
  }, []);

  const { token } = useSession();
  const lastToken = useRef(token);
  const pickedRef = useRef(picked);
  pickedRef.current = picked;

  useEffect(() => {
    if (lastToken.current === token) return;
    lastToken.current = token;
    clearFile();
    setAnswer({ kind: 'CLARIFICATION', question: '' });
  }, [token, clearFile]);

  // Уход со страницы: освободить адрес превью.
  useEffect(
    () => () => {
      if (pickedRef.current) URL.revokeObjectURL(pickedRef.current.url);
    },
    [],
  );

  const value = useMemo(() => ({ picked, pickFile, clearFile, answer, setAnswer }), [picked, pickFile, clearFile, answer]);
  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

export function useFlow(): FlowValue {
  const v = useContext(FlowContext);
  if (!v) throw new Error('useFlow: нет FlowProvider');
  return v;
}
