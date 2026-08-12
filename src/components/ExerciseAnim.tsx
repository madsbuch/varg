/**
 * Animated exercise demonstrations: minimalist stick figures drawn in
 * SVG and looped with SMIL <animate> (universally supported in the
 * Android WebView / Chromium - no JS, no network, no assets).
 *
 * The figures themselves live in ./exerciseAnimDefs, which holds no JSX so
 * the smoke test can audit their geometry without a React runtime.
 */
import { DEFS, type AnimDef, type AnimKey } from "./exerciseAnimDefs";

export type { AnimKey };

function loopValues(frames: string[] | number[]): string {
  return [...frames, frames[0]].join(";");
}

export default function ExerciseAnim({
  anim,
  size = 96,
}: {
  anim: AnimKey;
  size?: number;
}) {
  const def: AnimDef = DEFS[anim];
  const dur = `${def.dur}s`;
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className="ex-anim"
      aria-hidden
    >
      <line x1="8" y1="90" x2="92" y2="90" className="ex-ground" />
      {def.parts.map((part, i) => {
        if (part.kind === "circle") {
          return (
            <circle
              key={i}
              cx={part.cx[0]}
              cy={part.cy[0]}
              r={part.r}
              className={part.gear ? "ex-gear" : "ex-head"}
            >
              {part.cx.length > 1 && (
                <animate
                  attributeName="cx"
                  values={loopValues(part.cx)}
                  dur={dur}
                  repeatCount="indefinite"
                />
              )}
              {part.cy.length > 1 && (
                <animate
                  attributeName="cy"
                  values={loopValues(part.cy)}
                  dur={dur}
                  repeatCount="indefinite"
                />
              )}
            </circle>
          );
        }
        return (
          <path
            key={i}
            d={part.frames[0]}
            className={`${part.gear ? "ex-gear" : "ex-limb"}${part.fill ? " ex-fill" : ""}`}
          >
            {part.frames.length > 1 && (
              <animate
                attributeName="d"
                values={loopValues(part.frames)}
                dur={dur}
                repeatCount="indefinite"
              />
            )}
          </path>
        );
      })}
    </svg>
  );
}
