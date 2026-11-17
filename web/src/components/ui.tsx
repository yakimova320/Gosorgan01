import type { ReactNode } from 'react';
import { errorText } from '../api/errors';
import type { CaseStage, CaseSummary } from '../api/types';
import { Link, useNavigate } from 'react-router';
import { dayMonth, deadlineText, formatDate } from '../lib/dates';
import { initials, STAGE } from '../lib/labels';
import { Icon } from './Icon';
import { WatercolorBlob } from './Watercolor';

export function Logo() {
  return (
    <span className="logo" aria-label="Ja!sno">
      Ja<b>!</b>sno
    </span>
  );
}

/** Подпись для экранов и кнопок, функция которых ещё не подключена к серверу. */
export function DemoNote({ children = 'Демонстрация: ещё не подключено' }: { children?: ReactNode }) {
  return (
    <span className="demo-note">
      <Icon name="info" size={14} width={2.2} />
      {children}
    </span>
  );
}

export function StageChip({ stage }: { stage: CaseStage }) {
  const s = STAGE[stage];
  return <span className={`status status--${s.tone}`}>{s.label}</span>;
}

export function PageHeader({ title, subtitle, back }: { title: string; subtitle?: string; back?: string }) {
  const navigate = useNavigate();
  const goBack = (fallback: string) => (window.history.length > 1 ? navigate(-1) : navigate(fallback));
  return (
    <div className="stack-s">
      {back && (
        <button type="button" className="btn btn--ghost btn--small" style={{ alignSelf: 'flex-start', paddingLeft: 0 }} onClick={() => goBack(back)}>
          <Icon name="arrowLeft" size={18} /> Назад
        </button>
      )}
      <h1>{title}</h1>
      {subtitle && <p className="text-2">{subtitle}</p>}
    </div>
  );
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="alert alert--error" role="alert">
      {errorText(error)}
    </div>
  );
}

export function Loading({ text = 'Загружаем…' }: { text?: string }) {
  return (
    <div className="row" role="status" style={{ padding: 24, justifyContent: 'center' }}>
      <div className="spinner" />
      <span className="muted">{text}</span>
    </div>
  );
}

/** Круглый значок ведомства на акварельном пятне. */
export function AuthorityBadge({ name, color }: { name: string | null; color: string }) {
  return (
    <span style={{ position: 'relative', width: 46, height: 46, flex: '0 0 46px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <WatercolorBlob color={color} width={54} height={50} opacity={0.45} style={{ position: 'absolute', left: -4, top: -2 }} />
      <span style={{ position: 'relative', fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 800 }}>{initials(name)}</span>
    </span>
  );
}

const BADGE_COLORS = ['#EC7A5C', '#F2B83F', '#2F8C8A', '#2E3F72'];

export function CaseRow({ c, index = 0 }: { c: CaseSummary; index?: number }) {
  const s = STAGE[c.stage];
  const subtitle = c.nextDeadline ? `${c.authority ?? ''} · до ${formatDate(c.nextDeadline)}` : (c.authority ?? '');
  return (
    <Link to={`/app/cases/${c.id}`} className="card row" style={{ padding: '10px 14px 10px 10px', borderRadius: 20 }}>
      <AuthorityBadge name={c.authority} color={BADGE_COLORS[index % BADGE_COLORS.length]} />
      <div className="stack-s" style={{ flex: 1, minWidth: 0, gap: 5 }}>
        <div className="row-between">
          <span style={{ fontSize: 15, fontWeight: 600, overflowWrap: 'anywhere' }}>{c.title}</span>
          <StageChip stage={c.stage} />
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          {subtitle}
        </span>
        <div className="progress">
          <span style={{ width: `${s.progress}%`, background: s.bar }} />
        </div>
      </div>
    </Link>
  );
}

/** Тёмная карточка «Ваш следующий шаг» со значком календаря. */
export function NextStepCard({ to, date, title }: { to: string; date: string; title: string }) {
  const dm = dayMonth(date);
  return (
    <Link to={to} className="card card--navy row" style={{ gap: 14, borderRadius: 26 }}>
      <svg width="62" height="66" viewBox="0 0 70 74" aria-hidden="true">
        <rect x="0" y="6" width="70" height="66" rx="12" fill="#FFFFFF" />
        <path d="M0 18 Q0 6 12 6 L58 6 Q70 6 70 18 L70 26 L0 26 Z" fill="#F25C2A" />
        <rect x="16" y="0" width="6" height="14" rx="3" fill="#FFFFFF" />
        <rect x="48" y="0" width="6" height="14" rx="3" fill="#FFFFFF" />
        <text x="35" y="56" textAnchor="middle" fontFamily="Rubik, sans-serif" fontWeight="800" fontSize="26" fill="#1E2A4A">
          {dm.day}
        </text>
        <text x="35" y="67" textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight="600" fontSize="9" fill="#5A6072">
          {dm.month}
        </text>
      </svg>
      <div className="stack-s" style={{ flex: 1, gap: 5 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#FF9F7E' }}>Ваш следующий шаг</span>
        <span style={{ fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 700, lineHeight: 1.3 }}>{title}</span>
        <span style={{ fontSize: 13, color: 'var(--c-on-navy-2)' }}>{deadlineText(date)}. Срок в деле, добавьте его в календарь.</span>
      </div>
      <span aria-hidden="true" style={{ width: 36, height: 36, flex: '0 0 36px', borderRadius: 18, background: 'var(--c-orange)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="arrowRight" size={18} color="#FFFFFF" width={2.4} />
      </span>
    </Link>
  );
}
