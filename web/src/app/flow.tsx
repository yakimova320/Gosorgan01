import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DraftKind } from '../api/types';
import { useSession } from '../store';
import { t } from '../i18n';

/*
 * Состояние сценариев, которое не хранится на сервере (TechBriefing v5, 4.1).
 * Выбранные файлы письма (страницы по порядку, B11) и адреса превью: File не сериализуется, поэтому не в Redux.
 * Результат загрузки и решения по фактам здесь не хранятся: письмо открывается по ID из URL,
 * решения до сохранения живут в состоянии страницы проверки, после — на сервере.
 * При входе, выходе и смене пользователя всё сбрасывается, адреса превью освобождаются.
 */

export interface PickedFile {
  id: string;
  file: File;
  url: string; // временный адрес превью в браузере, не сохраняется на сервере
}

/** B11: одно письмо = один PDF или до 10 фото страниц. */
export const MAX_PAGES = 10;

const isPdf = (f: File) => f.type === 'application/pdf';

interface FlowValue {
  /** Страницы письма по порядку: один PDF или до MAX_PAGES фото. */
  pages: PickedFile[];
  /**
   * Добавить файлы. PDF заменяет всё (PDF — всегда одно письмо целиком); фото добавляются
   * в конец, но не больше MAX_PAGES. Возвращает текст проблемы или null.
   */
  addFiles: (files: File[]) => string | null;
  removePage: (id: string) => void;
  /** Сдвинуть страницу на одну позицию: -1 выше, +1 ниже. */
  movePage: (id: string, by: -1 | 1) => void;
  clearFiles: () => void;
  answer: { kind: DraftKind; question: string };
  setAnswer: (a: { kind: DraftKind; question: string }) => void;
}

const FlowContext = createContext<FlowValue | null>(null);
let nextId = 0;
const toPicked = (file: File): PickedFile => ({ id: `p${++nextId}`, file, url: URL.createObjectURL(file) });
const release = (pages: PickedFile[]) => pages.forEach((p) => URL.revokeObjectURL(p.url));

export function FlowProvider({ children }: { children: ReactNode }) {
  const [pages, setPages] = useState<PickedFile[]>([]);
  const [answer, setAnswer] = useState<{ kind: DraftKind; question: string }>({ kind: 'CLARIFICATION', question: '' });
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  const addFiles = useCallback((files: File[]): string | null => {
    if (files.length === 0) return null;
    const current = pagesRef.current;
    const pdfs = files.filter(isPdf);
    if (pdfs.length > 0) {
      if (files.length > 1) return t('PDF загружается отдельно: выберите один PDF или только фото.');
      release(current);
      const next = [toPicked(pdfs[0])];
      pagesRef.current = next;
      setPages(next);
      return null;
    }
    // фото после PDF: PDF заменяется фото
    const base = current.some((p) => isPdf(p.file)) ? [] : current;
    if (base !== current) release(current);
    const room = MAX_PAGES - base.length;
    const added = files.slice(0, Math.max(0, room)).map(toPicked);
    const next = [...base, ...added];
    pagesRef.current = next;
    setPages(next);
    return files.length > room ? t('Можно не больше {v0} фото на письмо. Лишние не добавлены.', { v0: MAX_PAGES }) : null;
  }, []);

  const removePage = useCallback((id: string) => {
    const gone = pagesRef.current.filter((p) => p.id === id);
    release(gone);
    const next = pagesRef.current.filter((p) => p.id !== id);
    pagesRef.current = next;
    setPages(next);
  }, []);

  const movePage = useCallback((id: string, by: -1 | 1) => {
    const list = [...pagesRef.current];
    const i = list.findIndex((p) => p.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    pagesRef.current = list;
    setPages(list);
  }, []);

  const clearFiles = useCallback(() => {
    release(pagesRef.current);
    pagesRef.current = [];
    setPages([]);
  }, []);

  const { token } = useSession();
  const lastToken = useRef(token);

  useEffect(() => {
    if (lastToken.current === token) return;
    lastToken.current = token;
    clearFiles();
    setAnswer({ kind: 'CLARIFICATION', question: '' });
  }, [token, clearFiles]);

  // Уход со страницы: освободить адреса превью.
  useEffect(() => () => release(pagesRef.current), []);

  const value = useMemo(
    () => ({ pages, addFiles, removePage, movePage, clearFiles, answer, setAnswer }),
    [pages, addFiles, removePage, movePage, clearFiles, answer],
  );
  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

export function useFlow(): FlowValue {
  const v = useContext(FlowContext);
  if (!v) throw new Error(t('useFlow: нет FlowProvider'));
  return v;
}
