// Small markdown subset for notes, rendered straight to React elements (no innerHTML):
//   # / ## / ### headings, - [ ] / - [x] tick markers, - bullets, 1. numbered,
//   > quotes, ``` code fences, --- rules, **bold**, *italic*, ~~strike~~, ==highlight==,
//   `code`, #tags, bare URLs, and [[Note title]] / [[Note title|alias]] links.

export const INLINE =
  /(\[\[[^\]\n]+\]\]|\*\*[^*\n]+\*\*|`[^`\n]+`|~~[^~\n]+~~|==[^=\n]+==|(?<![*\w])\*[^*\s][^*\n]*?\*(?![*\w])|https?:\/\/[^\s)<]+|(?<![\w#&/])#[A-Za-z][\w-]*)/g;

const TASK_RE = /^(\s*)[-*+]\s+\[([ xX])\](?:\s(.*))?$/;

const TAG_STYLES = {
  easy: "bg-emerald-500/15 text-emerald-700",
  medium: "bg-amber-500/15 text-amber-700",
  hard: "bg-red-500/15 text-red-700",
};

export function parseLink(raw) {
  const inner = raw.slice(2, -2);
  const [target, alias] = inner.split("|");
  return { target: target.trim(), label: (alias ?? target).trim() };
}

/** Titles referenced by [[links]] in a note's text (original casing, de-duplicated). */
export function extractLinks(content) {
  const seen = new Map();
  for (const m of (content || "").matchAll(/\[\[([^\]\n|]+)(\|[^\]\n]*)?\]\]/g)) {
    const title = m[1].trim();
    if (title && !seen.has(title.toLowerCase())) seen.set(title.toLowerCase(), title);
  }
  return [...seen.values()];
}

export function toggleTaskLine(content, lineIndex) {
  const lines = content.split("\n");
  lines[lineIndex] = lines[lineIndex].replace(/^(\s*[-*+]\s+\[)([ xX])(\])/, (_, a, c, b) => a + (c === " " ? "x" : " ") + b);
  return lines.join("\n");
}

export function taskCounts(content) {
  let done = 0;
  let total = 0;
  for (const line of (content || "").split("\n")) {
    const m = line.match(TASK_RE);
    if (m) {
      total += 1;
      if (m[2] !== " ") done += 1;
    }
  }
  return { done, total };
}

/**
 * Split a line into its markdown prefix and editable content. The prefix (bullet,
 * checkbox, heading hashes...) is what stays rendered while the content is edited.
 */
export function splitPrefix(line) {
  let m;
  if ((m = line.match(/^(\s*)([-*+] \[([ xX])\](?: |$))(.*)$/))) {
    return { type: "task", indent: m[1], prefix: m[1] + m[2], content: m[4], checked: m[3] !== " " };
  }
  if ((m = line.match(/^(\s*)([-*+] )(.*)$/))) return { type: "bullet", indent: m[1], prefix: m[1] + m[2], content: m[3] };
  if ((m = line.match(/^(\s*)((\d+)([.)]) )(.*)$/))) {
    return { type: "number", indent: m[1], prefix: m[1] + m[2], content: m[5], n: Number(m[3]), delim: m[4] };
  }
  if ((m = line.match(/^(#{1,3} )(.*)$/))) return { type: "heading", indent: "", prefix: m[1], content: m[2], level: m[1].length - 1 };
  if ((m = line.match(/^(> ?)(.*)$/))) return { type: "quote", indent: "", prefix: m[1], content: m[2] };
  if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) return { type: "hr", indent: "", prefix: "", content: line };
  if (line.trim() === "") return { type: "blank", indent: "", prefix: "", content: line };
  return { type: "text", indent: "", prefix: "", content: line };
}

/** Group lines into blocks: a ``` fence (to its closing fence) is one block, every other line is its own. */
export function segmentBlocks(lines) {
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^```/.test(lines[i])) {
      let j = i + 1;
      while (j < lines.length && !/^```/.test(lines[j])) j += 1;
      const end = Math.min(j, lines.length - 1);
      blocks.push({ start: i, end, code: true });
      i = end;
    } else {
      blocks.push({ start: i, end: i, code: false });
    }
  }
  return blocks;
}

/** How an inline token is displayed, and where that text starts inside the raw token. */
function tokenDisplay(token) {
  if (token.startsWith("[[")) {
    const bar = token.indexOf("|");
    return bar === -1 ? { shown: token.slice(2, -2), offset: 2 } : { shown: token.slice(bar + 1, -2), offset: bar + 1 };
  }
  if (token.startsWith("**") || token.startsWith("~~") || token.startsWith("==")) return { shown: token.slice(2, -2), offset: 2 };
  if (token.startsWith("`") || token.startsWith("*")) return { shown: token.slice(1, -1), offset: 1 };
  return { shown: token, offset: 0 }; // URLs and #tags render as-is
}

/** Map a character offset in the rendered text back to an index in the raw markdown. */
export function renderedToRaw(text, target) {
  const parts = text.split(INLINE);
  let rendered = 0;
  let raw = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part) continue;
    if (i % 2 === 0) {
      if (target <= rendered + part.length) return raw + (target - rendered);
      rendered += part.length;
      raw += part.length;
    } else {
      const { shown, offset } = tokenDisplay(part);
      if (target <= rendered + shown.length) return raw + offset + (target - rendered);
      rendered += shown.length;
      raw += part.length;
    }
  }
  return raw;
}

export function Inline({ text, onOpenLink, linkExists }) {
  const parts = text.split(INLINE);
  return parts.map((part, i) => {
    if (!part) return null;
    if (i % 2 === 0) return part;
    if (part.startsWith("[[")) {
      const { target, label } = parseLink(part);
      const exists = linkExists ? linkExists(target) : true;
      return (
        <button
          key={i}
          type="button"
          data-interactive
          onClick={(e) => {
            e.stopPropagation();
            onOpenLink?.(target);
          }}
          title={exists ? `Open "${target}"` : `"${target}" doesn't exist yet - click to create it`}
          className={`rounded px-0.5 font-medium underline-offset-2 hover:underline ${
            exists ? "text-indigo-700 hover:bg-indigo-500/10" : "text-indigo-700/50 underline decoration-dashed"
          }`}
        >
          {label}
        </button>
      );
    }
    if (part.startsWith("#")) {
      const style = TAG_STYLES[part.slice(1).toLowerCase()] || "bg-indigo-500/15 text-indigo-700";
      return (
        <span key={i} className={`rounded-md px-1.5 py-px text-[0.85em] font-medium ${style}`}>
          {part}
        </span>
      );
    }
    if (part.startsWith("**")) return <strong key={i} className="font-semibold text-ink">{part.slice(2, -2)}</strong>;
    if (part.startsWith("`")) return <code key={i} className="rounded bg-surface px-1 py-0.5 font-mono text-[0.85em] text-pink-700">{part.slice(1, -1)}</code>;
    if (part.startsWith("~~")) return <del key={i} className="text-surface-muted">{part.slice(2, -2)}</del>;
    if (part.startsWith("==")) return <mark key={i} className="rounded bg-amber-400/25 px-0.5 text-amber-900">{part.slice(2, -2)}</mark>;
    if (part.startsWith("*")) return <em key={i}>{part.slice(1, -1)}</em>;
    return (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" data-interactive onClick={(e) => e.stopPropagation()} className="text-sky-700 underline underline-offset-2">
        {part}
      </a>
    );
  });
}

export function Checkbox({ checked, onToggle }) {
  return (
    <button
      type="button"
      data-interactive
      role="checkbox"
      aria-checked={checked}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle?.();
      }}
      className={`mt-[0.2em] flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all duration-150 ${
        checked ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-500 hover:border-emerald-400 hover:bg-emerald-500/10"
      }`}
    >
      {checked && (
        <svg viewBox="0 0 16 16" className="h-3 w-3 animate-pop" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

const indentStyle = (indent) => ({ paddingLeft: Math.min((indent || "").length, 12) * 8 });

export function headingClass(level, compact) {
  if (level === 1) return compact ? "text-base" : "text-xl";
  if (level === 2) return compact ? "text-[15px]" : "text-lg";
  return "text-sm";
}

/**
 * One line of a note. Markers (checkbox, bullet, number) are always rendered; the
 * content is either rendered inline or replaced by `slot` (the editor's textarea).
 */
export function LineRow({ line, lineIndex, compact, onToggleTask, onOpenLink, linkExists, slot, placeholder }) {
  const info = splitPrefix(line);
  const content = slot ?? (
    <span data-content className="min-w-0 flex-1 break-words">
      {info.content ? (
        <Inline text={info.content} onOpenLink={onOpenLink} linkExists={linkExists} />
      ) : placeholder ? (
        <span className="text-surface-muted">{placeholder}</span>
      ) : (
        "​"
      )}
    </span>
  );

  switch (info.type) {
    case "heading":
      return <div className={`${headingClass(info.level, compact)} mb-0.5 mt-2 flex font-bold text-ink`}>{content}</div>;
    case "task":
      return (
        <div className="flex items-start gap-2 py-0.5" style={indentStyle(info.indent)}>
          <Checkbox checked={info.checked} onToggle={() => onToggleTask?.(lineIndex)} />
          <div className={`flex min-w-0 flex-1 ${info.checked && !slot ? "text-surface-muted line-through decoration-slate-500" : ""}`}>{content}</div>
        </div>
      );
    case "bullet":
      return (
        <div className="flex items-start gap-2 py-0.5" style={indentStyle(info.indent)}>
          <span className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
          <div className="flex min-w-0 flex-1">{content}</div>
        </div>
      );
    case "number":
      return (
        <div className="flex items-start gap-2 py-0.5" style={indentStyle(info.indent)}>
          <span className="shrink-0 tabular-nums text-surface-muted">
            {info.n}
            {info.delim}
          </span>
          <div className="flex min-w-0 flex-1">{content}</div>
        </div>
      );
    case "quote":
      return <div className="my-0.5 flex border-l-2 border-indigo-400/60 pl-3 italic text-ink-soft">{content}</div>;
    case "hr":
      return slot ? <div className="flex py-0.5">{slot}</div> : <hr className="my-3 border-surface-border" />;
    default:
      return <div className="flex py-0.5">{content}</div>;
  }
}

/** Read-only rendering of a whole note (used where editing isn't needed). */
export function NoteMarkup({ content, onToggleTask, onOpenLink, linkExists, compact = false }) {
  const lines = (content || "").split("\n");
  return (
    <div className={`${compact ? "text-[13px]" : "text-sm"} leading-relaxed text-ink`}>
      {segmentBlocks(lines).map((b) =>
        b.code ? (
          <pre key={b.start} className="my-2 overflow-x-auto rounded-lg bg-surface p-3 font-mono text-xs text-ink">
            {lines.slice(b.start + 1, /^```/.test(lines[b.end]) && b.end > b.start ? b.end : b.end + 1).join("\n")}
          </pre>
        ) : (
          <LineRow
            key={b.start}
            line={lines[b.start]}
            lineIndex={b.start}
            compact={compact}
            onToggleTask={onToggleTask}
            onOpenLink={onOpenLink}
            linkExists={linkExists}
          />
        )
      )}
    </div>
  );
}
