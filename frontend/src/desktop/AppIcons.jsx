import { useId } from "react";

// Aqua-era application icons (vector, so they stay sharp at any Dock magnification).

function useIds(...names) {
  const base = useId().replace(/[^a-zA-Z0-9]/g, "");
  return Object.fromEntries(names.map((n) => [n, `${base}-${n}`]));
}

const Shadow = ({ id }) => (
  <filter id={id} x="-20%" y="-20%" width="140%" height="150%">
    <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#000" floodOpacity="0.4" />
  </filter>
);

export function DashboardIcon({ className }) {
  const i = useIds("bezel", "face", "glass", "shadow");
  return (
    <svg viewBox="0 0 128 128" className={className}>
      <defs>
        <linearGradient id={i.bezel} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fdfdfd" />
          <stop offset="0.5" stopColor="#a9b0b8" />
          <stop offset="1" stopColor="#e8ecef" />
        </linearGradient>
        <radialGradient id={i.face} cx="0.5" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#3b4552" />
          <stop offset="1" stopColor="#0d1218" />
        </radialGradient>
        <linearGradient id={i.glass} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <Shadow id={i.shadow} />
      </defs>
      <g filter={`url(#${i.shadow})`}>
        <circle cx="64" cy="64" r="56" fill={`url(#${i.bezel})`} stroke="#6d757e" strokeWidth="1.5" />
        <circle cx="64" cy="64" r="47" fill={`url(#${i.face})`} />
      </g>
      <path d="M30 80A36 36 0 0 1 40 38" stroke="#4ade80" strokeWidth="7" fill="none" strokeLinecap="round" />
      <path d="M44 34A36 36 0 0 1 84 34" stroke="#facc15" strokeWidth="7" fill="none" strokeLinecap="round" />
      <path d="M88 38A36 36 0 0 1 98 80" stroke="#f87171" strokeWidth="7" fill="none" strokeLinecap="round" />
      {[...Array(9)].map((_, k) => {
        const a = (Math.PI * (200 - k * 27.5)) / 180;
        return <line key={k} x1={64 + 28 * Math.cos(a)} y1={68 - 28 * Math.sin(a)} x2={64 + 22 * Math.cos(a)} y2={68 - 22 * Math.sin(a)} stroke="#e2e8f0" strokeWidth="2" />;
      })}
      <line x1="64" y1="68" x2="88" y2="44" stroke="#fb923c" strokeWidth="4" strokeLinecap="round" />
      <circle cx="64" cy="68" r="6" fill="#d1d5db" stroke="#4b5563" strokeWidth="1.5" />
      <ellipse cx="64" cy="40" rx="38" ry="22" fill={`url(#${i.glass})`} />
    </svg>
  );
}

/** A sunburst Les Paul (a cut-out photo-real render in public/icons). */
export function GuitarAppIcon({ className }) {
  return (
    <img
      src="/icons/guitar.png"
      alt=""
      draggable="false"
      className={`object-contain ${className || ""}`}
      style={{ filter: "drop-shadow(0 4px 4px rgba(0,0,0,0.4))" }}
    />
  );
}

export function BookAppIcon({ className }) {
  const i = useIds("cover", "pages", "shadow", "gloss");
  return (
    <svg viewBox="0 0 128 128" className={className}>
      <defs>
        <linearGradient id={i.cover} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5b8def" />
          <stop offset="1" stopColor="#1e3a8a" />
        </linearGradient>
        <linearGradient id={i.pages} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fffdf5" />
          <stop offset="1" stopColor="#e8dfc5" />
        </linearGradient>
        <linearGradient id={i.gloss} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <Shadow id={i.shadow} />
      </defs>
      <g filter={`url(#${i.shadow})`}>
        <path d="M24 20h70l10 8v84l-10-6H24z" fill={`url(#${i.pages})`} stroke="#b9ac85" />
        {[36, 46, 56, 66, 76, 86, 96].map((y) => (
          <line key={y} x1="96" x2="102" y1={y} y2={y + 1} stroke="#cfc3a1" />
        ))}
        <path d="M18 14h74a4 4 0 0 1 4 4v86a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4z" fill={`url(#${i.cover})`} stroke="#172d6b" strokeWidth="1.5" />
        <rect x="14" y="14" width="12" height="94" rx="3" fill="#152c6e" />
      </g>
      <rect x="38" y="36" width="44" height="22" rx="3" fill="#f5d06f" stroke="#a67c1b" />
      <line x1="44" x2="76" y1="44" y2="44" stroke="#7a5a12" strokeWidth="2.5" />
      <line x1="48" x2="72" y1="51" y2="51" stroke="#7a5a12" strokeWidth="2" />
      <path d="M18 14h74a4 4 0 0 1 4 4v30H14V18a4 4 0 0 1 4-4z" fill={`url(#${i.gloss})`} />
    </svg>
  );
}

export function TerminalIcon({ className }) {
  const i = useIds("frame", "screen", "shadow", "gloss");
  return (
    <svg viewBox="0 0 128 128" className={className}>
      <defs>
        <linearGradient id={i.frame} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4f5f7" />
          <stop offset="1" stopColor="#9aa1a9" />
        </linearGradient>
        <linearGradient id={i.screen} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1f1530" />
          <stop offset="1" stopColor="#05030a" />
        </linearGradient>
        <linearGradient id={i.gloss} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <Shadow id={i.shadow} />
      </defs>
      <g filter={`url(#${i.shadow})`}>
        <rect x="10" y="16" width="108" height="92" rx="12" fill={`url(#${i.frame})`} stroke="#5f666e" strokeWidth="1.5" />
        <rect x="18" y="24" width="92" height="74" rx="6" fill={`url(#${i.screen})`} />
      </g>
      <text x="28" y="56" fontFamily="Menlo, Monaco, Consolas, monospace" fontSize="22" fontWeight="700" fill="#c084fc">
        &lt;/&gt;
      </text>
      <text x="28" y="84" fontFamily="Menlo, Monaco, Consolas, monospace" fontSize="16" fill="#4ade80">
        $ _
      </text>
      <rect x="18" y="24" width="92" height="34" rx="6" fill={`url(#${i.gloss})`} />
    </svg>
  );
}

export function CalendarIcon({ className, date = new Date() }) {
  const i = useIds("page", "band", "shadow");
  const month = date.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  return (
    <svg viewBox="0 0 128 128" className={className}>
      <defs>
        <linearGradient id={i.page} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dfe3e8" />
        </linearGradient>
        <linearGradient id={i.band} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff7b6e" />
          <stop offset="1" stopColor="#c0221a" />
        </linearGradient>
        <Shadow id={i.shadow} />
      </defs>
      <g filter={`url(#${i.shadow})`}>
        <rect x="16" y="12" width="96" height="104" rx="8" fill={`url(#${i.page})`} stroke="#8d949c" strokeWidth="1.5" />
      </g>
      <path d="M16 20a8 8 0 0 1 8-8h80a8 8 0 0 1 8 8v20H16z" fill={`url(#${i.band})`} />
      <text x="64" y="33" textAnchor="middle" fontFamily="'Helvetica Neue', Helvetica, Arial" fontSize="17" fontWeight="700" fill="#fff" letterSpacing="2">
        {month}
      </text>
      <text x="64" y="96" textAnchor="middle" fontFamily="'Helvetica Neue', Helvetica, Arial" fontSize="52" fontWeight="300" fill="#1f2937">
        {date.getDate()}
      </text>
      <path d="M96 116q12-2 16-14v6a8 8 0 0 1-8 8z" fill="#c3c8ce" />
    </svg>
  );
}

export function StickiesIcon({ className }) {
  const i = useIds("paper", "pin", "shadow");
  return (
    <svg viewBox="0 0 128 128" className={className}>
      <defs>
        <linearGradient id={i.paper} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff79a" />
          <stop offset="1" stopColor="#f6d43c" />
        </linearGradient>
        <radialGradient id={i.pin} cx="0.35" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#ff9b9b" />
          <stop offset="1" stopColor="#b91c1c" />
        </radialGradient>
        <Shadow id={i.shadow} />
      </defs>
      <g filter={`url(#${i.shadow})`} transform="rotate(-4 64 64)">
        <path d="M18 20h92v68l-22 22H18z" fill={`url(#${i.paper})`} stroke="#c9a518" strokeWidth="1.2" />
        <path d="M110 88H92a4 4 0 0 0-4 4v18z" fill="#e2bd2d" />
      </g>
      {[46, 60, 74, 88].map((y) => (
        <line key={y} x1="30" x2={y === 88 ? 72 : 96} y1={y - 3} y2={y - 6} stroke="#b8941c" strokeWidth="2.2" strokeLinecap="round" opacity="0.7" />
      ))}
      <circle cx="64" cy="24" r="9" fill={`url(#${i.pin})`} stroke="#7f1d1d" />
      <ellipse cx="61" cy="21" rx="3" ry="2" fill="#fff" opacity="0.7" />
    </svg>
  );
}

export function AskIcon({ className }) {
  const i = useIds("can", "top", "bubble", "gloss", "shadow");
  return (
    <svg viewBox="0 0 128 128" className={className}>
      <defs>
        <linearGradient id={i.can} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8f98a3" />
          <stop offset="0.35" stopColor="#f4f6f8" />
          <stop offset="0.7" stopColor="#c3c9d0" />
          <stop offset="1" stopColor="#7d8691" />
        </linearGradient>
        <linearGradient id={i.top} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#c9ced5" />
        </linearGradient>
        <linearGradient id={i.bubble} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#36a2ff" />
          <stop offset="1" stopColor="#0a7cff" />
        </linearGradient>
        <linearGradient id={i.gloss} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <Shadow id={i.shadow} />
      </defs>
      {/* a database: three stacked discs */}
      <g filter={`url(#${i.shadow})`}>
        <path d="M14 46v50c0 8 17 15 38 15s38-7 38-15V46" fill={`url(#${i.can})`} stroke="#5f6873" strokeWidth="1.5" />
        <path d="M14 63c0 8 17 15 38 15s38-7 38-15M14 80c0 8 17 15 38 15s38-7 38-15" fill="none" stroke="#6d7680" strokeWidth="1.5" />
        <ellipse cx="52" cy="46" rx="38" ry="15" fill={`url(#${i.top})`} stroke="#5f6873" strokeWidth="1.5" />
      </g>
      {/* an iMessage-style question bubble */}
      <g filter={`url(#${i.shadow})`}>
        <path d="M74 14h28a20 20 0 0 1 0 40h-6c-1 6 1 12 6 16-8 0-14-3-18-8a20 20 0 0 1-10-48z" fill={`url(#${i.bubble})`} />
        <path d="M76 17h25a17 17 0 0 1 15 9H63a17 17 0 0 1 13-9z" fill={`url(#${i.gloss})`} />
        <text x="89" y="35" textAnchor="middle" dominantBaseline="central" fontFamily="-apple-system, 'Helvetica Neue', Arial, sans-serif" fontSize="30" fontWeight="700" fill="#fff">?</text>
      </g>
    </svg>
  );
}
