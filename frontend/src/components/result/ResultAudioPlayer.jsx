import { FaPlay, FaPause, FaVolumeUp, FaDownload } from 'react-icons/fa';
import { formatTimeSec } from './resultUtils';

export default function ResultAudioPlayer({
  waveformRef,
  isPlaying,
  onPlayPause,
  onDownloadClick,
  duration,
}) {
  return (
    <section className="rp-player">
      <div className="rp-player__controls">
        <button type="button" className="rp-player__play" onClick={onPlayPause} aria-label={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? <FaPause /> : <FaPlay />}
        </button>
        <FaVolumeUp className="rp-player__vol-icon" />
      </div>
      <div className="rp-player__wave" ref={waveformRef} />
      <span className="rp-player__duration">
        {duration ? formatTimeSec(duration) : '--:--'}
      </span>
      <button
        type="button"
        className="rp-player__download"
        onClick={onDownloadClick}
        aria-label="Download Audio"
        title="Download secure ZIP"
      >
        <FaDownload />
      </button>
    </section>
  );
}
