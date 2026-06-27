import {
  resolveDashboardDateRange,
  buildDashboardQueryParams,
  appendReportFilters,
  isDefaultDashboardFilters,
  validateFilterDateRange,
  DEFAULT_DASHBOARD_FILTERS,
} from './dashboardFilters';

describe('dashboardFilters', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-15T12:00:00'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves Today range', () => {
    const { fromDate, toDate } = resolveDashboardDateRange({ dateRange: 'Today' });
    expect(fromDate).toBe('2026-06-15');
    expect(toDate).toBe('2026-06-15');
  });

  it('resolves custom range and caps end to now', () => {
    const { fromDate, toDate } = resolveDashboardDateRange({
      dateRange: 'Custom',
      customFromDate: '2026-06-01',
      customToDate: '2026-12-31',
    });
    expect(fromDate).toBe('2026-06-01');
    expect(toDate).toBe('2026-06-15');
  });

  it('builds dashboard query params with optional filters', () => {
    const qs = buildDashboardQueryParams({
      ...DEFAULT_DASHBOARD_FILTERS,
      location: 'Mumbai',
      callType: 'Inbound',
      agent: 'Agent One',
    });
    expect(qs).toContain('location=Mumbai');
    expect(qs).toContain('callType=inbound');
    expect(qs).toContain('agent=Agent+One');
  });

  it('appendReportFilters skips All values', () => {
    const params = appendReportFilters(new URLSearchParams(), {
      fromDate: '2026-06-01',
      toDate: '2026-06-15',
      location: 'All',
      supervisor: 'TL1',
      callType: 'Outbound',
    });
    expect(params.get('fromDate')).toBe('2026-06-01');
    expect(params.get('location')).toBeNull();
    expect(params.get('supervisor')).toBe('TL1');
    expect(params.get('callType')).toBe('outbound');
  });

  it('detects default dashboard filters', () => {
    expect(isDefaultDashboardFilters(DEFAULT_DASHBOARD_FILTERS)).toBe(true);
    expect(isDefaultDashboardFilters({ ...DEFAULT_DASHBOARD_FILTERS, agent: 'X' })).toBe(false);
  });

  it('validateFilterDateRange rejects incomplete custom range', () => {
    const result = validateFilterDateRange({
      dateRange: 'Custom',
      customFromDate: '2026-06-01',
      customToDate: null,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/both From and To/i);
  });

  it('validateFilterDateRange rejects inverted custom range', () => {
    const result = validateFilterDateRange({
      dateRange: 'Custom',
      customFromDate: '2026-06-10',
      customToDate: '2026-06-01',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/after From Date/i);
  });
});
