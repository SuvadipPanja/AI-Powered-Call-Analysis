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
  const panelId = `rp-panel-${activeTab}`;
  const tabId = `rp-tab-${activeTab}`;

  return (
    <section className="rp-analysis-panel" aria-label="Call analysis">
      <nav className="rp-tabs" role="tablist" aria-label="Analysis views">
        {TAB_DEFS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              id={`rp-tab-${tab.key}`}
              role="tab"
              aria-selected={active}
              aria-controls={`rp-panel-${tab.key}`}
              tabIndex={active ? 0 : -1}
              className={`rp-tabs__btn ${active ? 'is-active' : ''}`}
              onClick={() => onTabSelect(tab.key)}
            >
              <Icon className="rp-tabs__icon" aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      <div
        className="rp-analysis-body"
        key={activeTab}
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId}
        tabIndex={0}
      >
        {children}
      </div>
    </section>
  );
}
