import TabooAnalysisPanel from '../TabooAnalysisPanel';

export default function ResultPolicyTab({ toneAnalysis, onSeek }) {
  return (
    <TabooAnalysisPanel toneAnalysis={toneAnalysis} showEmptyHint onSeek={onSeek} />
  );
}
