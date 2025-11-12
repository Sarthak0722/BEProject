import React from 'react';
import { Activity, RotateCcw, Clock, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import './SystemStatus.css';

const SystemStatus = ({ systemState, lastUpdate, onReset }) => {
  const getServiceCounts = () => {
    const counts = { healthy: 0, degraded: 0, failed: 0, unknown: 0 };
    
    Object.values(systemState).forEach(service => {
      const health = service.health || 'unknown';
      counts[health] = (counts[health] || 0) + 1;
    });
    
    return counts;
  };

  const getOverallHealth = () => {
    const counts = getServiceCounts();
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    
    if (counts.failed > 0) return 'failed';
    if (counts.degraded > 0) return 'degraded';
    if (counts.healthy === total) return 'healthy';
    return 'unknown';
  };

  const getHealthIcon = (health) => {
    switch (health) {
      case 'healthy': return <CheckCircle size={16} className="health-icon healthy" />;
      case 'degraded': return <AlertCircle size={16} className="health-icon degraded" />;
      case 'failed': return <XCircle size={16} className="health-icon failed" />;
      default: return <Activity size={16} className="health-icon unknown" />;
    }
  };

  const getHealthColor = (health) => {
    switch (health) {
      case 'healthy': return '#10b981';
      case 'degraded': return '#f59e0b';
      case 'failed': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const counts = getServiceCounts();
  const overallHealth = getOverallHealth();
  const totalServices = Object.values(counts).reduce((sum, count) => sum + count, 0);

  return (
    <div className="system-status">
      <div className="status-header">
        <div className="header-content">
          <h3>System Status</h3>
          <div className="overall-health">
            {getHealthIcon(overallHealth)}
            <span style={{ color: getHealthColor(overallHealth) }}>
              {overallHealth.toUpperCase()}
            </span>
          </div>
        </div>
        {lastUpdate && (
          <div className="last-update">
            <Clock size={12} />
            <span>Updated: {new Date(lastUpdate).toLocaleTimeString()}</span>
          </div>
        )}
      </div>

      <div className="status-content">
        {/* Service Count Summary */}
        <div className="service-summary">
          <div className="summary-item">
            <div className="summary-label">Total Services</div>
            <div className="summary-value">{totalServices}</div>
          </div>
          <div className="summary-item">
            <div className="summary-label">Healthy</div>
            <div className="summary-value healthy">{counts.healthy}</div>
          </div>
          <div className="summary-item">
            <div className="summary-label">Degraded</div>
            <div className="summary-value degraded">{counts.degraded}</div>
          </div>
          <div className="summary-item">
            <div className="summary-label">Failed</div>
            <div className="summary-value failed">{counts.failed}</div>
          </div>
        </div>

        {/* Service List */}
        <div className="service-list">
          <h4>Service Details</h4>
          <div className="services">
            {Object.entries(systemState).map(([serviceId, service]) => (
              <div key={serviceId} className="service-item">
                <div className="service-info">
                  {getHealthIcon(service.health)}
                  <div className="service-details">
                    <div className="service-name">{service.name || serviceId}</div>
                    <div className="service-health" style={{ color: getHealthColor(service.health) }}>
                      {service.health || 'unknown'}
                    </div>
                  </div>
                </div>
                {service.lastUpdated && (
                  <div className="service-time">
                    {new Date(service.lastUpdated).toLocaleTimeString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* System Actions */}
        <div className="system-actions">
          <button className="reset-all-button" onClick={onReset}>
            <RotateCcw size={16} />
            Reset All Services
          </button>
        </div>
      </div>
    </div>
  );
};

export default SystemStatus;
