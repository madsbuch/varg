import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
};

export const IconHome = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
  </svg>
);

export const IconDumbbell = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6.5 6.5 17.5 17.5" />
    <path d="M4 8 8 4l3 3-4 4z" />
    <path d="M20 16l-4 4-3-3 4-4z" />
    <path d="M2 10l2-2M14 22l2-2" />
  </svg>
);

export const IconLayers = (p: P) => (
  <svg {...base} {...p}>
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 12 9 5 9-5" />
  </svg>
);

export const IconTrophy = (p: P) => (
  <svg {...base} {...p}>
    <path d="M8 21h8M12 17v4" />
    <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
    <path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
  </svg>
);

export const IconPlus = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconCheck = (p: P) => (
  <svg {...base} {...p}>
    <path d="m20 6-11 11-5-5" />
  </svg>
);

export const IconTrash = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
  </svg>
);

export const IconClose = (p: P) => (
  <svg {...base} {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const IconChevron = (p: P) => (
  <svg {...base} {...p}>
    <path d="m9 18 6-6-6-6" />
  </svg>
);

export const IconFlag = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 21V4M4 4h13l-2 4 2 4H4" />
  </svg>
);

export const IconFlame = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 3s5 4 5 9a5 5 0 0 1-10 0c0-1.5.7-2.8 1.5-3.5C8.8 10 9 12 9 12s0-4 3-9Z" />
  </svg>
);

export const IconClock = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const IconMusic = (p: P) => (
  <svg {...base} {...p}>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
);

export const IconBook = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z" />
    <path d="M4 21a2 2 0 0 1 2-2h14" />
    <path d="M9 7h7M9 11h5" />
  </svg>
);

export const IconTarget = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1" />
  </svg>
);

/**
 * Varg wolf-head mark. Varg is Old Norse for "wolf" — the mark is a
 * front-facing, angular wolf head: ears, brow, cheeks, muzzle.
 */
export const Mark = (p: P) => (
  <svg viewBox="0 0 48 48" fill="none" {...p}>
    {/* head silhouette */}
    <path
      d="M12 4 L18 12 L24 10 L30 12 L36 4 L38 16 L40 25 L32 37 L24 45 L16 37 L8 25 L10 16 Z"
      fill="currentColor"
      opacity="0.15"
    />
    <path
      d="M12 4 L18 12 L24 10 L30 12 L36 4 L38 16 L40 25 L32 37 L24 45 L16 37 L8 25 L10 16 Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    {/* eyes — angular slits */}
    <path
      d="M15 22 L21 25 M33 22 L27 25"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
    {/* nose */}
    <path
      d="M21 33 L27 33 L24 37 Z"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
);
