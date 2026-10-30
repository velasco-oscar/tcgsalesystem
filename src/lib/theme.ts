import { useEffect, useState } from "react";

// Preferencia de apariencia de este equipo; "system" sigue al tema de Windows.
export type ThemeChoice = "system" | "light" | "dark";
const THEME_KEY = "tcg-pos.theme.v1";
const darkQuery = "(prefers-color-scheme: dark)";

export function readTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = choice;
}

function systemPrefersDark() {
  return typeof window.matchMedia === "function" ? window.matchMedia(darkQuery).matches : true;
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(darkQuery);
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    applyTheme(choice);
    try {
      if (choice === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, choice);
    } catch { /* Sin almacenamiento la elección dura solo esta sesión. */ }
  }, [choice]);

  const resolved: "light" | "dark" = choice === "system" ? (systemDark ? "dark" : "light") : choice;
  return { choice, resolved, setChoice };
}
