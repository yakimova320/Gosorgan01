import { useId, useState, type CSSProperties } from 'react';

/*
 * Акварельное пятно и иллюстрация на нём (docs/design/README.md, правило 2).
 * Пятно рисует SVG-фильтр: шум + размытие края, как в макете.
 */

export function WatercolorBlob({
  color,
  width,
  height,
  opacity = 0.7,
  style,
}: {
  color: string;
  width: number;
  height: number;
  opacity?: number;
  style?: CSSProperties;
}) {
  const id = `wc${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <svg width={width} height={height} viewBox="0 0 200 160" preserveAspectRatio="none" aria-hidden="true" style={style}>
      <defs>
        <filter id={id} x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves={3} seed={4} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale={26} xChannelSelector="R" yChannelSelector="G" result="d" />
          <feGaussianBlur in="d" stdDeviation={1.6} result="b" />
          <feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves={2} seed={9} result="g" />
          <feColorMatrix
            in="g"
            type="matrix"
            values="0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 0 1"
            result="gg"
          />
          <feComposite in="b" in2="gg" operator="arithmetic" k1={0.5} k2={0.7} k3={0} k4={0} result="t" />
          <feComposite in="t" in2="b" operator="in" />
        </filter>
      </defs>
      <ellipse cx="100" cy="82" rx="86" ry="64" fill={color} opacity={opacity} filter={`url(#${id})`} />
    </svg>
  );
}

export type IllustrationName = 'worried' | 'scan' | 'talk' | 'relief' | 'mailbox' | 'consult';

/**
 * Акварельная иллюстрация из web/public/illustrations/<name>.webp на пятне.
 * Если файла ещё нет, остаётся только пятно, страница не ломается.
 */
export function Illustration({
  name,
  height,
  blob,
  alt = '',
  flip = false,
}: {
  name: IllustrationName;
  height: number;
  blob: string;
  alt?: string;
  flip?: boolean;
}) {
  const [missing, setMissing] = useState(false);
  return (
    <div className="illu" style={{ height }}>
      <WatercolorBlob color={blob} width={Math.round(height * 1.1)} height={Math.round(height * 0.75)} />
      {!missing && (
        <img
          src={`/illustrations/${name}.webp`}
          alt={alt}
          style={{ height, maxWidth: '100%', transform: flip ? 'scaleX(-1)' : undefined }}
          onError={() => setMissing(true)}
        />
      )}
    </div>
  );
}
