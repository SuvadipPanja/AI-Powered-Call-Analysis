import { useState, useEffect } from "react";
import {
  getProfilePictureUrl,
  loadProfilePicture,
  subscribeProfilePicture,
} from "./profilePictureCache";

/**
 * Returns a displayable object-URL for a user's profile picture (or "").
 * Uses a shared cache so multiple avatars for the same user share one fetch.
 *
 * Re-fetches when a "profile-pic-updated" event fires (after an upload).
 */
export default function useProfilePicture(username) {
  const [objectUrl, setObjectUrl] = useState(() => getProfilePictureUrl(username));

  useEffect(() => {
    if (!username) {
      setObjectUrl("");
      return undefined;
    }

    let cancelled = false;

    const apply = () => {
      if (!cancelled) setObjectUrl(getProfilePictureUrl(username));
    };

    apply();
    loadProfilePicture(username).then((url) => {
      if (!cancelled) setObjectUrl(url);
    });

    const unsub = subscribeProfilePicture((changed) => {
      if (changed && changed !== username) return;
      loadProfilePicture(username).then((url) => {
        if (!cancelled) setObjectUrl(url);
      });
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [username]);

  return objectUrl;
}
