import { FaMoon, FaSun } from "react-icons/fa";
import { useTheme } from "../../theme/ThemeProvider";

/**
 * Theme switch.
 *  - compact: round icon button (used in the navbar)
 *  - default: animated sliding track toggle with sun/moon
 */
export default function ThemeToggle({ compact = false }) {
  const { theme, toggleTheme } = useTheme();
  const isLight = theme === "light";

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
        title={isLight ? "Switch to dark mode" : "Switch to light mode"}
        className="ui-theme-toggle ui-theme-toggle--compact"
      >
        <span className="ui-theme-toggle__icon" key={theme}>
          {isLight ? <FaMoon /> : <FaSun />}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      role="switch"
      aria-checked={isLight}
      aria-label="Toggle color theme"
      className={`ui-theme-track ${isLight ? "is-light" : "is-dark"}`}
    >
      <span className="ui-theme-track__thumb">{isLight ? <FaSun /> : <FaMoon />}</span>
      <FaSun className="ui-theme-track__sun" />
      <FaMoon className="ui-theme-track__moon" />
    </button>
  );
}
