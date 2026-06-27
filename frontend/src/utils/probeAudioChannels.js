/**
 * Decode audio in-browser (offline-safe) and return channel count.
 * Returns null when the format cannot be probed in this browser.
 */
export async function probeAudioChannels(file) {
  if (!file || typeof window === 'undefined') return null;

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;

  const ctx = new AudioCtx();
  try {
    const buffer = await file.arrayBuffer();
    const audio = await ctx.decodeAudioData(buffer.slice(0));
    return audio.numberOfChannels;
  } catch {
    return null;
  } finally {
    try {
      await ctx.close();
    } catch {
      /* ignore */
    }
  }
}

export function channelLabel(count) {
  if (count == null) return 'Unknown';
  if (count === 1) return 'Mono (1 channel)';
  if (count === 2) return 'Stereo (2 channels)';
  return `${count} channels`;
}

export function isStereoRecording(count) {
  return count != null && count >= 2;
}
