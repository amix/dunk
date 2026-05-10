/** Repo-relative paths under `.dunk/` shared by comments persistence, watch mode, and config. */
import { join } from "node:path";

export const DUNK_DIR = ".dunk";

export const DUNK_COMMENTS_FILENAME = "comments.json";
export const DUNK_CONFIG_FILENAME = "config.toml";

export const DUNK_COMMENTS_RELATIVE_PATH = join(DUNK_DIR, DUNK_COMMENTS_FILENAME);
export const DUNK_CONFIG_RELATIVE_PATH = join(DUNK_DIR, DUNK_CONFIG_FILENAME);
