/** Pink wireframe-sphere app logo, used in the brand bar and About dialog. */
export default function AppLogo({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      {/* Outer ring */}
      <circle cx="16" cy="16" r="13" stroke="#ff5fa2" strokeWidth="1.2" opacity="0.5" />
      {/* Equator */}
      <ellipse cx="16" cy="16" rx="13" ry="4.5" stroke="#ff5fa2" strokeWidth="1" opacity="0.45" />
      {/* Meridian */}
      <ellipse cx="16" cy="16" rx="4.5" ry="13" stroke="#ff5fa2" strokeWidth="1" opacity="0.45" />
      {/* Inner glow */}
      <circle cx="16" cy="16" r="3" fill="#ff5fa2" opacity="0.7" />
      <circle cx="16" cy="16" r="6" fill="url(#logo-glow)" />
      <defs>
        <radialGradient id="logo-glow">
          <stop offset="0%" stopColor="#ff5fa2" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#ff5fa2" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
}
