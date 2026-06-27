const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/components/ResultPage.jsx');
let s = fs.readFileSync(filePath, 'utf8');

// 1) Trim utility block before ResultPage component
const compStart = s.indexOf('const ResultPage = () => {');
if (compStart < 0) throw new Error('ResultPage not found');
const afterChartRegister = s.indexOf('ChartJS.register');
const utilStart = s.indexOf('\nfunction parseToSeconds', afterChartRegister);
if (utilStart > 0 && utilStart < compStart) {
  const importBlock = `
import {
  formatTimeSec, formatWPM, alphaColor, hexA, num, rubricPercent,
  formatScoreCell, getScoreBand, RUBRIC, SPEAKER_COLORS, QUERY_TYPE_COLORS,
} from './result/resultUtils';
import ScoreRing from './result/ScoreRing';
import SecureDownloadModal, { TabooAnalysisPanel } from './result/SecureDownloadModal';
import ResultMetaStrip from './result/ResultMetaStrip';
import ResultAudioPlayer from './result/ResultAudioPlayer';
import ResultTranscriptPanel from './result/ResultTranscriptPanel';
import ResultAnalysisPanel from './result/ResultAnalysisPanel';
`;
  s = s.slice(0, utilStart) + importBlock + '\n' + s.slice(compStart);
}

// 2) Replace renderTabooAnalysis function body usage - remove function, use TabooAnalysisPanel inline
const tabooFnStart = s.indexOf('  const renderTabooAnalysis = ({ showEmptyHint = false } = {}) => {');
const tabooFnEnd = s.indexOf('  const renderCallScoring = () => {', tabooFnStart);
if (tabooFnStart > 0 && tabooFnEnd > tabooFnStart) {
  s = s.slice(0, tabooFnStart) + s.slice(tabooFnEnd);
}

// Replace renderTabooAnalysis calls
s = s.replace(
  /\{renderTabooAnalysis\(\)\}/g,
  '<TabooAnalysisPanel toneAnalysis={toneAnalysis} onSeek={handleTranscriptSeek} />'
);
s = s.replace(
  /\{renderTabooAnalysis\(\{ showEmptyHint: true \}\)\}/g,
  '<TabooAnalysisPanel toneAnalysis={toneAnalysis} showEmptyHint onSeek={handleTranscriptSeek} />'
);

// 3) Replace meta strip
const metaStart = s.indexOf('      <section className="rp-meta-strip">');
const metaEnd = s.indexOf('      </section>', metaStart) + '      </section>'.length;
if (metaStart > 0) {
  const metaReplacement = `      <ResultMetaStrip loading={detailsLoading} items={metaItems} />`;
  s = s.slice(0, metaStart) + metaReplacement + s.slice(metaEnd);
}

// 4) Replace audio player
const playerStart = s.indexOf('      <section className="rp-player">');
const playerEnd = s.indexOf('      </section>', playerStart) + '      </section>'.length;
if (playerStart > 0) {
  const playerReplacement = `      <ResultAudioPlayer
        waveformRef={waveformRef}
        isPlaying={isPlaying}
        onPlayPause={handlePlayPause}
        onDownloadClick={(e) => { e.preventDefault(); e.stopPropagation(); setSecureDownloadOpen(true); }}
        duration={audioDetails.AudioDuration}
      />`;
  s = s.slice(0, playerStart) + playerReplacement + s.slice(playerEnd);
}

// 5) Replace transcript panel
const txStart = s.indexOf('        <section className={`rp-transcript-panel');
const txEnd = s.indexOf('        </section>', s.indexOf("transcriptTab === 'summary'", txStart)) + '        </section>'.length;
if (txStart > 0 && txEnd > txStart) {
  const txReplacement = `        <ResultTranscriptPanel
          expanded={transcriptExpanded}
          onToggleExpand={() => setTranscriptExpanded(!transcriptExpanded)}
          transcriptTab={transcriptTab}
          onTranscriptTabChange={setTranscriptTab}
          transcriptLoading={transcriptLoading}
          transcriptMessages={transcriptMessages}
          originalMessages={originalMessages}
          summary={summary}
          agentUsername={audioDetails?.AgentName || ''}
          onSeek={handleTranscriptSeek}
        />`;
  s = s.slice(0, txStart) + txReplacement + s.slice(txEnd);
}

// 6) Replace analysis panel shell - keep tab body inside ResultAnalysisPanel
const apStart = s.indexOf('        <section className="rp-analysis-panel">');
const apBodyStart = s.indexOf('          <div className="rp-analysis-body"', apStart);
const apEnd = s.indexOf('        </section>', apBodyStart) + '        </section>'.length;
if (apStart > 0 && apBodyStart > 0) {
  const bodyEnd = s.indexOf('          </div>', apBodyStart) + '          </div>'.length;
  const tabBody = s.slice(apBodyStart, bodyEnd);
  const tabSelectFn = `        <ResultAnalysisPanel
          activeTab={activeTab}
          onTabSelect={(key) => {
            if (key === 'tone' && !toneAnalysis) fetchToneAnalysis();
            if (key === 'sentiment' && !sentimentData) fetchSentiment();
            if (key === 'scoring' && !aiScoring) handleFetchScoring();
            if (key === 'intel' && !intelligence && !intelError) fetchIntelligence();
            if ((key === 'scoring' || key === 'script' || key === 'policy') && !toneAnalysis) fetchToneAnalysis();
            if (key === 'script' && scriptCompliance == null) handleFetchScriptCompliance();
            setActiveTab(key);
          }}
        >
${tabBody.replace('          <div className="rp-analysis-body" key={activeTab}>', '').replace(/^\s*<\/div>\s*$/m, '')}
        </ResultAnalysisPanel>`;
  s = s.slice(0, apStart) + tabSelectFn + s.slice(apEnd);
}

// Remove unused ANALYSIS_TABS if still present
s = s.replace(/const ANALYSIS_TABS = [\s\S]*?\];\n\n/, '');

// Remove duplicate QUERY_TYPE, RUBRIC, SPEAKER if still in file (from failed trim)
['QUERY_TYPE_COLORS', 'RUBRIC', 'SPEAKER_COLORS'].forEach((name) => {
  const re = new RegExp(`const ${name} = [\\s\\S]*?\\};\\n\\n`, 'm');
  s = s.replace(re, '');
});

fs.writeFileSync(filePath, s);
console.log('Patched ResultPage.jsx — lines:', s.split('\n').length);
