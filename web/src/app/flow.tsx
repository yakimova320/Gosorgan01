import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { DraftKind, UploadResult } from '../api/types';

/*
 * Состояние многошаговых сценариев, пока человек идёт по шагам.
 * Хранится только в памяти страницы: после перезагрузки сценарий начинается заново.
 */

export interface PickedPage {
  file: File;
  url: string; // временный адрес превью в браузере, не сохраняется на сервере
}

interface FlowValue {
  pages: PickedPage[];
  addFiles: (files: FileList | File[]) => void;
  removePage: (index: number) => void;
  movePage: (index: number, delta: -1 | 1) => void;
  upload: UploadResult | null;
  setUpload: (r: UploadResult | null) => void;
  decisions: Record<string, 'ok' | 'wrong'>;
  decide: (claimId: string, d: 'ok' | 'wrong') => void;
  answer: { kind: DraftKind; question: string };
  setAnswer: (a: { kind: DraftKind; question: string }) => void;
  resetScan: () => void;
}

const FlowContext = createContext<FlowValue | null>(null);

export function FlowProvider({ children }: { children: ReactNode }) {
  const [pages, setPages] = useState<PickedPage[]>([]);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [decisions, setDecisions] = useState<Record<string, 'ok' | 'wrong'>>({});
  const [answer, setAnswer] = useState<{ kind: DraftKind; question: string }>({ kind: 'CLARIFICATION', question: '' });

  const addFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files).map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPages((p) => [...p, ...list]);
  }, []);

  const removePage = useCallback((index: number) => {
    setPages((p) => {
      const copy = [...p];
      const [gone] = copy.splice(index, 1);
      if (gone) URL.revokeObjectURL(gone.url);
      return copy;
    });
  }, []);

  const movePage = useCallback((index: number, delta: -1 | 1) => {
    setPages((p) => {
      const j = index + delta;
      if (j < 0 || j >= p.length) return p;
      const copy = [...p];
      [copy[index], copy[j]] = [copy[j], copy[index]];
      return copy;
    });
  }, []);

  const decide = useCallback((claimId: string, d: 'ok' | 'wrong') => setDecisions((x) => ({ ...x, [claimId]: d })), []);

  const resetScan = useCallback(() => {
    setPages((p) => {
      p.forEach((x) => URL.revokeObjectURL(x.url));
      return [];
    });
    setUpload(null);
    setDecisions({});
  }, []);

  const value = useMemo(
    () => ({ pages, addFiles, removePage, movePage, upload, setUpload, decisions, decide, answer, setAnswer, resetScan }),
    [pages, addFiles, removePage, movePage, upload, decisions, decide, answer, resetScan],
  );
  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

export function useFlow(): FlowValue {
  const v = useContext(FlowContext);
  if (!v) throw new Error('useFlow: нет FlowProvider');
  return v;
}
