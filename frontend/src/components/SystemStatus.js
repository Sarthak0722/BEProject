import React from 'react';
import { RotateCcw, Zap, Clock, AlertTriangle, CheckCircle, XCircle, Activity } from 'lucide-react';
import './SystemStatus.css';

const healthColor = (h) => ({ healthy: '#10b981', degraded: '#f59e0b', failed: '#ef4444' }[h] || '#6b7280');
const healthLabel = (h) => ({ healthy: 'HEALTHY', degraded: 'DEGRADED', failed: 'FAILED' }[h] || 'UNKNOWN');

const HealthIcon = ({ health, size = 14 }) => {
  if (health === 'healthy') return <CheckCircle size={size} color="#10b981" />;
  if (health === 'degraded') return <AlertTriangle size={size} color="#f59e0b" />;
  if (health === 'failed') return <XCircle size={size} color="#ef4444" />;
  return <Activity size={size} color="#6b7280" />;
};

const SystemStatus = ({ systemState = {}, lastUpdate, onReset, serviceFaults = {}, mode }) => {
  const services = Object.entries(systemState);
  const counts = { healthy: 0, degraded: 0, failed: 0 };
  services.forEach(([, s]) => { if (s.health in counts) counts[s.health]++; });

  const overallHealth = counts.failed > 0 ? 'failed' : counts.degraded > 0 ? 'degraded' : 'healthy';

  const getServiceFaultLabel = (serviceId) => {
    const f = serviceFaults[serviceId];
    if (!f) return null;
    const parts = [];
    if (f.isFailed) parts.push('FAILED');
    else {
      if (f.latency > 0) parts.push(`${f.latency}ms`);
      if (f.errorRate > 0) parts.push(`${f.errorRate}% err`);
    }
    return parts.length > 0 ? parts.join(' · ') : null;
  };

  const activeFaultCount = Object.values(serviceFaults).filter(
    f => f && (f.isFailed || f.latency > 0 || f.errorRate > 0)
  ).length;

  return (
    <div className="system-status">
      {/* Panel header */}
      <div className="ss-header">
        <div className="ss-title-row">
          <span className="ss-title">System Status</span>
          <div className="ss-overall" style={{ color: healthColor(overallHealth) }}>
            <HealthIcon health={overallHealth} size={13} />
            <span>{healthLabel(overallHealth)}</span>
          </div>
        </div>
        {lastUpdate && (
          <div className="ss-last-update">
            <Clock size={10} />
            {new Date(lastUpdate).toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* Score bar */}
      <div className="ss-scorebar">
        <div className="ss-score-item green">
          <span className="ss-score-num">{counts.healthy}</span>
          <span className="ss-score-label">Healthy</span>
        </div>
        <div className="ss-score-divider" />
        <div className="ss-score-item amber">
          <span className="ss-score-num">{counts.degraded}</span>
          <span className="ss-score-label">Degraded</span>
        </div>
        <div className="ss-score-divider" />
        <div className="ss-score-item red">
          <span className="ss-score-num">{counts.failed}</span>
          <span className="ss-score-label">Failed</span>
        </div>
      </div>

      {/* Simulation badge */}
      {mode === 'simulation' && activeFaultCount > 0 && (
        <div className="ss-sim-warning">
          <Zap size={12} />
          {activeFaultCount} simulated fault{activeFaultCount > 1 ? 's' : ''} active
        </div>
      )}

      {/* Service cards */}
      <div className="ss-service-cards">
        {services.length === 0 && (
          <div className="ss-empty">Waiting for services...</div>
        )}
        {services.map(([serviceId, service]) => {
          const faultLabel = getServiceFaultLabel(serviceId);
          const hasFault = !!faultLabel;
          return (
            <div
              key={serviceId}
              className={`ss-card ${service.health || 'unknown'} ${hasFault ? 'has-fault' : ''}`}
            >
              <div className="ss-card-left">
                <div className="ss-card-dot" style={{ background: healthColor(service.health) }} />
                <div className="ss-card-info">
                  <span className="ss-card-name">{service.name || serviceId}</span>
                  <span className="ss-card-health" style={{ color: healthColor(service.health) }}>
                    {healthLabel(service.health)}
                  </span>
                </div>
              </div>
              <div className="ss-card-right">
                {hasFault && (
                  <span className="ss-fault-pill">{faultLabel}</span>
                )}
                {service.latency != null && !hasFault && (
                  <span className="ss-latency">{Math.round(service.latency)}ms</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Metric rows */}
      {services.some(([, s]) => s.injectedLatency > 0 || s.errorRate > 0) && (
        <div className="ss-metrics">
          {services
            .filter(([, s]) => s.injectedLatency > 0 || s.errorRate > 0)
            .map(([id, s]) => (
              <div key={id} className="ss-metric-row">
                <span className="ss-metric-svc">{s.name || id}</span>
                {s.injectedLatency > 0 && (
                  <span className="ss-metric-badge amber">
                    <Clock size={10} />{s.injectedLatency}ms
                  </span>
                )}
                {s.errorRate > 0 && (
                  <span className="ss-metric-badge red">
                    <Zap size={10} />{Math.round(s.errorRate * 100)}% err
                  </span>
                )}
              </div>
            ))}
        </div>
      )}

      {/* Reset */}
      <button className="ss-reset-btn" onClick={onReset}>
        <RotateCcw size={14} />
        Reset All Services
      </button>
    </div>
  );
};

export default SystemStatus;
