import { createContext, useCallback, useContext, useEffect, useState } from "react";

const ThemeContext = createContext({ dark: false, toggle: () => {} });
const KEY = "yogurt.theme";

function initial() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return saved === "dark";
  } catch {
    // no storage - fall back to the OS setting
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/** Light (Aqua) / dark appearance; follows the OS until the user picks one. */
export function ThemeProvider({ children }) {
  const [dark, setDark] = useState(initial);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }, [dark]);

  const toggle = useCallback(() => {
    setDark((d) => {
      try {
        localStorage.setItem(KEY, d ? "light" : "dark");
      } catch {
        // preference just won't persist
      }
      return !d;
    });
  }, []);

  return <ThemeContext.Provider value={{ dark, toggle }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
