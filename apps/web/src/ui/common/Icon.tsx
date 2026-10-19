// Small inline stroke icons (24-unit grid).

const PATHS = {
  close: "M6 6l12 12M18 6L6 18",
  chevronDown: "M6 9l6 6 6-6",
  chevronUp: "M6 15l6-6 6 6",
  chevronLeft: "M15 6l-6 6 6 6",
  scroll: "M7 4h10a2 2 0 012 2v12a2 2 0 01-2 2H7M7 4a2 2 0 00-2 2v1h4M7 4a2 2 0 012 2v12a2 2 0 002 2M12 9h4M12 13h4",
  quill: "M20 4c-6 0-11 5-12 11l-2 5 5-2c6-1 11-6 11-12zM8 15l5-5",
  columns: "M3 9l9-5 9 5M5 9v9M9.5 9v9M14.5 9v9M19 9v9M3 20h18",
  crown: "M4 18h16M5 18l-1-10 5 4 3-6 3 6 5-4-1 10",
  chat: "M4 5h16v11H9l-5 4V5z",
  globe: "M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  send: "M4 12l16-8-6 16-2-7-8-1z",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z",
  copy: "M9 9h10v11H9zM5 15V4h10",
  check: "M5 12l5 5 9-10",
  plus: "M12 5v14M5 12h14",
  trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
  edit: "M4 20h4L19 9l-4-4L4 16v4z",
  play: "M8 5l11 7-11 7V5z",
  skip: "M5 5l9 7-9 7V5zM17 5v14",
  menu: "M4 7h16M4 12h16M4 17h16",
  flag: "M5 21V4h11l-2 4 2 4H5",
  user: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c1-4 4-6 8-6s7 2 8 6",
  link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
  atom: "M12 12m-1.5 0a1.5 1.5 0 103 0 1.5 1.5 0 10-3 0M12 3c4 0 4 18 0 18S8 3 12 3zM4.2 7.5c2-3.5 17.6 5.5 15.6 9S2.2 11 4.2 7.5zM19.8 7.5c2 3.5-13.6 12.5-15.6 9s13.6-12.5 15.6-9z",
  swords: "M4 4l9 9M4 4v4M4 4h4M20 4l-9 9M20 4v4M20 4h-4M7 17l-3 3M17 17l3 3M9 15l-2 2M15 15l2 2",
  refresh: "M20 11a8 8 0 10-2.3 5.7M20 4v7h-7",
  clock: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2",
  map: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6zM9 4v14M15 6v14",
  history: "M3 12a9 9 0 103-6.7M3 4v5h5M12 8v4l3 2",
  users: "M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20c.8-3.5 3.3-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.3a3.5 3.5 0 010 6.4M18 14.8c1.8.7 3 2.4 3.5 5.2",
  ballot: "M4 20h16M6 20V10h12v10M9 10V4h6v6M10.5 7h3",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v5M16 3v5",
  brush: "M14 4l6 6-8 8-6-6 8-8zM6 12l-2 2c-1 1-1 3 0 4l2 2c1 1 3 1 4 0l2-2",
  eraser: "M8 20h12M4 15l9-9 6 6-9 9H8l-4-4zM9 10l6 6",
  bucket: "M5 11l7-7 7 7-7 7-7-7zM5 11h14M20 15c0 1.5-1 2.5-1 3.5a1 1 0 002 0c0-1-1-2-1-3.5z",
  eyedropper: "M15 4l5 5-2 2-5-5 2-2zM13 6l-8 8v4h4l8-8M5 18l-1 2",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  save: "M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6",
  search: "M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4",
  logout: "M14 4h5v16h-5M10 8l-4 4 4 4M6 12h9",
  pause: "M8 5v14M16 5v14",
  rewind: "M11 6l-7 6 7 6V6zM20 6l-7 6 7 6V6z",
  info: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v6M12 7.5v.5",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className = "", strokeWidth = 1.7 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
