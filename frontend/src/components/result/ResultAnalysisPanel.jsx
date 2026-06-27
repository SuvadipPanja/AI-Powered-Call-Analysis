import {
  LuClipboardCheck,
  LuChartLine,
  LuShield,
  LuAudioLines,
  LuSmile,
} from '../../icons';

const TAB_DEFS = [
  { key: 'scoring', label: 'Scoring', icon: LuClipboardCheck },
  { key: 'intel', label: 'Call Intelligence', icon: LuChartLine },
  { key: 'policy', label: 'Policy Words', icon: LuShield },
  { key: 'tone', label: 'Tone Analysis', icon: LuAudioLines },
  { key: 'sentiment', label: 'Sentiment', icon: LuSmile },
  { key: 'script', label: 'Compliance', icon: LuShield },
];

export default function ResultAnalysisPanel({ activeTab, onTabSelect, children }) {
  return (
    <section className="rp-analysis-panel">
      <nav className="rp-tabs" role="tablist" aria-label="Analysis views">
        {TAB_DEFS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              className={`rp-tabs__btn ${active ? 'is-active' : ''}`}
              onClick={() => onTabSelect(tab.key)}
            >
              <Icon className="rp-tabs__icon" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="rp-analysis-body" key={activeTab}>
        {children}
      </div>
    </section>
  );
}
