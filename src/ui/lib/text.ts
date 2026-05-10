/** Clamp text to a fixed width with a configurable truncation marker. */
export function fitText(text: string, width: number, marker = "…") {
  if (width <= 0) {
    return "";
  }

  if (text.length <= width) {
    return text;
  }

  if (width === 1) {
    return marker;
  }

  return `${text.slice(0, width - 1)}${marker}`;
}

/** Clamp and then right-pad text to an exact width. */
export function padText(text: string, width: number, marker = "…") {
  const trimmed = fitText(text, width, marker);
  return trimmed.padEnd(width, " ");
}
