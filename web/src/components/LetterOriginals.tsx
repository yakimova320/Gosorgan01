import { useEffect, useRef, useState } from 'react';
import { useLetterFileMutation } from '../store/api';
import { ErrorAlert } from './ui';
import { t } from '../i18n';

/*
 * B11: оригинал письма для сверки фактов (ТЗ v3 6.2). Файлы грузятся только при открытии блока,
 * с токеном владельца (GET /letters/:id/file?page=n). Временные адреса blob: живут, пока открыт экран,
 * и освобождаются при уходе. Ничего не сохраняется ни в Redux, ни в браузере.
 */

type Original = { n: number; mime: string; url: string };

export function LetterOriginals({ letterId, files }: { letterId: string; files: { n: number; mime: string }[] }) {
  const [load] = useLetterFileMutation();
  const [originals, setOriginals] = useState<Original[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const urls = useRef<string[]>([]);

  useEffect(
    () => () => {
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current = [];
    },
    [],
  );

  async function open() {
    if (originals || loading) return;
    setLoading(true);
    setError(null);
    try {
      const loaded: Original[] = [];
      for (const f of files) {
        const url = await load({ id: letterId, page: f.n }).unwrap();
        urls.current.push(url);
        loaded.push({ ...f, url });
      }
      setOriginals(loaded);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  if (files.length === 0) return null;
  const isPdf = files.length === 1 && files[0].mime === 'application/pdf';
  const label = isPdf ? t('Оригинал письма (PDF)') : t('Оригинал письма ({v0} {v1})', { v0: files.length, v1: files.length === 1 ? 'фото' : 'фото страниц' });

  return (
    <details
      className="card stack-s"
      data-testid="letter-originals"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) void open();
      }}
    >
      <summary>{label}</summary>
      {loading && <p className="muted">{t('Загружаем оригинал…')}</p>}
      <ErrorAlert error={error} />
      {originals && isPdf && (
        <a className="btn btn--secondary btn--small" href={originals[0].url} target="_blank" rel="noopener noreferrer">
          {t('Открыть PDF')}
        </a>
      )}
      {originals && !isPdf && (
        <ol className="list-reset stack-s">
          {originals.map((o) => (
            <li key={o.n} className="stack-s">
              <span className="small text-2">{t('Страница')}{' '}{o.n}</span>
              <img src={o.url} alt={t('Оригинал, страница {v0}', { v0: o.n })} style={{ width: '100%', borderRadius: 12 }} />
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
