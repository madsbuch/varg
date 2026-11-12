import type { SVGProps } from "react";
import { WOLF_EYES, WOLF_HEAD, WOLF_LINES, WOLF_NOSE } from "../lib/wolf-mark";

type P = SVGProps<SVGSVGElement>;

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
};

/** The Den: a longhouse, its gable beams crossed above the ridge. */
export const IconHome = (p: P) => (
  <svg {...base} {...p}>
    <path d="M9.5 2.5 21 11.5" />
    <path d="M14.5 2.5 3 11.5" />
    <path d="M5 10v11h14V10" />
    <path d="M10 21v-6h4v6" />
  </svg>
);

/** The Hunt: two bearded axes, crossed. */
export const IconDumbbell = (p: P) => (
  <svg {...base} {...p}>
    <path d="M5 21 17 5" />
    <path d="M19 21 7 5" />
    <path d="M17 5l3-1.5c1.2 2.4.9 5-.8 7.2l-4-3z" />
    <path d="M7 5 4 3.5c-1.2 2.4-.9 5 .8 7.2l4-3z" />
  </svg>
);

/**
 * "Varg" in Elder Futhark: wunjo, ansuz, raido, gebo. Paths, not text,
 * because a phone without a runic font would show four empty boxes.
 */
export const Runes = (p: P) => (
  <svg {...base} viewBox="0 0 58 22" strokeWidth={1.8} {...p}>
    <path d="M3 1v20M3 1l6 5-6 5" />
    <path d="M18 1v20M18 1l6 5M18 7l6 5" />
    <path d="M33 1v20M33 1l6 5-6 5 6 10" />
    <path d="M47 3l9 16M56 3l-9 16" />
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

/** A rolled scroll: the saga, every hunt written down. */
export const IconScroll = (p: P) => (
  <svg {...base} {...p}>
    <path d="M7 4h11a2 2 0 0 1 2 2v1h-4" />
    <path d="M16 7v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1h10" />
    <path d="M7 4a2 2 0 0 0-2 2v11" />
    <path d="M9 9h4M9 13h4" />
  </svg>
);

/** A wristwatch: data from the Garmin. */
export const IconWatch = (p: P) => (
  <svg {...base} {...p}>
    <rect x="6" y="6" width="12" height="12" rx="3" />
    <path d="M9 6 10 2h4l1 4M9 18l1 4h4l1-4M12 9.5V12l1.5 1.5" />
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

export const IconGear = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="3.5" />
    <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.06-.4.1-.8.1-1.2Z" />
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
 * Varg wolf-head mark. Varg is Old Norse for "wolf". The geometry lives in
 * lib/wolf-mark.ts, shared with the app icon; the eyes take the bronze of
 * the runes beside it in the header.
 */
export const Mark = (p: P) => (
  <svg viewBox="0 0 48 48" fill="none" {...p}>
    <path d={WOLF_HEAD} fill="currentColor" opacity="0.15" />
    <path d={WOLF_HEAD} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    {WOLF_LINES.map((d) => (
      <path key={d} d={d} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    ))}
    <path d={WOLF_EYES} fill="var(--gold)" stroke="var(--gold)" strokeWidth="1" strokeLinejoin="round" />
    <path d={WOLF_NOSE} fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

export const IconStar = (p: P & { filled?: boolean }) => {
  const { filled, ...rest } = p;
  return (
    <svg {...base} {...rest} fill={filled ? "currentColor" : "none"}>
      <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
    </svg>
  );
};

export const IconVoice = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    <path d="M15.5 9a4 4 0 0 1 0 6" />
    <path d="M18 6.5a7.5 7.5 0 0 1 0 11" />
  </svg>
);

/** Skip to the next block: a play triangle against a bar. */
export const IconSkipNext = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6 5.5v13l9-6.5z" fill="currentColor" />
    <path d="M18 5.5v13" />
  </svg>
);

/** Back to the start of the block: the mirror of IconSkipNext. */
export const IconSkipBack = (p: P) => (
  <svg {...base} {...p}>
    <path d="M18 5.5v13l-9-6.5z" fill="currentColor" />
    <path d="M6 5.5v13" />
  </svg>
);
