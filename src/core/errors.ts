export class DunkUserError extends Error {
  readonly details: string[];

  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = "DunkUserError";
    this.details = details;
  }
}

/** Format CLI and startup failures without exposing Bun internal stack frames for expected errors. */
export function formatCliError(error: unknown) {
  if (error instanceof DunkUserError) {
    const lines = [`dunk: ${error.message}`];

    if (error.details.length > 0) {
      lines.push("", ...error.details);
    }

    return `${lines.join("\n")}\n`;
  }

  if (error instanceof Error) {
    if (process.env.DUNK_DEBUG === "1" && error.stack) {
      return `${error.stack}\n`;
    }

    return `dunk: ${error.message}\n`;
  }

  return `dunk: ${String(error)}\n`;
}
