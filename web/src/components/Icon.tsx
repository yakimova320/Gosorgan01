/* Иконки линиями в стиле макета (stroke 1.8–2.2, скруглённые концы). */

const PATHS = {
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  home: ['M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'],
  history: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5', 'M12 7v5l3 2'],
  scan: ['M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2', 'M9 9h6v6H9z'],
  chat: ['M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21a8 8 0 0 1 16 0'],
  arrowRight: ['M5 12h14M13 6l6 6-6 6'],
  arrowLeft: ['M19 12H5M11 18l-6-6 6-6'],
  check: ['M5 12.5 10 17l9-10'],
  x: ['M6 6l12 12M18 6 6 18'],
  calendar: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v4M16 3v4'],
  upload: ['M12 16V4', 'M7 9l5-5 5 5', 'M4 20h16'],
  camera: ['M4 8h3l2-3h6l2 3h3v11H4z', 'M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  doc: ['M7 3h7l5 5v13H7z', 'M14 3v5h5', 'M10 13h6M10 17h6'],
  folder: ['M3 6h6l2 2h10v11H3z'],
  book: ['M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z', 'M4 21V5'],
  lock: ['M6 11h12v10H6z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  eyeOff: ['M3 3l18 18', 'M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2', 'M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 14h10l1-14'],
  plus: ['M12 5v14M5 12h14'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-4-4'],
  edit: ['M4 20h4L20 8l-4-4L4 16z'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  send: ['M4 12 20 4l-6 16-3-7z'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v6M12 7.5v.5'],
  help: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14', 'M12 17v.5'],
  pen: ['M14 4l6 6L9 21H3v-6z'],
  logout: ['M15 4h4v16h-4', 'M10 16l-4-4 4-4', 'M6 12h10'],
  flame: ['M12 3c1 3 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.2-4 2.5-5 0 2 .8 3 2 3.5 0-3.5-.5-5.5.5-8.5z'],
  people: ['M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M2 21a7 7 0 0 1 14 0', 'M16 3.5a4 4 0 0 1 0 7', 'M18 14a7 7 0 0 1 4 7'],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 22,
  color = 'currentColor',
  width = 1.9,
  label,
}: {
  name: IconName;
  size?: number;
  color?: string;
  width?: number;
  label?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
