import { useState, useEffect, useRef, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugin/wavesurfer.regions.min.js';
import { createAuthenticatedAudioBlobUrl } from '../utils/authenticatedAudio';
import { calculateEnergy } from '../components/result/toneUtils';

/**
 * WaveSurfer lifecycle, playback, and tone/taboo region overlays for ResultPage.
 */
export default function useResultWaveform(audioFileName, toneAnalysis) {
  const waveformRef = useRef(null);
  const [waveSurfer, setWaveSurfer] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isWaveformReady, setIsWaveformReady] = useState(false);
  const [audioLoadError, setAudioLoadError] = useState('');

  useEffect(() => {
    if (!audioFileName || !waveformRef.current) return;
    let objectUrl = null;
    let cancelled = false;
    setAudioLoadError('');

    const ws = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: 'var(--color-accent)',
      progressColor: 'var(--color-accent-hover)',
      cursorColor: 'var(--color-danger)',
      cursorWidth: 1,
      height: 48,
      responsive: true,
      normalize: true,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      backend: 'WebAudio',
      fillParent: true,
      scrollParent: false,
      hideScrollbar: true,
      minPxPerSec: 0.1,
      interact: true,
      crossOrigin: 'anonymous',
      plugins: [RegionsPlugin.create({ regions: [], dragSelection: false })],
    });

    ws.on('ready', () => {
      setIsWaveformReady(true);
      const containerWidth = waveformRef.current?.clientWidth || 300;
      const duration = ws.getDuration();
      if (duration > 0) {
        const pixelsPerSecond = containerWidth / duration;
        ws.zoom(pixelsPerSecond / ws.params.minPxPerSec);
      }
    });

    createAuthenticatedAudioBlobUrl(audioFileName)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        ws.load(url);
      })
      .catch((err) => {
        if (!cancelled) {
          setIsWaveformReady(false);
          setAudioLoadError(err?.message || 'Could not load call recording.');
        }
      });

    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    ws.on('finish', () => setIsPlaying(false));
    setWaveSurfer(ws);

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      ws.destroy();
      setWaveSurfer(null);
      setIsWaveformReady(false);
      setAudioLoadError('');
    };
  }, [audioFileName]);

  useEffect(() => {
    if (!toneAnalysis || !waveSurfer || !isWaveformReady || !waveformRef.current) return;
    try {
      waveSurfer.clearRegions();
      const regions = [];
      const tabooHits = toneAnalysis?.taboo_analysis?.hits || [];
      tabooHits.forEach((hit) => {
        if (hit.start == null || hit.end == null) return;
        regions.push({
          start: hit.start,
          end: Math.max(hit.end, hit.start + 0.3),
          color: hit.role === 'Agent' ? 'rgba(239, 68, 68, 0.22)' : 'rgba(245, 158, 11, 0.18)',
          drag: false,
          resize: false,
        });
      });
      ['Agent', 'Customer'].forEach((speaker) => {
        const speakerData = toneAnalysis?.results[speaker];
        if (!speakerData) return;
        Object.keys(speakerData).forEach((key) => {
          const segment = speakerData[key];
          const energy = calculateEnergy(segment.tone_distribution);
          let regionColor;
          if (energy > 700) {
            regionColor = 'rgba(239, 68, 68, 0.14)';
          } else if (energy > 300) {
            regionColor = 'rgba(245, 158, 11, 0.16)';
          } else {
            return;
          }
          regions.push({
            start: segment.start || parseFloat(key.match(/(\d+\.\d+)/)[0]),
            end: segment.end || parseFloat(key.match(/(\d+\.\d+)$/)[0]),
            color: regionColor,
            drag: false,
            resize: false,
          });
        });
      });
      regions.forEach((region) => {
        try { waveSurfer.addRegion(region); } catch { /* ignore bad region */ }
      });
    } catch { /* region overlay is best-effort */ }
  }, [toneAnalysis, waveSurfer, isWaveformReady]);

  const handlePlayPause = useCallback(() => {
    waveSurfer?.playPause();
  }, [waveSurfer]);

  const handleTranscriptSeek = useCallback((seconds) => {
    if (!waveSurfer || seconds == null) return;
    const duration = waveSurfer.getDuration();
    if (!duration) return;
    waveSurfer.seekTo(Math.min(Math.max(seconds / duration, 0), 1));
    waveSurfer.play();
  }, [waveSurfer]);

  return {
    waveformRef,
    isPlaying,
    isWaveformReady,
    audioLoadError,
    handlePlayPause,
    handleTranscriptSeek,
  };
}
