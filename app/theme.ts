export type Theme = "auto" | "light" | "dark"

const THEMES: ReadonlyArray<Theme> = ["auto", "light", "dark"]

export const isTheme = (v: unknown): v is Theme => THEMES.includes(v as Theme)

/** The theme button cycles auto → light → dark. */
export const nextTheme = (t: Theme): Theme => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length]
