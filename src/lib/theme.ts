/**
 * Light, dark, or whatever the phone says.
 *
 * The choice is resolved to an explicit `data-theme` on <html>, which is
 * the only thing the stylesheet keys on. Kept in localStorage rather than
 * the database: it has to be applied before the first paint, and the
 * database opens asynchronously.
 */
export type ThemeChoice = "system" | "light" | "dark";

const KEY = "varg.theme";

/** Matches --bg in styles.css; tints the browser / task-switcher chrome. */
const CHROME = { light: "#e3e5e3", dark: "#0f1317" } as const;

export function loadTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function systemDark(): MediaQueryList | undefined {
  return typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : undefined;
}

function apply(choice: ThemeChoice): void {
  const resolved = choice === "system" ? (systemDark()?.matches ? "dark" : "light") : choice;
  document.documentElement.setAttribute("data-theme", resolved);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", CHROME[resolved]);
}

export function saveTheme(choice: ThemeChoice): void {
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Storage unavailable: the theme still applies for this run.
  }
  apply(choice);
}

/** Call once, before the first render. Follows the phone while on "system". */
export function initTheme(): void {
  apply(loadTheme());
  systemDark()?.addEventListener("change", () => {
    apply(loadTheme());
  });
}
