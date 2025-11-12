import React, { useState } from 'react';
import { X, AlertTriangle, Clock, Zap, RotateCcw } from 'lucide-react';
import './ControlPanel.css';

const ControlPanel = ({ serviceId, serviceConfig, serviceState, onFaultInjection, onClose }) => {
  const [faultSettings, setFaultSettings] = useState({
    isFailed: false,
    latency: 0,
    errorRate: 0
  });

  const handleFaultChange = (type, value) => {
    const newSettings = { ...faultSettings, [type]: value };
    setFaultSettings(newSettings);

    // Immediately apply the fault
    let fault = {};
    
    if (type === 'isFailed') {
      fault = {
        type: 'FAILURE',
        isFailed: value,
        reason: value ? 'Manual failure injection' : undefined
      };
    } else if (type === 'latency') {
      fault = {
        type: 'LATENCY',
        delay: value
      };
    } else if (type === 'errorRate') {
      fault = {
        type: 'ERROR_RATE',
        rate: value / 100 // Convert percentage to decimal
      };
    }

    if (Object.keys(fault).length > 0) {
      onFaultInjection(serviceId, fault);
    }
  };

  const handleReset = () => {
    setFaultSettings({
      isFailed: false,
      latency: 0,
      errorRate: 0
    });
    
    onFaultInjection(serviceId, {
      type: 'RESET'
    });
  };

  const getHealthColor = (health) => {
    switch (health) {
      case 'healthy': return '#10b981';
      case 'degraded': return '#f59e0b';
      case 'failed': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const getHealthIcon = (health) => {
    switch (health) {
      case 'healthy': return '✅';
      case 'degraded': return '⚠️';
      case 'failed': return '❌';
      default: return '❓';
    }
  };

  return (
    <div className="control-panel">
      <div className="panel-header">
        <div className="service-info">
          <h3>{serviceConfig?.name || serviceId}</h3>
          <div className="health-status">
            <span className="health-indicator" style={{ color: getHealthColor(serviceState?.health) }}>
              {getHealthIcon(serviceState?.health)} {serviceState?.health || 'unknown'}
            </span>
          </div>
        </div>
        <button className="close-button" onClick={onClose}>
          <X size={20} />
        </button>
      </div>

      <div className="panel-content">
        <div className="fault-section">
          <h4>Fault Injection Controls</h4>
          
          {/* Total Failure Toggle */}
          <div className="control-group">
            <label className="control-label">
              <AlertTriangle size={16} />
              Simulate Total Failure
            </label>
            <div className="toggle-container">
              <input
                type="checkbox"
                id="failure-toggle"
                checked={faultSettings.isFailed}
                onChange={(e) => handleFaultChange('isFailed', e.target.checked)}
                className="toggle-input"
              />
              <label htmlFor="failure-toggle" className="toggle-label">
                <span className="toggle-slider"></span>
              </label>
            </div>
          </div>

          {/* Latency Slider */}
          <div className="control-group">
            <label className="control-label">
              <Clock size={16} />
              Inject Latency: {faultSettings.latency}ms
            </label>
            <div className="slider-container">
              <input
                type="range"
                min="0"
                max="5000"
                step="100"
                value={faultSettings.latency}
                onChange={(e) => handleFaultChange('latency', parseInt(e.target.value))}
                className="slider"
              />
              <div className="slider-labels">
                <span>0ms</span>
                <span>5000ms</span>
              </div>
            </div>
          </div>

          {/* Error Rate Slider */}
          <div className="control-group">
            <label className="control-label">
              <Zap size={16} />
              Inject Error Rate: {faultSettings.errorRate}%
            </label>
            <div className="slider-container">
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={faultSettings.errorRate}
                onChange={(e) => handleFaultChange('errorRate', parseInt(e.target.value))}
                className="slider"
              />
              <div className="slider-labels">
                <span>0%</span>
                <span>100%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Service Details */}
        {serviceState && (
          <div className="details-section">
            <h4>Service Details</h4>
            <div className="detail-item">
              <span className="detail-label">Status:</span>
              <span className="detail-value" style={{ color: getHealthColor(serviceState.health) }}>
                {serviceState.health}
              </span>
            </div>
            {serviceState.lastUpdated && (
              <div className="detail-item">
                <span className="detail-label">Last Updated:</span>
                <span className="detail-value">
                  {new Date(serviceState.lastUpdated).toLocaleTimeString()}
                </span>
              </div>
            )}
            {serviceState.dependencies && (
              <div className="detail-item">
                <span className="detail-label">Dependencies:</span>
                <div className="dependencies">
                  {Object.entries(serviceState.dependencies).map(([dep, health]) => (
                    <span key={dep} className="dependency-tag" style={{ color: getHealthColor(health) }}>
                      {dep}: {health}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Reset Button */}
        <div className="reset-section">
          <button className="reset-button" onClick={handleReset}>
            <RotateCcw size={16} />
            Reset Service
          </button>
        </div>
      </div>
    </div>
  );
};

export default ControlPanel;
