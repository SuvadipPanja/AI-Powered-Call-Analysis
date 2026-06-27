import { LuLayoutDashboard, LuFilter } from "react-icons/lu";
import DatePicker from "react-datepicker";
import "./kuber-hero.css";

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function periodLabel(dateRange, customFrom, customTo) {
  const now = new Date();
  if (dateRange === "Today") return now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  if (dateRange === "Custom" && customFrom && customTo) {
    return `${customFrom.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${customTo.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  }
  return now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/**
 * Sri Kuber–style compact page hero: title left, filter capsule right.
 */
export default function KuberPageHero({
  title = "Dashboard",
  hideTitle = false,
  username,
  icon: Icon = LuLayoutDashboard,
  locationLabel = "All",
  dateRange,
  customFromDate,
  customToDate,
  locationList = [],
  tlList = [],
  agentList = [],
  selectedLocation,
  selectedTL,
  selectedCallType = "All",
  selectedAgent = "All",
  tlLoading,
  agentsLoading = false,
  onLocationChange,
  onTlChange,
  onCallTypeChange,
  onAgentChange,
  onDateRangeChange,
  onCustomFromChange,
  onCustomToChange,
  onSubmit,
  onReset,
  hideApply = false,
  hideFilters = false,
  children,
}) {
  const greet = timeGreeting();
  const period = periodLabel(dateRange, customFromDate, customToDate);

  return (
    <section className="kuber-hero">
      <div className={`kuber-hero__main ${hideTitle ? "kuber-hero__main--filters-only" : ""}`}>
        {!hideTitle && (
        <div className="kuber-hero__title-block">
          <span className="kuber-hero__icon" aria-hidden>
            <Icon strokeWidth={2} />
          </span>
          <div>
            <h1 className="kuber-hero__title">{title}</h1>
            <p className="kuber-hero__subtitle">
              {greet}{username ? `, ${username}` : ""}
              {!hideFilters ? ` · ${period}` : ""}
            </p>
            {hideFilters && children ? (
              <div className="kuber-hero__meta">{children}</div>
            ) : null}
          </div>
        </div>
        )}

        {!hideFilters && (
        <div className="kuber-hero__filters">
          <span className="kuber-pill kuber-pill--location">{locationLabel}</span>

          <div className="kuber-filter-capsule">
            <LuFilter className="kuber-filter-capsule__icon" aria-hidden />
            <select
              className="kuber-filter-capsule__select"
              value={selectedLocation}
              onChange={(e) => onLocationChange(e.target.value)}
              aria-label="Location"
            >
              <option value="All">All locations</option>
              {locationList.map((loc) => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>
            <span className="kuber-filter-capsule__sep" aria-hidden />
            <select
              className="kuber-filter-capsule__select"
              value={selectedTL}
              onChange={(e) => onTlChange(e.target.value)}
              disabled={tlLoading}
              aria-label="Team leader"
            >
              <option value="All">{tlLoading ? "Loading…" : "All leaders"}</option>
              {!tlLoading && tlList.map((tl) => (
                <option key={tl} value={tl}>{tl}</option>
              ))}
            </select>
            <span className="kuber-filter-capsule__sep" aria-hidden />
            <select
              className="kuber-filter-capsule__select"
              value={selectedCallType}
              onChange={(e) => onCallTypeChange?.(e.target.value)}
              aria-label="Call type"
            >
              <option value="All">All types</option>
              <option value="Inbound">Inbound</option>
              <option value="Outbound">Outbound</option>
            </select>
            <span className="kuber-filter-capsule__sep" aria-hidden />
            <select
              className="kuber-filter-capsule__select kuber-filter-capsule__select--agent"
              value={selectedAgent}
              onChange={(e) => onAgentChange?.(e.target.value)}
              disabled={agentsLoading}
              aria-label="Agent"
            >
              <option value="All">{agentsLoading ? "Loading…" : "All agents"}</option>
              {!agentsLoading && agentList.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <span className="kuber-filter-capsule__sep" aria-hidden />
            <select
              className="kuber-filter-capsule__select"
              value={dateRange}
              onChange={(e) => onDateRangeChange(e.target.value)}
              aria-label="Date range"
            >
              <option value="Today">Today</option>
              <option value="1 Week">1 week</option>
              <option value="1 Month">1 month</option>
              <option value="Custom">Custom</option>
            </select>
            {dateRange === "Custom" && (
              <>
                <span className="kuber-filter-capsule__sep" aria-hidden />
                <DatePicker
                  selected={customFromDate}
                  onChange={onCustomFromChange}
                  dateFormat="MMM d"
                  placeholderText="From"
                  className="kuber-filter-capsule__date"
                  popperClassName="kuber-datepicker-popper"
                  popperPlacement="bottom-end"
                  withPortal
                />
                <DatePicker
                  selected={customToDate}
                  onChange={onCustomToChange}
                  dateFormat="MMM d"
                  placeholderText="To"
                  className="kuber-filter-capsule__date"
                  popperClassName="kuber-datepicker-popper"
                  popperPlacement="bottom-end"
                  withPortal
                />
              </>
            )}
            {!hideApply && (
            <button type="button" className="kuber-filter-capsule__apply" onClick={onSubmit}>
              Apply
            </button>
            )}
          </div>

          {children}

          {onReset && (
            <button type="button" className="kuber-filter-reset" onClick={onReset}>
              Reset
            </button>
          )}
        </div>
        )}
      </div>
    </section>
  );
}
