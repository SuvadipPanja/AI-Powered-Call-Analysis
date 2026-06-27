import { Skeleton } from '../ui';

export default function ResultMetaStrip({ loading, items }) {
  return (
    <section className="rp-meta-strip">
      {loading ? (
        <Skeleton style={{ height: 38, borderRadius: 'var(--radius-md)', width: '100%' }} />
      ) : (
        items.map(({ icon: Icon, label, value, variant }, i) => (
          <div key={i} className={`rp-meta-item${variant ? ` rp-meta-item--${variant}` : ''}`}>
            <Icon className="rp-meta-item__icon" />
            <span className="rp-meta-item__label">{label}</span>
            <span className="rp-meta-item__value" title={typeof value === 'string' && value.length > 20 ? value : undefined}>{value}</span>
          </div>
        ))
      )}
    </section>
  );
}
