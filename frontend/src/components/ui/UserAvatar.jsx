import useProfilePicture from "../../utils/useProfilePicture";
import { usernameInitials, usernameHue } from "../../utils/userDisplay";
import "./ui.css";

const SIZE_PX = {
  sm: 28,
  md: 36,
  lg: 48,
  xl: 72,
  hero: 116,
};

/**
 * Profile photo with authenticated fetch, or initials fallback when none uploaded.
 * Pass `src` to override (e.g. local preview during upload).
 */
export default function UserAvatar({
  username = "",
  src,
  size = "md",
  className = "",
  alt = "",
  title,
}) {
  const fetchedSrc = useProfilePicture(username);
  const resolvedSrc = src || fetchedSrc;
  const px = SIZE_PX[size] || SIZE_PX.md;
  const initials = usernameInitials(username);
  const hue = usernameHue(username);

  if (resolvedSrc) {
    return (
      <img
        src={resolvedSrc}
        alt={alt || `${username || "User"} profile`}
        title={title}
        className={`user-avatar user-avatar--img user-avatar--${size} ${className}`.trim()}
        style={{ width: px, height: px }}
      />
    );
  }

  return (
    <span
      className={`user-avatar user-avatar--fallback user-avatar--${size} ${className}`.trim()}
      style={{
        width: px,
        height: px,
        "--avatar-hue": hue,
      }}
      title={title || username || "User"}
      aria-hidden={alt ? undefined : true}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
    >
      {initials}
    </span>
  );
}
