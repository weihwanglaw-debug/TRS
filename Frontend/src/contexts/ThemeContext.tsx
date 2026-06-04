import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";

type Theme = "a" | "b";

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeState>({ theme: "a", toggleTheme: () => {} });

export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem("trs_theme") as Theme) || "a";
  });

  useEffect(() => {
    document.body.setAttribute("data-theme", theme);
    localStorage.setItem("trs_theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "a" ? "b" : "a"));

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
