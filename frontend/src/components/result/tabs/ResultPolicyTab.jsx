import { TabooAnalysisPanel } from '../SecureDownloadModal';

export default function ResultPolicyTab({ toneAnalysis, onSeek }) {
  return (
    <TabooAnalysisPanel toneAnalysis={toneAnalysis} showEmptyHint onSeek={onSeek} />
  );
}
