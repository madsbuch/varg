import { memo, useEffect, useRef, useState } from "react";
import { bakeMotion, CARRY_PHASES, MOTIONS, required } from "../lib/exercise-motion";
import type { AnimKey } from "../lib/exercise-motion";
export type { AnimKey } from "../lib/exercise-motion";

// Shared across thumbnails, sheets and the player. No frame-by-frame React
// work: the browser interpolates the pre-solved skeleton samples with SMIL.
const CACHE = new Map<AnimKey, ReturnType<typeof bakeMotion>>();
function framesFor(key: AnimKey) {
  let frames = CACHE.get(key);
  if (!frames) { frames = bakeMotion(key); CACHE.set(key, frames); }
  return frames;
}

function ExerciseAnim({ anim, size = 96 }: { anim: AnimKey; size?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { setReducedMotion(query.matches); };
    query.addEventListener("change", update);
    return () => { query.removeEventListener("change", update); };
  }, []);
  // Off-screen library thumbnails need not keep their SMIL timelines active.
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && !reducedMotion) svg.unpauseAnimations();
      else svg.pauseAnimations();
    });
    observer.observe(svg);
    return () => { observer.disconnect(); };
  }, [anim, reducedMotion]);

  const frames = framesFor(anim), first = required(frames, 0);
  const dur = `${MOTIONS[anim].dur}s`;
  return (
    <svg key={anim} ref={ref} viewBox="0 0 100 100" width={size} height={size} className="ex-anim" aria-hidden>
      <line x1="8" y1="90" x2="92" y2="90" className="ex-ground" />
      {first.shapes.map((part, i) => (
        <path key={i} d={part.d} opacity={part.opacity ?? 1} className={part.style === "gear" ? "ex-gear" : `ex-limb${part.style === "far" ? " ex-far" : ""}`}>
          {!reducedMotion && <animate attributeName="d" values={frames.map(f => required(f.shapes, i).d).join(";")} dur={dur} repeatCount="indefinite" />}
          {!reducedMotion && part.opacity !== undefined && <animate attributeName="opacity" values={frames.map(f => required(f.shapes, i).opacity ?? 1).join(";")} dur={dur} repeatCount="indefinite" />}
        </path>
      ))}
      {first.balls.map((part, i) => (
        <circle key={i} cx={part.center[0]} cy={part.center[1]} r={part.radius} opacity={part.opacity ?? 1} className={i === 0 ? "ex-head" : "ex-gear"}>
          {!reducedMotion && <>
            <animate attributeName="cx" values={frames.map(f => required(f.balls, i).center[0]).join(";")} dur={dur} repeatCount="indefinite" />
            <animate attributeName="cy" values={frames.map(f => required(f.balls, i).center[1]).join(";")} dur={dur} repeatCount="indefinite" />
            <animate attributeName="opacity" values={frames.map(f => required(f.balls, i).opacity ?? 1).join(";")} dur={dur} repeatCount="indefinite" />
          </>}
        </circle>
      ))}
      {anim === "sprintDragCarry" && CARRY_PHASES.map((label, i) => (
        <text key={i} x="50" y="98" className="ex-phase" opacity={i === 0 ? 1 : 0}>
          {label}
          {!reducedMotion && <animate attributeName="opacity" values={Array.from({ length: 6 }, (_, phase) => phase % 5 === i ? 1 : 0).join(";")} keyTimes="0;0.2;0.4;0.6;0.8;1" calcMode="discrete" dur={dur} repeatCount="indefinite" />}
        </text>
      ))}
    </svg>
  );
}

// The workout clock updates frequently; an unchanged demonstration should
// not rebuild its SVG tracks on every tick.
export default memo(ExerciseAnim);
