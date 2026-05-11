/**
 * Wrap plain text to a fixed terminal width, breaking long tokens when needed.
 *
 * The name of this module is a leftover from when comments rendered as a
 * floating "agent popover"; the popover surface is gone, but the wrapping
 * helper is still the single source of truth for soft-wrapping comment prose.
 */
export function wrapText(text: string, width: number) {
  if (width <= 0) {
    return [""];
  }

  const normalized = text.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) {
    return [""];
  }

  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.length > 0) {
      lines.push(current);
      current = "";
    }
  };

  for (const word of words) {
    if (word.length > width) {
      pushCurrent();
      for (let offset = 0; offset < word.length; offset += width) {
        lines.push(word.slice(offset, offset + width));
      }
      continue;
    }

    const next = current.length === 0 ? word : `${current} ${word}`;
    if (next.length <= width) {
      current = next;
      continue;
    }

    pushCurrent();
    current = word;
  }

  pushCurrent();
  return lines.length > 0 ? lines : [""];
}
