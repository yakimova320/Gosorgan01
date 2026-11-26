import { useEffect, useRef, useState } from 'react';
import { useLetterFileMutation } from '../store/api';
import { fileBytesOf, releaseFile } from '../store/baseQuery';
import { ErrorAlert } from './ui';
import { t } from '../i18n';
import { originalFileName, originalPdf, saveFile } from './originalDownload';

/*
 * B11: оригинал письма для сверки фактов (ТЗ v3 6.2). Файлы грузятся только при открытии блока,
 * с токеном владельца (GET /letters/:id/file?page=n). Временные адреса blob: живут, пока открыт экран,
 * и освобождаются при уходе. Ничего не сохраняется ни в Redux, ни в браузере.
 * E02 (#165): «Скачать оригинал» — PDF как загружен (байт в байт) или фото страниц одним PDF.
 */

type Original = { n: number; mime: string; url: string };

export function LetterOriginals({
  letterId,
  files,
  title,
  createdAt,
}: {
  letterId: string;
  files: { n: number; mime: string }[];
  title?: string | null;
  createdAt?: string;
}) {
  const [load] = useLetterFileMutation();
  const [originals, setOriginals] = useState<Original[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const urls = useRef<string[]>([]);
  const loaded = useRef<Promise<Original[]> | null>(null);

  useEffect(
    () => () => {
      urls.current.forEach((u) => releaseFile(u));
      urls.current = [];
    },
    [],
  );

  /** Файлы загружаются один раз: и для просмотра, и для скачивания. */
  function fetchAll(): Promise<Original[]> {
    loaded.current ??= (async () => {
      const out: Original[] = [];
      for (const f of files) {
        const url = await load({ id: letterId, page: f.n }).unwrap();
        urls.current.push(url);
        out.push({ ...f, url });
      }
      return out;
    })().catch((e: unknown) => {
      loaded.current = null;
      throw e;
    });
    return loaded.current;
  }

  async function open() {
    if (originals || loading) return;
    setLoading(true);
    setError(null);
    try {
      setOriginals(await fetchAll());
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  async function download() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const all = await fetchAll();
      const parts = all.map((o) => ({
        mime: o.mime,
        bytes: fileBytesOf(o.url)!,
      }));
      saveFile(await originalPdf(parts), originalFileName(title, createdAt));
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  if (files.length === 0) return null;
  const isPdf = files.length === 1 && files[0].mime === 'application/pdf';
  const label = isPdf
    ? t('Оригинал письма (PDF)')
    : t('Оригинал письма ({v0} {v1})', {
        v0: files.length,
        v1: files.length === 1 ? 'фото' : 'фото страниц',
      });

  return (
    <div className="card stack-s" data-testid="letter-originals">
      <details
        className="stack-s"
        onToggle={(e) => {
          if ((e.currentTarget as HTMLDetailsElement).open) void open();
        }}
      >
        <summary>{label}</summary>
        {loading && <p className="muted">{t('Загружаем оригинал…')}</p>}
        {originals && isPdf && (
          <a
            className="btn btn--secondary btn--small"
            href={originals[0].url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('Открыть PDF')}
          </a>
        )}
        {originals && !isPdf && (
          <ol className="list-reset stack-s">
            {originals.map((o) => (
              <li key={o.n} className="stack-s">
                <span className="small text-2">
                  {t('Страница')} {o.n}
                </span>
                <img
                  src={o.url}
                  alt={t('Оригинал, страница {v0}', { v0: o.n })}
                  style={{ width: '100%', borderRadius: 12 }}
                />
              </li>
            ))}
          </ol>
        )}
      </details>
      <div
        className="row"
        style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}
      >
        <button
          type="button"
          className="btn btn--secondary btn--small"
          data-testid="download-original"
          disabled={saving}
          aria-busy={saving || undefined}
          onClick={() => void download()}
        >
          {saving ? t('Готовим файл…') : t('Скачать оригинал (PDF)')}
        </button>
        <span className="small text-2">
          {isPdf
            ? t('Точная копия загруженного файла, с подписями и печатями.')
            : t('Фото страниц одним PDF, без пересжатия.')}
        </span>
      </div>
      <ErrorAlert error={error} />
    </div>
  );
}
