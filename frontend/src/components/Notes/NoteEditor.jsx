import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNotes } from "../../context/NotesContext";
import { LineRow, renderedToRaw, segmentBlocks, splitPrefix, toggleTaskLine } from "./noteMarkup";

// ---------- caret helpers ----------

const MIRROR_PROPS = [
  "boxSizing", "width", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontStyle", "fontVariant", "fontWeight",
  "fontSize", "lineHeight", "fontFamily", "textAlign", "textTransform", "textIndent", "letterSpacing",
  "wordSpacing", "tabSize",
];

/** Pixel position of a caret inside a textarea (mirror-div technique). */
function caretCoords(el, pos) {
  const cs = getComputedStyle(el);
  const div = document.createElement("div");
  MIRROR_PROPS.forEach((p) => (div.style[p] = cs[p]));
  Object.assign(div.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre-wrap", wordWrap: "break-word", top: "0", left: "-9999px" });
  div.textContent = el.value.slice(0, pos);
  const span = document.createElement("span");
  span.textContent = el.value.slice(pos) || ".";
  div.appendChild(span);
  document.body.appendChild(div);
  const coords = {
    top: span.offsetTop + parseFloat(cs.borderTopWidth) - el.scrollTop,
    left: span.offsetLeft + parseFloat(cs.borderLeftWidth) - el.scrollLeft,
    height: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5,
  };
  document.body.removeChild(div);
  return coords;
}

/** Character offset of a click inside `container`'s rendered text. */
function offsetFromPoint(container, x, y) {
  let node;
  let offset;
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (!r) return null;
    node = r.startContainer;
    offset = r.startOffset;
  } else if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (!p) return null;
    node = p.offsetNode;
    offset = p.offset;
  }
  if (!node || !container.contains(node)) return null;
  const range = document.createRange();
  range.setStart(container, 0);
  range.setEnd(node, offset);
  return range.toString().replace(/​/g, "").length;
}

const LIST_TYPES = new Set(["task", "bullet", "number"]);

function continuation(info) {
  if (info.type === "task") return `${info.indent}- [ ] `;
  if (info.type === "bullet") return info.prefix;
  if (info.type === "number") return `${info.indent}${info.n + 1}${info.delim} `;
  if (info.type === "quote") return "> ";
  return "";
}

const TOOLS = [
  { id: "h", label: "H", title: "Heading (cycles H1-H3)" },
  { id: "b", label: "B", title: "Bold (Ctrl+B)", className: "font-bold" },
  { id: "i", label: "I", title: "Italic (Ctrl+I)", className: "italic" },
  { id: "task", label: "☑", title: "Tick marker (Ctrl+L)" },
  { id: "list", label: "•", title: "Bullet" },
  { id: "link", label: "[[ ]]", title: "Link to a note" },
];

/**
 * Live-preview note editor (Obsidian style): every line stays rendered, the line being
 * edited shows its text, and tick markers / bullets / links are clickable at all times.
 */
export default function NoteEditor({ noteId, value, onChange, compact = false, placeholder = "Start writing...", toolbar = true, className = "" }) {
  const { notes, findByTitle, openOrCreateByTitle } = useNotes();
  const navigate = useNavigate();
  const [active, setActive] = useState(null); // first line of the block being edited
  const [source, setSource] = useState(false);
  const [suggest, setSuggest] = useState(null); // { query, start, index, top, left }
  const [, setTick] = useState(0);
  const taRef = useRef(null);
  const srcRef = useRef(null);
  const wrapRef = useRef(null);
  const pending = useRef(null); // caret to place after the next render
  const switching = useRef(false); // ignore the blur caused by moving between lines

  const lines = useMemo(() => value.split("\n"), [value]);
  const blocks = useMemo(() => segmentBlocks(lines), [lines]);
  const blockIdx = blocks.findIndex((b) => b.start === active);
  const activeBlock = blockIdx >= 0 ? blocks[blockIdx] : null;
  const activeInfo = activeBlock && !activeBlock.code ? splitPrefix(lines[activeBlock.start]) : null;
  const activeText = activeBlock
    ? activeBlock.code
      ? lines.slice(activeBlock.start, activeBlock.end + 1).join("\n")
      : activeInfo.content
    : "";

  useLayoutEffect(() => {
    for (const ta of [taRef.current, srcRef.current]) {
      if (!ta) continue;
      ta.style.height = "0px";
      ta.style.height = `${ta.scrollHeight}px`;
    }
    const ta = taRef.current;
    if (ta && pending.current !== null) {
      const caret = Math.min(pending.current, ta.value.length);
      pending.current = null;
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(caret, caret);
    }
    switching.current = false;
  });

  const linkExists = (title) => Boolean(findByTitle(title));
  const openLink = async (title) => {
    const note = await openOrCreateByTitle(title);
    if (note) navigate(`/notes/${note.id}`);
  };

  const commit = (next) => onChange(next.join("\n"));
  const replaced = (from, to, newLines) => {
    const next = [...lines];
    next.splice(from, to - from + 1, ...newLines);
    return next;
  };
  const focusLine = (start, caret) => {
    switching.current = true;
    pending.current = caret;
    setActive(start);
    setSuggest(null);
    setTick((t) => t + 1);
  };
  const deactivate = () => {
    setActive(null);
    setSuggest(null);
  };

  const contentLength = (b) =>
    b.code ? lines.slice(b.start, b.end + 1).join("\n").length : splitPrefix(lines[b.start]).content.length;

  const moveTo = (idx, column) => {
    const b = blocks[idx];
    if (!b) return;
    focusLine(b.start, column === Infinity ? contentLength(b) : Math.min(column, contentLength(b)));
  };

  /** Replace the active (single) line, keeping the caret at the same raw position. */
  const setActiveLine = (newLine, rawCaret) => {
    const start = activeBlock.start;
    commit(replaced(start, start, [newLine]));
    const info = splitPrefix(newLine);
    focusLine(start, /^```/.test(newLine) ? rawCaret : Math.max(0, rawCaret - info.prefix.length));
  };

  // ----- [[ suggestions -----

  const suggestions = useMemo(() => {
    if (!suggest) return [];
    const q = suggest.query.trim().toLowerCase();
    const matches = notes
      .filter((n) => n.id !== noteId && n.title.toLowerCase().includes(q))
      .sort((a, b) => Number(b.title.toLowerCase().startsWith(q)) - Number(a.title.toLowerCase().startsWith(q)))
      .slice(0, 6)
      .map((n) => ({ title: n.title, kind: n.kind }));
    if (q && !notes.some((n) => n.title.toLowerCase() === q)) matches.push({ title: suggest.query.trim(), create: true });
    return matches;
  }, [suggest, notes, noteId]);

  const updateSuggest = (ta) => {
    const caret = ta.selectionStart;
    if (caret !== ta.selectionEnd || !wrapRef.current) return setSuggest(null);
    const m = ta.value.slice(0, caret).match(/\[\[([^[\]\n|]*)$/);
    if (!m) return setSuggest(null);
    const c = caretCoords(ta, caret);
    const tr = ta.getBoundingClientRect();
    const wr = wrapRef.current.getBoundingClientRect();
    setSuggest((prev) => ({
      query: m[1],
      start: caret - m[1].length - 2,
      index: prev && prev.query === m[1] ? prev.index : 0,
      top: tr.top - wr.top + c.top + c.height + 2,
      left: Math.max(0, Math.min(tr.left - wr.left + c.left, wr.width - 230)),
    }));
  };

  const chooseSuggestion = (item) => {
    const ta = taRef.current;
    const content = ta.value;
    const caret = ta.selectionStart;
    const after = content.slice(caret).startsWith("]]") ? content.slice(caret + 2) : content.slice(caret);
    const link = `[[${item.title}]]`;
    const nextContent = content.slice(0, suggest.start) + link + after;
    if (activeBlock.code) return;
    setActiveLine(activeInfo.prefix + nextContent, activeInfo.prefix.length + suggest.start + link.length);
  };

  // ----- line transforms -----

  const toggleTaskOn = (line) => {
    const info = splitPrefix(line);
    if (info.type === "task") return line.replace(/^(\s*[-*+] \[)([ xX])/, (_, a, c) => a + (c === " " ? "x" : " "));
    if (info.type === "bullet" || info.type === "number") return `${info.indent}- [ ] ${info.content}`;
    return `- [ ] ${info.content}`;
  };

  const appendLine = (text, caretInContent) => {
    const last = lines.length - 1;
    const next = lines[last].trim() === "" ? replaced(last, last, [text]) : [...lines, text];
    commit(next);
    const index = lines[last].trim() === "" ? last : lines.length;
    focusLine(index, caretInContent ?? splitPrefix(text).content.length);
  };

  const wrapSelection = (before, after = before) => {
    const ta = taRef.current;
    const { selectionStart: s, selectionEnd: e } = ta;
    const content = ta.value;
    const next = content.slice(0, s) + before + content.slice(s, e) + after + content.slice(e);
    if (activeBlock.code) return;
    commit(replaced(activeBlock.start, activeBlock.start, [activeInfo.prefix + next]));
    pending.current = e + before.length;
    switching.current = true;
    setTick((t) => t + 1);
  };

  const runTool = (id) => {
    if (source) return;
    const editingLine = activeBlock && !activeBlock.code;
    if (!editingLine) {
      const snippets = { h: ["# ", 0], b: ["****", 2], i: ["**", 1], task: ["- [ ] ", 0], list: ["- ", 0], link: ["[[", 2] };
      const [text, caret] = snippets[id];
      appendLine(text, caret);
      return;
    }
    const ta = taRef.current;
    const raw = lines[activeBlock.start];
    const caretRaw = activeInfo.prefix.length + ta.selectionStart;
    if (id === "b") wrapSelection("**");
    else if (id === "i") wrapSelection("*");
    else if (id === "link") {
      wrapSelection("[[", "]]");
      requestAnimationFrame(() => taRef.current && updateSuggest(taRef.current));
    } else if (id === "task") {
      const next = toggleTaskOn(raw);
      setActiveLine(next, caretRaw + (next.length - raw.length));
    } else if (id === "list") {
      const next = activeInfo.type === "bullet" ? `${activeInfo.indent}${activeInfo.content}` : `${activeInfo.indent}- ${activeInfo.content}`;
      setActiveLine(next, caretRaw + (next.length - raw.length));
    } else if (id === "h") {
      const level = activeInfo.type === "heading" ? activeInfo.level : 0;
      const next = level >= 3 ? activeInfo.content : `${"#".repeat(level + 1)} ${activeInfo.content}`;
      setActiveLine(next, caretRaw + (next.length - raw.length));
    }
  };

  // ----- events on the active line -----

  const onInput = (e) => {
    const ta = e.target;
    const text = ta.value;
    if (activeBlock.code) {
      commit(replaced(activeBlock.start, activeBlock.end, text.split("\n")));
      return;
    }
    const prefix = activeInfo.prefix;
    const rawCaret = prefix.length + ta.selectionStart;
    if (text.includes("\n")) {
      const parts = (prefix + text).split("\n");
      commit(replaced(activeBlock.start, activeBlock.start, parts));
      const last = parts[parts.length - 1];
      focusLine(activeBlock.start + parts.length - 1, last.length - splitPrefix(last).prefix.length);
      return;
    }
    const newLine = prefix + text;
    const info = splitPrefix(newLine);
    if (info.prefix !== prefix || /^```/.test(newLine)) {
      // Typing "- ", "1. ", "# ", "- [ ] " or ``` turned the line into something new.
      setActiveLine(newLine, rawCaret);
      return;
    }
    commit(replaced(activeBlock.start, activeBlock.start, [newLine]));
    updateSuggest(ta);
  };

  const onPaste = (e) => {
    if (activeBlock.code) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\n")) return;
    e.preventDefault();
    const ta = e.currentTarget;
    const before = ta.value.slice(0, ta.selectionStart);
    const after = ta.value.slice(ta.selectionEnd);
    const parts = text.replace(/\r\n?/g, "\n").split("\n");
    const newLines = parts.map((p, i) => (i === 0 ? activeInfo.prefix + before + p : p));
    const lastIdx = newLines.length - 1;
    const lastCaret = newLines[lastIdx].length;
    newLines[lastIdx] += after;
    commit(replaced(activeBlock.start, activeBlock.start, newLines));
    focusLine(activeBlock.start + lastIdx, Math.max(0, lastCaret - splitPrefix(newLines[lastIdx]).prefix.length));
  };

  const onKeyDown = (e) => {
    const ta = e.currentTarget;
    if (suggest && suggestions.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const dir = e.key === "ArrowDown" ? 1 : -1;
        setSuggest((p) => ({ ...p, index: (p.index + dir + suggestions.length) % suggestions.length }));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        chooseSuggestion(suggestions[suggest.index] || suggestions[0]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSuggest(null);
        return;
      }
    }

    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    const caret = ta.selectionStart;
    const selEnd = ta.selectionEnd;
    const collapsed = caret === selEnd;

    if (key === "Escape") {
      e.preventDefault();
      ta.blur();
      deactivate();
      return;
    }
    if (mod && key.toLowerCase() === "l" && !activeBlock.code) {
      e.preventDefault();
      runTool("task");
      return;
    }
    if (mod && (key.toLowerCase() === "b" || key.toLowerCase() === "i") && !activeBlock.code) {
      e.preventDefault();
      wrapSelection(key.toLowerCase() === "b" ? "**" : "*");
      return;
    }

    // Moving between lines.
    if ((key === "ArrowUp" || key === "ArrowDown") && collapsed && !e.shiftKey) {
      const c = caretCoords(ta, caret);
      if (key === "ArrowUp" && c.top < c.height * 0.6 && blockIdx > 0) {
        e.preventDefault();
        moveTo(blockIdx - 1, activeBlock.code ? Infinity : caret);
      } else if (key === "ArrowDown" && c.top + c.height * 1.4 >= ta.scrollHeight && blockIdx < blocks.length - 1) {
        e.preventDefault();
        moveTo(blockIdx + 1, activeBlock.code ? 0 : caret);
      }
      return;
    }
    if (key === "ArrowLeft" && collapsed && caret === 0 && blockIdx > 0 && !e.shiftKey) {
      e.preventDefault();
      moveTo(blockIdx - 1, Infinity);
      return;
    }
    if (key === "ArrowRight" && collapsed && caret === ta.value.length && blockIdx < blocks.length - 1 && !e.shiftKey) {
      e.preventDefault();
      moveTo(blockIdx + 1, 0);
      return;
    }

    if (activeBlock.code) return; // inside code blocks Enter/Backspace behave normally

    const info = activeInfo;
    const start = activeBlock.start;
    const content = ta.value;

    if (key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const before = content.slice(0, caret);
      const after = content.slice(selEnd);
      if (LIST_TYPES.has(info.type) && content.trim() === "") {
        // Enter on an empty item: outdent it, or end the list.
        setActiveLine(info.indent.length >= 2 ? info.prefix.slice(2) : "", 0);
        return;
      }
      if (caret === 0 && selEnd === 0 && content !== "" && !e.shiftKey) {
        commit(replaced(start, start, ["", lines[start]]));
        focusLine(start + 1, 0);
        return;
      }
      const nextPrefix = e.shiftKey ? "" : continuation(info);
      commit(replaced(start, start, [info.prefix + before, nextPrefix + after]));
      focusLine(start + 1, 0);
      return;
    }

    if (key === "Backspace" && collapsed && caret === 0) {
      if (info.prefix) {
        e.preventDefault();
        // Backspace at the start of an item outdents it, then drops the marker.
        const next = info.indent.length >= 2 ? info.prefix.slice(2) + content : content;
        setActiveLine(next, info.indent.length >= 2 ? info.prefix.length - 2 : 0);
        return;
      }
      const prev = blocks[blockIdx - 1];
      if (prev && !prev.code) {
        e.preventDefault();
        const prevLine = lines[prev.start];
        const prevInfo = splitPrefix(prevLine);
        if (prevInfo.type === "hr") {
          commit(replaced(prev.start, start, [content]));
          focusLine(prev.start, 0);
        } else {
          commit(replaced(prev.start, start, [prevLine + content]));
          focusLine(prev.start, prevInfo.content.length);
        }
      }
      return;
    }

    if (key === "Delete" && collapsed && caret === content.length) {
      const next = blocks[blockIdx + 1];
      if (next && !next.code) {
        e.preventDefault();
        const nextInfo = splitPrefix(lines[next.start]);
        commit(replaced(start, next.start, [info.prefix + content + nextInfo.content]));
        focusLine(start, caret);
      }
      return;
    }

    if (key === "Tab" && LIST_TYPES.has(info.type)) {
      e.preventDefault();
      const prefix = e.shiftKey ? info.prefix.replace(/^ {1,2}/, "") : `  ${info.prefix}`;
      commit(replaced(start, start, [prefix + content]));
      focusLine(start, caret);
    }
  };

  const onBlur = (e) => {
    if (switching.current || wrapRef.current?.contains(e.relatedTarget)) return;
    deactivate();
  };

  // ----- clicking rendered lines -----

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest("[data-interactive], textarea, [data-toolbar], [role=listbox], a")) return;
    e.preventDefault();
    const row = e.target.closest("[data-block]");
    if (!row) {
      moveTo(blocks.length - 1, Infinity);
      return;
    }
    const b = blocks.find((x) => x.start === Number(row.dataset.block));
    if (!b) return;
    if (b.code) {
      focusLine(b.start, contentLength(b));
      return;
    }
    const info = splitPrefix(lines[b.start]);
    let caret = info.content.length;
    const contentEl = row.querySelector("[data-content]");
    if (contentEl) {
      const offset = offsetFromPoint(contentEl, e.clientX, e.clientY);
      if (offset !== null) caret = Math.min(info.content.length, renderedToRaw(info.content, offset));
      else if (e.clientX < contentEl.getBoundingClientRect().left) caret = 0;
    }
    focusLine(b.start, caret);
  };

  const lineTextarea = (
    <textarea
      ref={taRef}
      value={activeText}
      rows={1}
      placeholder={lines.length === 1 ? placeholder : ""}
      onChange={onInput}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) && updateSuggest(e.currentTarget)}
      onClick={(e) => updateSuggest(e.currentTarget)}
      onBlur={onBlur}
      onPaste={onPaste}
      spellCheck
      className="block w-full min-w-0 flex-1 resize-none overflow-hidden bg-transparent p-0 text-ink caret-indigo-300 outline-none placeholder:text-surface-muted"
      style={{ font: "inherit", lineHeight: "inherit", letterSpacing: "inherit" }}
    />
  );

  return (
    <div ref={wrapRef} className={`relative flex flex-col ${className}`}>
      {toolbar && (
        <div data-toolbar className={`mb-2 flex items-center gap-0.5 ${compact ? "" : "border-b border-surface-border pb-2"}`}>
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              title={t.title}
              disabled={source}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runTool(t.id)}
              className={`min-w-[28px] rounded-md px-1.5 py-1 text-xs text-surface-muted hover:bg-surface hover:text-ink disabled:opacity-30 ${t.className || ""}`}
            >
              {t.label}
            </button>
          ))}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              deactivate();
              setSource((s) => !s);
            }}
            title={source ? "Back to live preview" : "Edit the raw markdown"}
            className="ml-auto rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-surface-muted hover:bg-surface hover:text-ink"
          >
            {source ? "Live" : "Source"}
          </button>
        </div>
      )}

      {source ? (
        <textarea
          ref={srcRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck
          className={`w-full flex-1 resize-none overflow-hidden bg-transparent font-mono leading-relaxed text-ink focus:outline-none ${
            compact ? "min-h-[80px] text-[12.5px]" : "min-h-[240px] text-[13px]"
          }`}
        />
      ) : (
        <div
          onMouseDown={onMouseDown}
          className={`flex-1 cursor-text leading-relaxed text-ink ${compact ? "min-h-[64px] text-[13px]" : "min-h-[240px] text-sm"}`}
        >
          {blocks.map((b) => {
            const isActive = b.start === active;
            if (b.code) {
              return isActive ? (
                <textarea
                  key={b.start}
                  ref={taRef}
                  value={activeText}
                  onChange={onInput}
                  onKeyDown={onKeyDown}
                  onBlur={onBlur}
                  spellCheck={false}
                  className="my-2 block w-full resize-none overflow-hidden rounded-lg bg-surface p-3 font-mono text-xs text-ink outline-none ring-1 ring-indigo-400/40"
                />
              ) : (
                <pre key={b.start} data-block={b.start} className="my-2 overflow-x-auto rounded-lg bg-surface p-3 font-mono text-xs text-ink">
                  {lines.slice(b.start + 1, /^```/.test(lines[b.end]) && b.end > b.start ? b.end : b.end + 1).join("\n") || " "}
                </pre>
              );
            }
            return (
              <div key={b.start} data-block={b.start}>
                <LineRow
                  line={lines[b.start]}
                  lineIndex={b.start}
                  compact={compact}
                  onToggleTask={(i) => onChange(toggleTaskLine(value, i))}
                  onOpenLink={openLink}
                  linkExists={linkExists}
                  slot={isActive ? lineTextarea : undefined}
                  placeholder={lines.length === 1 && !value ? placeholder : undefined}
                />
              </div>
            );
          })}
        </div>
      )}

      {suggest && suggestions.length > 0 && (
        <ul
          className="absolute z-50 w-56 animate-fade-in overflow-hidden rounded-lg border border-surface-border bg-surface-card py-1 shadow-2xl"
          style={{ top: suggest.top, left: suggest.left }}
          role="listbox"
        >
          {suggestions.map((item, i) => (
            <li key={`${item.title}-${i}`}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  chooseSuggestion(item);
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                  i === suggest.index ? "bg-indigo-500/20 text-ink" : "text-ink-soft hover:bg-surface"
                }`}
              >
                <span className="text-surface-muted">{item.create ? "+" : item.kind === "graph" ? "◇" : "¶"}</span>
                <span className="truncate">{item.create ? `Create "${item.title}"` : item.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
