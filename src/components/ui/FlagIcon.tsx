import { useId } from "react";
import type { Locale } from "../../i18n";

/**
 * The flag of a language the editor speaks, drawn as paths rather than typed as an emoji:
 * the regional-indicator flags (🇬🇧 🇰🇷) render as bare letter pairs on Windows, which is
 * where most of this editor runs. Both are the official constructions, in their own
 * proportions (2:1 and 3:2) at a common height, so a row of them lines up.
 */
export default function FlagIcon({ locale, size = 12 }: { locale: Locale; size?: number }) {
  return locale === "ko" ? <Korea size={size} /> : <Britain size={size} />;
}

function Britain({ size }: { size: number }) {
  // The Union Flag by its own geometry: white saltire 6 wide with the red 4 inside it,
  // clipped to opposite quarters so the red keeps its counterchange, then the cross over both.
  const clip = `${useId()}-quarters`;
  return (
    <svg className="flag" width={size * 2} height={size} viewBox="0 0 60 30" aria-hidden>
      <clipPath id={clip}>
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
      </clipPath>
      <rect width="60" height="30" fill="#012169" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
      <path d="M0,0 L60,30 M60,0 L0,30" clipPath={`url(#${clip})`} stroke="#c8102e" strokeWidth="4" />
      <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
      <path d="M30,0 v30 M0,15 h60" stroke="#c8102e" strokeWidth="6" />
    </svg>
  );
}

/** Whole bar (`true`) or split, and the angle from the centre out to the corner it sits in. */
const TRIGRAMS: readonly { angle: number; bars: readonly boolean[] }[] = [
  { angle: -146.31, bars: [true, true, true] },     // ☰ 건, top left
  { angle: -33.69, bars: [false, true, false] },    // ☵ 감, top right
  { angle: 146.31, bars: [true, false, true] },     // ☲ 리, bottom left
  { angle: 33.69, bars: [false, false, false] },    // ☷ 곤, bottom right
];

function Korea({ size }: { size: number }) {
  // 60×40 with the taegeuk a circle of radius 10 in the middle, turned 33.69° — the angle of
  // the flag's own diagonal, which is also the line each trigram sits on, bars across it.
  return (
    <svg className="flag" width={size * 1.5} height={size} viewBox="0 0 60 40" aria-hidden>
      <rect width="60" height="40" fill="#fff" />
      <g transform="rotate(-33.69 30 20)">
        <circle cx="30" cy="20" r="10" fill="#0047a0" />
        <path d="M20,20 A10,10 0 0 1 40,20 A5,5 0 0 1 30,20 A5,5 0 0 0 20,20 Z" fill="#cd2e3a" />
      </g>
      {TRIGRAMS.map(({ angle, bars }) => (
        <g key={angle} transform={`rotate(${angle} 30 20)`} fill="#000">
          {bars.map((whole, i) => {
            const x = 30 + 17 + (i - 1) * 3.4 - 1;
            return whole ? (
              <rect key={i} x={x} y={14} width={2} height={12} />
            ) : (
              <g key={i}>
                <rect x={x} y={14} width={2} height={4.8} />
                <rect x={x} y={21.2} width={2} height={4.8} />
              </g>
            );
          })}
        </g>
      ))}
    </svg>
  );
}
