const PATHS = {
  home: <><path d="M3 10.8 12 3l9 7.8" /><path d="M5.5 9.5V21h13V9.5" /><path d="M9.5 21v-6h5v6" /></>,
  markets: <><path d="M4 19V9" /><path d="M10 19V5" /><path d="M16 19v-7" /><path d="M22 19H2" /><path d="m3 7 5-3 6 4 7-5" /></>,
  screener: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M9 9v11M15 9v11" /></>,
  news: <><path d="M4 5h13v14H5.5A2.5 2.5 0 0 1 3 16.5V6" /><path d="M17 8h3v9a2 2 0 0 1-2 2" /><path d="M7 9h7M7 12h7M7 15h4" /></>,
  ai: <><rect x="5" y="6" width="14" height="12" rx="4" /><path d="M9 11h.01M15 11h.01M9.5 14.5h5" /><path d="M12 3v3M8 3v1M16 3v1" /></>,
  strategy: <><path d="M4 19 9 8l4 7 3-5 4 9" /><path d="M3 21h18" /><circle cx="9" cy="8" r="1.5" /><circle cx="16" cy="10" r="1.5" /></>,
  trading: <><path d="M3 12h4l2.2-5 4.2 10 2.3-5H21" /><path d="M3 21h18" /></>,
  watchlist: <><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9Z" /></>,
  diagnostics: <><path d="M4 4v16h16" /><path d="m7 15 3-4 3 2 4-6" /><circle cx="17" cy="7" r="1.2" /></>,
  coverage: <><circle cx="12" cy="12" r="8" /><path d="M12 4v8l5 3" /><path d="M4.8 8h14.4M4.8 16h14.4" /></>,
  usage: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: <><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 9A7 7 0 0 1 18.7 7L20 12M4 12l1.3 5A7 7 0 0 0 17.9 15" /></>,
  up: <path d="m6 14 6-6 6 6" />,
  down: <path d="m6 10 6 6 6-6" />,
  external: <><path d="M14 5h5v5" /><path d="m10 14 9-9" /><path d="M19 14v5H5V5h5" /></>,
  filter: <><path d="M4 5h16l-6 7v6l-4 2v-8Z" /></>,
  play: <path d="m8 5 11 7-11 7Z" />,
  candle: <><path d="M7 3v4M7 17v4M17 3v7M17 14v7" /><rect x="5" y="7" width="4" height="10" rx=".5" /><rect x="15" y="10" width="4" height="4" rx=".5" /></>,
  line: <><path d="m3 17 5-6 4 3 4-7 5 5" /><path d="M3 21h18" /></>,
  volume: <><path d="M5 20V13M10 20V7M15 20V10M20 20V4" /></>,
  indicators: <><path d="M3 15c2-5 4-5 6 0s4 5 6 0 4-5 6 0" /><path d="M3 9h18M3 19h18" /></>,
  expand: <><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  check: <path d="m4 12 5 5L20 6" />,
  warn: <><path d="M12 3 2.5 20h19Z" /><path d="M12 9v5M12 17h.01" /></>,
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9Z" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></>,
  arrowRight: <><path d="M4 12h16" /><path d="m14 6 6 6-6 6" /></>,
  x: <path d="m6 6 12 12M18 6 6 18" />,
  send: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>,
  wallet: <><path d="M4 6h14a2 2 0 0 1 2 2v11H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12" /><path d="M16 13h4" /></>,
  briefcase: <><rect x="3" y="7" width="18" height="14" rx="2" /><path d="M8 7V4h8v3M3 13h18" /></>,
  trend: <><path d="m3 17 5-6 4 3 4-7 5 5" /><path d="M17 7h4v4" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1" /></>,
  sparkle: <><path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6Z" /><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7Z" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  shield: <><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z" /><path d="m8.5 12 2.4 2.4 4.8-5" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />
};

export default function Icon({ name, size = 18, strokeWidth = 1.8, className = "", ...rest }) {
  const path = PATHS[name];
  if (!path) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      {path}
    </svg>
  );
}
