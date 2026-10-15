import { useId } from "react";

// An iMessage "sent" bubble: an even pill with the curled tail at the bottom right.
export const BUBBLE_PATH =
  "M110 16H390A100 100 0 0 1 490 116C490 160 494 190 512 214C486 217 462 210 446 199C430 210 411 216 390 216H110A100 100 0 0 1 110 16Z";

/** The "yogurt" logo: an iMessage-style bubble that reads "gurt:yo". */
export default function YogurtLogo({ className = "h-8", withText = true }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg viewBox="0 0 520 232" className={className} role="img" aria-label="yogurt">
      <defs>
        <linearGradient id={`${id}-blue`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#36a2ff" />
          <stop offset="1" stopColor="#0a7cff" />
        </linearGradient>
      </defs>
      <path d={BUBBLE_PATH} fill={`url(#${id}-blue)`} />
      {withText && (
        <text
          x="250"
          y="117"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="-apple-system, 'SF Pro Text', 'Helvetica Neue', Helvetica, Arial, sans-serif"
          fontSize="104"
          fontWeight="500"
          letterSpacing="-2"
          fill="#ffffff"
        >
          gurt:yo
        </text>
      )}
    </svg>
  );
}
