import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { readSidebarCollapsed, writeSidebarCollapsed } from "../utils/uiPreferences";

const SidebarStateContext = createContext(null);

/**
 * Sidebar collapse lives here so it survives route changes, login, and layout remounts.
 */
export function SidebarStateProvider({ children }) {
  const [collapsed, setCollapsedState] = useState(readSidebarCollapsed);

  useLayoutEffect(() => {
    setCollapsedState(readSidebarCollapsed());
  }, []);

  const setCollapsed = useCallback((value) => {
    setCollapsedState((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      writeSidebarCollapsed(next);
      return next;
    });
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((v) => !v);
  }, [setCollapsed]);

  const value = useMemo(
    () => ({ collapsed, setCollapsed, toggleCollapsed }),
    [collapsed, setCollapsed, toggleCollapsed]
  );

  return (
    <SidebarStateContext.Provider value={value}>
      {children}
    </SidebarStateContext.Provider>
  );
}

export function useSidebarCollapsed() {
  const ctx = useContext(SidebarStateContext);
  if (!ctx) {
    throw new Error("useSidebarCollapsed must be used within SidebarStateProvider");
  }
  return ctx;
}
