import type { ReactElement } from 'react';
/**
 * UX 26.11: флаги языков как SVG (эмодзи-флаги не видны в Windows).
 * У арабского флага нет: язык не привязан к одной стране.
 */
const W = 21;
const H = 14;

function Stripes({ colors, vertical = false }: { colors: string[]; vertical?: boolean }) {
  const n = colors.length;
  return (
    <>
      {colors.map((c, i) =>
        vertical ? (
          <rect key={i} x={(W / n) * i} y={0} width={W / n + 0.1} height={H} fill={c} />
        ) : (
          <rect key={i} x={0} y={(H / n) * i} width={W} height={H / n + 0.1} fill={c} />
        ),
      )}
    </>
  );
}

const FLAGS: Record<string, () => ReactElement> = {
  ru: () => <Stripes colors={['#FFFFFF', '#0039A6', '#D52B1E']} />,
  uk: () => <Stripes colors={['#0057B7', '#FFD700']} />,
  de: () => <Stripes colors={['#000000', '#DD0000', '#FFCE00']} />,
  es: () => (
    <>
      <rect width={W} height={H} fill="#AA151B" />
      <rect y={H / 4} width={W} height={H / 2} fill="#F1BF00" />
    </>
  ),
  cs: () => (
    <>
      <rect width={W} height={H / 2} fill="#FFFFFF" />
      <rect y={H / 2} width={W} height={H / 2} fill="#D7141A" />
      <path d={`M0 0 L${W / 2} ${H / 2} L0 ${H} Z`} fill="#11457E" />
    </>
  ),
  tr: () => (
    <>
      <rect width={W} height={H} fill="#E30A17" />
      <circle cx={7.4} cy={7} r={3.6} fill="#FFFFFF" />
      <circle cx={8.3} cy={7} r={2.9} fill="#E30A17" />
      <path d="M11.2 7l2.9-.95-1.8 2.45V5.5l1.8 2.45z" fill="#FFFFFF" />
    </>
  ),
};

export function hasFlag(code: string): boolean {
  return code in FLAGS;
}

export function Flag({ code }: { code: string }) {
  const draw = FLAGS[code];
  if (!draw) return null;
  return (
    <svg className="flag" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" data-flag={code}>
      {draw()}
      <rect x={0.25} y={0.25} width={W - 0.5} height={H - 0.5} fill="none" stroke="rgba(30,42,74,.25)" strokeWidth={0.5} />
    </svg>
  );
}
