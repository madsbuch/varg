/**
 * The players' top bar pieces. The bar is the title block (elastic) and
 * then fixed button slots, voice · music · close, always in that order.
 * A button a workout does not have (no voice lines, music still being
 * made) keeps its slot as an invisible placeholder, so Stop never moves
 * under a thumb that learned where it was.
 */
import type { ReactNode } from "react";
import type { HrLive } from "./HeartRate";

const Heart = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 21s-7.5-4.6-9.5-9.6C1.2 8 3.3 4.5 6.8 4.5c2.1 0 3.6 1.1 5.2 3 1.6-1.9 3.1-3 5.2-3 3.5 0 5.6 3.5 4.3 6.9C19.5 16.4 12 21 12 21z" />
  </svg>
);

const Retry = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20 12a8 8 0 1 1-2.3-5.7" />
    <path d="M20 4v5h-5" />
  </svg>
);

/**
 * The workout's name, and under it the heart rate when a strap is paired:
 * the live bpm and zone, "…" while it starts, or in red what is wrong,
 * tappable to retry. Shown only while it is true — never a held number.
 */
export function TopTitle({ title, hr }: { title: string; hr: HrLive }) {
  return (
    <div className="wod-title">
      <span className="wod-title-text">{title}</span>
      {hr.paired && (hr.problem ? (
        <button className="hr-tag bad" role="alert" onClick={hr.retry} aria-label={`${hr.problem}. Retry heart rate`}>
          <Heart /><span className="hr-tag-text">{hr.problem}</span><Retry />
        </button>
      ) : (
        <span className={`hr-tag ${hr.bpm !== null ? "live" : ""}`} aria-label="Heart rate">
          <Heart />
          {hr.bpm !== null ? <><strong>{hr.bpm}</strong>{hr.zone ? <small>Z{hr.zone}</small> : null}</> : "…"}
        </span>
      ))}
    </div>
  );
}

/** A button slot in the top bar: the button, or a placeholder of its size. */
export function Slot({ children }: { children: ReactNode }) {
  return children ?? <span className="check slot" aria-hidden />;
}
