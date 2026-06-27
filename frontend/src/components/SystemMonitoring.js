import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import {
  LuActivity,
  LuCpu,
  LuHardDrive,
  LuMemoryStick,
  LuNetwork,
  LuRefreshCw,
  LuServer,
  LuX,
  LuTriangleAlert,
} from 'react-icons/lu';
import config from '../utils/envConfig';
import KpiCard from './shared/KpiCard';
import { Button, Badge, Spinner } from './ui';
import './reports/reports-page.css';
import './monitoring-page.css';

const mockSystemData = {
  success: true,
  cpu: { currentLoad: 45.2, model: 'Intel Core i7', cores: 8, temperature: 65 },
  memory: { used: 8.5, total: 16.0, free: 7.5 },
  disks: [{ fs: '/dev/sda1', size: 500, used: 200, use: 40 }],
  network: { upload: 1.2, download: 2.5 },
  gpu: { model: 'NVIDIA GTX 1080', load: 30, vram: 8192, temperature: 55 },
};

function progressTone(percent) {
  if (percent > 90) return 'crit';
  if (percent > 60) return 'warn';
  return 'ok';
}

function storageTone(percent) {
  if (percent > 85) return 'crit';
  if (percent >= 70) return 'warn';
  return 'ok';
}

function storageValueClass(percent) {
  if (percent > 85) return 'mon-mini-stat__value--danger';
  if (percent >= 70) return 'mon-mini-stat__value--warning';
  return 'mon-mini-stat__value--success';
}

function gaugeColor(percent) {
  if (percent > 0.9) return 'var(--danger)';
  if (percent > 0.7) return 'var(--warning)';
  if (percent > 0.5) return 'var(--accent)';
  return 'var(--success)';
}

function MonitorGauge({ percent, subtitle, hasData }) {
  if (!hasData || typeof percent !== 'number') {
    return (
      <div className="mon-gauge" role="status" aria-label={`${subtitle} - No data`}>
        <div className="mon-gauge__empty">
          <span>No data</span>
          <span>{subtitle}</span>
        </div>
      </div>
    );
  }

  const radius = 60;
  const strokeWidth = 6;
  const normalizedRadius = radius - strokeWidth * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - percent * circumference;
  const color = gaugeColor(percent);

  return (
    <div
      className="mon-gauge"
      role="meter"
      aria-label={`${subtitle}: ${(percent * 100).toFixed(1)}%`}
      aria-valuenow={(percent * 100).toFixed(1)}
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <svg width={radius * 2 + 20} height={radius * 2 + 20} aria-hidden="true">
        <circle
          stroke="var(--border)"
          fill="transparent"
          strokeWidth={strokeWidth}
          r={normalizedRadius}
          cx={radius + 10}
          cy={radius + 10}
          strokeLinecap="round"
        />
        <circle
          stroke={color}
          fill="transparent"
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference} ${circumference}`}
          style={{ strokeDashoffset, transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)' }}
          strokeLinecap="round"
          r={normalizedRadius}
          cx={radius + 10}
          cy={radius + 10}
          transform={`rotate(-90 ${radius + 10} ${radius + 10})`}
        />
        <text x={radius + 10} y={radius + 5} textAnchor="middle" style={{ fontSize: 20, fontWeight: 700, fill: 'var(--text-strong)' }}>
          {(percent * 100).toFixed(1)}%
        </text>
        <text x={radius + 10} y={radius + 20} textAnchor="middle" style={{ fontSize: 10, fontWeight: 500, fill: 'var(--text-muted)' }}>
          {subtitle}
        </text>
      </svg>
    </div>
  );
}

function MonitorProgress({ percent, label, toneFn }) {
  const safe = Number.isFinite(percent) ? Math.min(Math.max(percent, 0), 100) : 0;
  const tone = toneFn ? toneFn(safe) : progressTone(safe);
  return (
    <div className="mon-progress">
      {label && (
        <div className="mon-progress__labels">
          <span>{label}</span>
          <span>{safe.toFixed(1)}%</span>
        </div>
      )}
      <div className="mon-progress__track">
        <div className={`mon-progress__fill mon-progress__fill--${tone}`} style={{ width: `${safe}%` }} />
      </div>
    </div>
  );
}

function MonitorPanel({ title, badge, children, wide = false, delay = 0 }) {
  return (
    <article className={`mon-panel${wide ? ' mon-panel--wide' : ''}`} style={{ animationDelay: `${delay}ms` }}>
      <header className="mon-panel__head">
        <h3 className="mon-panel__title">{title}</h3>
        {badge}
      </header>
      <div className="mon-panel__body">{children}</div>
    </article>
  );
}

function statusBadge(hasData, percent) {
  if (!hasData) return <Badge>NO DATA</Badge>;
  if (percent > 0.9) return <Badge variant="danger">CRITICAL</Badge>;
  if (percent > 0.6) return <Badge variant="warning">WARNING</Badge>;
  return <Badge variant="success">NORMAL</Badge>;
}

const SystemMonitoring = () => {
  const [systemData, setSystemData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const [manualRefreshTrigger, setManualRefreshTrigger] = useState(0);

  const metrics = 'cpu,memory,disks,network,gpu';

  const generateAlerts = useCallback((data) => {
    if (!data) return;
    const newAlerts = [];
    const timestamp = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
    if (data.cpu?.currentLoad > 90) {
      newAlerts.push({ id: Date.now() + Math.random(), component: 'CPU', message: `CPU usage critical: ${data.cpu.currentLoad.toFixed(1)}%`, timestamp });
    }
    if (data.memory?.total && data.memory?.used) {
      const memoryUsage = (data.memory.used / data.memory.total) * 100;
      if (memoryUsage > 90) {
        newAlerts.push({ id: Date.now() + Math.random() + 1, component: 'Memory', message: `Memory usage critical: ${memoryUsage.toFixed(1)}%`, timestamp });
      }
    }
    data.disks?.forEach((disk, index) => {
      if (disk.use > 90) {
        newAlerts.push({ id: Date.now() + Math.random() + index + 2, component: 'Storage', message: `Disk ${disk.fs} usage critical: ${disk.use.toFixed(1)}%`, timestamp });
      }
    });
    if (data.gpu?.load > 90) {
      newAlerts.push({ id: Date.now() + Math.random() + 10, component: 'GPU', message: `GPU usage critical: ${data.gpu.load.toFixed(1)}%`, timestamp });
    }
    if (newAlerts.length > 0) setAlerts((prev) => [...newAlerts, ...prev.slice(0, 4)]);
  }, []);

  const dismissAlert = useCallback((alertId) => setAlerts((prev) => prev.filter((a) => a.id !== alertId)), []);
  const clearAllAlerts = useCallback(() => setAlerts([]), []);
  const handleManualRefresh = () => setManualRefreshTrigger((prev) => prev + 1);

  useEffect(() => {
    let interval;
    let isActive = true;

    setSystemData(mockSystemData);
    setLastUpdate(new Date());
    setIsConnected(false);

    const performFetch = async (withSpinner = false) => {
      if (!isActive) return;
      if (withSpinner) setIsLoading(true);
      try {
        const apiUrl = `${config.apiBaseUrl}/api/system-monitor?metrics=${metrics}&cache=false&timestamp=${Date.now()}`;
        const response = await axios.get(apiUrl, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000,
        });
        if (!isActive) return;

        if (response.data?.success && response.data.data) {
          const data = response.data.data;
          const processedData = {
            ...data,
            memory: data.memory
              ? {
                  ...data.memory,
                  total: parseFloat(data.memory.total || 0),
                  used: parseFloat(data.memory.used || 0),
                  free: parseFloat(data.memory.free || 0),
                }
              : null,
          };
          setSystemData(processedData);
          setLastUpdate(new Date());
          generateAlerts(processedData);
          setIsConnected(true);
          setErrorMessage(null);
          setRetryCount(0);
        } else {
          setErrorMessage('API returned error');
        }
      } catch (error) {
        if (!isActive) return;
        setIsConnected(false);
        setRetryCount((prev) => {
          const newCount = prev + 1;
          if (newCount >= 3) {
            setSystemData(mockSystemData);
            setLastUpdate(new Date());
            generateAlerts(mockSystemData);
            setIsConnected(true);
            setErrorMessage('Using demo data — live monitor unavailable');
          } else {
            setErrorMessage('Failed to fetch system data');
          }
          return newCount;
        });
      } finally {
        if (isActive && withSpinner) setIsLoading(false);
      }
    };

    const startPolling = () => {
      if (interval) clearInterval(interval);
      interval = setInterval(() => {
        if (document.visibilityState === 'visible' && isActive) performFetch(false);
      }, 30000);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isActive) {
        performFetch(false);
        startPolling();
      } else if (interval) {
        clearInterval(interval);
      }
    };

    performFetch(true);
    startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isActive = false;
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [manualRefreshTrigger, generateAlerts]);

  const currentLoad = systemData?.cpu?.currentLoad;
  const cpuLoadPercent = currentLoad != null ? Math.min(Math.max(parseFloat(currentLoad) / 100, 0), 1) : 0;

  const memTotal = systemData?.memory?.total;
  const memUsed = systemData?.memory?.used;
  const memoryUsedPercent = memTotal && memUsed ? Math.min(Math.max(parseFloat(memUsed) / parseFloat(memTotal), 0), 1) : 0;

  const gpuData = systemData?.gpu;
  const primaryGpu = Array.isArray(gpuData) && gpuData.length > 0 ? gpuData[0] : null;
  const gpuLoad = primaryGpu?.utilizationGpu ?? primaryGpu?.load ?? 0;
  const gpuLoadPercent = gpuLoad != null ? Math.min(Math.max(parseFloat(gpuLoad) / 100, 0), 1) : 0;

  const hasCpuData = systemData?.cpu && currentLoad != null && !Number.isNaN(parseFloat(currentLoad));
  const hasMemoryData = systemData?.memory && memTotal && memUsed && !Number.isNaN(parseFloat(memTotal));
  const hasNetworkData = systemData?.network && (systemData.network.upload != null || systemData.network.download != null);
  const hasGpuData = Array.isArray(gpuData) && gpuData.length > 0 && gpuData.some((g) => g.utilizationGpu != null || g.load != null);
  const hasDiskData = systemData?.disks && Array.isArray(systemData.disks) && systemData.disks.length > 0;

  const maxDiskUse = useMemo(() => {
    if (!hasDiskData) return 0;
    return Math.max(...systemData.disks.map((d) => parseFloat(d.use) || 0));
  }, [hasDiskData, systemData?.disks]);

  const networkTotal = (parseFloat(systemData?.network?.upload) || 0) + (parseFloat(systemData?.network?.download) || 0);

  const activeInterfaces = systemData?.network?.interfaces?.filter((iface) => iface.operstate === 'up') || [];

  return (
    <div className="app-page reports-page mon-page">
      <header className="mon-toolbar">
        <div className="mon-toolbar__title">
          <div className="mon-toolbar__icon" aria-hidden="true">
            <LuActivity size={18} />
          </div>
          <div>
            <h1>System Monitoring</h1>
            <p>Live CPU, memory, storage, network &amp; GPU metrics</p>
          </div>
        </div>
        <div className="mon-toolbar__status">
          {lastUpdate && (
            <span className="mon-toolbar__meta">
              Updated {lastUpdate.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}
            </span>
          )}
          <span className={`page-status-dot ${isConnected ? 'is-online' : 'is-offline'}`} aria-hidden />
          <span className="mon-toolbar__meta">{isConnected ? 'Live' : 'Offline'}</span>
          {retryCount > 0 && <span className="mon-toolbar__meta">Retries: {retryCount}</span>}
          <Button
            variant="secondary"
            className={`mon-toolbar__refresh${isLoading ? ' is-spinning' : ''}`}
            onClick={handleManualRefresh}
            disabled={isLoading}
            aria-label="Refresh system data"
          >
            {isLoading ? <Spinner /> : <LuRefreshCw size={16} />}
          </Button>
        </div>
      </header>

      <div className="reports-kpi-grid mon-kpi-grid">
        <KpiCard label="CPU Load" value={hasCpuData ? `${(cpuLoadPercent * 100).toFixed(0)}%` : '—'} icon={LuCpu} accent="cyan" />
        <KpiCard label="Memory" value={hasMemoryData ? `${(memoryUsedPercent * 100).toFixed(0)}%` : '—'} icon={LuMemoryStick} accent="teal" />
        <KpiCard
          label="Network"
          value={hasNetworkData ? `${networkTotal.toFixed(1)} MB/s` : '—'}
          icon={LuNetwork}
          accent="emerald"
        />
        <KpiCard label="Storage Peak" value={hasDiskData ? `${maxDiskUse.toFixed(0)}%` : '—'} icon={LuHardDrive} accent="amber" />
        <KpiCard label="GPU Load" value={hasGpuData ? `${(gpuLoadPercent * 100).toFixed(0)}%` : '—'} icon={LuServer} accent="rose" />
        <KpiCard
          label="Health"
          value={alerts.length > 0 ? `${alerts.length} alert${alerts.length > 1 ? 's' : ''}` : isConnected ? 'Healthy' : 'Degraded'}
          icon={LuActivity}
          accent="teal"
        />
      </div>

      {errorMessage && (
        <div className="mon-error-banner" role="alert">
          <span>{errorMessage}</span>
          <Button size="sm" variant="danger" onClick={handleManualRefresh} disabled={isLoading}>
            {isLoading ? 'Retrying…' : 'Retry'}
          </Button>
        </div>
      )}

      {alerts.length > 0 && (
        <section className="mon-alerts" aria-live="polite">
          <div className="mon-alerts__head">
            <h2>
              <LuTriangleAlert size={18} aria-hidden />
              Active alerts
              <Badge variant="danger">{alerts.length}</Badge>
            </h2>
            <Button variant="secondary" size="sm" onClick={clearAllAlerts}>
              Clear all
            </Button>
          </div>
          {alerts.map((alert) => (
            <div key={alert.id} className="mon-alert-item">
              <div>
                <div className="mon-alert-item__component">{alert.component}</div>
                <div className="mon-alert-item__message">{alert.message}</div>
                <div className="mon-alert-item__time">{alert.timestamp}</div>
              </div>
              <button type="button" className="mon-alert-item__dismiss" onClick={() => dismissAlert(alert.id)} aria-label={`Dismiss ${alert.component} alert`}>
                <LuX size={16} />
              </button>
            </div>
          ))}
        </section>
      )}

      <div className="mon-grid">
        <MonitorPanel title="CPU Performance" badge={statusBadge(hasCpuData, cpuLoadPercent)} delay={40}>
          <MonitorGauge percent={cpuLoadPercent} subtitle="Load" hasData={hasCpuData} />
          {systemData?.cpu && (
            <table className="mon-meta-table">
              <tbody>
                {systemData.cpu.model && <tr><td>Model</td><td>{systemData.cpu.model}</td></tr>}
                {systemData.cpu.cores && <tr><td>Cores</td><td>{systemData.cpu.cores}</td></tr>}
                {systemData.cpu.temperature != null && <tr><td>Temperature</td><td>{systemData.cpu.temperature}°C</td></tr>}
              </tbody>
            </table>
          )}
        </MonitorPanel>

        <MonitorPanel title="Memory Usage" badge={statusBadge(hasMemoryData, memoryUsedPercent)} delay={80}>
          {hasMemoryData ? (
            <>
              <MonitorProgress percent={memoryUsedPercent * 100} label="RAM usage" />
              <div className="mon-mini-stats">
                <div className="mon-mini-stat">
                  <div className="mon-mini-stat__value mon-mini-stat__value--accent">{parseFloat(systemData.memory.used).toFixed(1)} GB</div>
                  <div className="mon-mini-stat__label">Used</div>
                </div>
                <div className="mon-mini-stat">
                  <div className="mon-mini-stat__value">{parseFloat(systemData.memory.total).toFixed(1)} GB</div>
                  <div className="mon-mini-stat__label">Total</div>
                </div>
                <div className="mon-mini-stat">
                  <div className="mon-mini-stat__value mon-mini-stat__value--success">{parseFloat(systemData.memory.free).toFixed(1)} GB</div>
                  <div className="mon-mini-stat__label">Free</div>
                </div>
              </div>
            </>
          ) : (
            <div className="mon-empty"><strong>Memory unavailable</strong>No RAM metrics received from the host.</div>
          )}
        </MonitorPanel>

        <MonitorPanel title="Network Activity" badge={<Badge variant={hasNetworkData ? 'success' : undefined}>{hasNetworkData ? 'ACTIVE' : 'NO DATA'}</Badge>} delay={120}>
          {hasNetworkData ? (
            <>
              <div className="mon-net-row">
                <div className="mon-net-tile">
                  <span className="mon-net-tile__icon mon-net-tile__icon--up" aria-hidden>↑</span>
                  <div>
                    <div className="mon-net-tile__value">{parseFloat(systemData.network.upload || 0).toFixed(2)} MB/s</div>
                    <div className="mon-net-tile__label">Upload</div>
                  </div>
                </div>
                <div className="mon-net-tile">
                  <span className="mon-net-tile__icon mon-net-tile__icon--down" aria-hidden>↓</span>
                  <div>
                    <div className="mon-net-tile__value">{parseFloat(systemData.network.download || 0).toFixed(2)} MB/s</div>
                    <div className="mon-net-tile__label">Download</div>
                  </div>
                </div>
              </div>
              {activeInterfaces.length > 0 ? (
                <>
                  <p className="mon-panel__subtitle">Active interfaces ({activeInterfaces.length})</p>
                  <div className="mon-subcards">
                    {activeInterfaces.map((iface, index) => (
                      <div key={`interface-${iface.name || index}`} className="mon-subcard">
                        <div className="mon-subcard__head">
                          <span className="mon-subcard__title">{iface.name}</span>
                          <Badge variant="success">UP</Badge>
                        </div>
                        <div className="mon-subcard__foot">
                          <span>↑ {iface.upload?.toFixed?.(1) ?? iface.upload} MB/s</span>
                          <span>↓ {iface.download?.toFixed?.(1) ?? iface.download} MB/s</span>
                        </div>
                        <div className="mon-subcard__foot">
                          <span>{iface.ip4 || 'No IP'}</span>
                          <span>{iface.speed ? `${iface.speed}M` : 'N/A'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="mon-empty">No active network interfaces detected</div>
              )}
            </>
          ) : (
            <div className="mon-empty"><strong>Network unavailable</strong>Throughput metrics are not available.</div>
          )}
        </MonitorPanel>

        <MonitorPanel title="Storage Devices" badge={<Badge variant={hasDiskData ? 'success' : undefined}>{hasDiskData ? 'MONITORING' : 'NO DATA'}</Badge>} delay={160}>
          {hasDiskData ? (
            <div className="mon-subcards mon-subcards--storage">
              {systemData.disks.map((disk, index) => {
                const usePercent = parseFloat(disk.use) || 0;
                const usedGB = parseFloat(disk.used) || 0;
                const totalGB = parseFloat(disk.size) || 0;
                const freeGB = totalGB - usedGB;
                return (
                  <div key={`disk-${disk.fs || index}`} className="mon-subcard mon-subcard--storage">
                    <div className="mon-subcard__head">
                      <span className="mon-subcard__title">{disk.fs || `Disk ${index + 1}`}</span>
                      <span className={`mon-subcard__pct mon-subcard__pct--${storageTone(usePercent)}`}>
                        {usePercent.toFixed(1)}%
                      </span>
                    </div>
                    <MonitorProgress percent={usePercent} toneFn={storageTone} />
                    <div className="mon-mini-stats mon-mini-stats--storage">
                      <div className="mon-mini-stat">
                        <div className={`mon-mini-stat__value ${storageValueClass(usePercent)}`}>{usedGB.toFixed(1)}</div>
                        <div className="mon-mini-stat__label">Used GB</div>
                      </div>
                      <div className="mon-mini-stat">
                        <div className="mon-mini-stat__value">{totalGB.toFixed(1)}</div>
                        <div className="mon-mini-stat__label">Total GB</div>
                      </div>
                      <div className="mon-mini-stat">
                        <div className="mon-mini-stat__value mon-mini-stat__value--success">{freeGB.toFixed(1)}</div>
                        <div className="mon-mini-stat__label">Free GB</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mon-empty"><strong>Storage unavailable</strong>Disk metrics could not be read.</div>
          )}
        </MonitorPanel>

        <MonitorPanel title="GPU Performance" badge={statusBadge(hasGpuData, gpuLoadPercent)} wide delay={200}>
          {hasGpuData && Array.isArray(systemData.gpu) ? (
            <>
              <p className="mon-panel__subtitle">Graphics processors ({systemData.gpu.length})</p>
              <div className="mon-subcards">
                {systemData.gpu.map((gpu, index) => {
                  const memoryUsage = gpu.memoryTotal > 0 ? ((gpu.memoryUsed || 0) / gpu.memoryTotal) * 100 : 0;
                  return (
                    <div key={`gpu-${gpu.id || index}`} className="mon-subcard">
                      <div className="mon-subcard__head">
                        <div>
                          <div className="mon-subcard__title">GPU {index} — {gpu.model?.slice(0, 20) || `Device ${index}`}</div>
                          <div className="mon-subcard__foot" style={{ marginTop: 2 }}>{gpu.vendor || 'Unknown vendor'}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div className="mon-mini-stat__value mon-mini-stat__value--accent">{(gpu.utilizationGpu || 0).toFixed(0)}%</div>
                          <div className="mon-mini-stat__label">Load</div>
                        </div>
                      </div>
                      <MonitorProgress percent={gpu.utilizationGpu || 0} label="GPU usage" />
                      <MonitorProgress
                        percent={memoryUsage}
                        label={`VRAM ${gpu.memoryUsed ? `${(gpu.memoryUsed / 1024).toFixed(1)}` : '0'}/${gpu.memoryTotal ? `${(gpu.memoryTotal / 1024).toFixed(1)}G` : 'N/A'}`}
                      />
                      <div className="mon-subcard__foot">
                        {gpu.temperatureGpu > 0 && <span>{gpu.temperatureGpu}°C</span>}
                        {gpu.powerDraw > 0 && <span>{gpu.powerDraw}W</span>}
                        {gpu.clockCore > 0 && <span>{Math.round(gpu.clockCore / 1000)} GHz</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <MonitorGauge percent={0} subtitle="Load" hasData={false} />
              <div className="mon-empty"><strong>No GPU detected</strong>GPU metrics are not available on this host.</div>
            </>
          )}
        </MonitorPanel>
      </div>
    </div>
  );
};

export default SystemMonitoring;
