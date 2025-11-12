import React, { useState, useEffect } from 'react';
import { X, AlertTriangle, Clock, Zap, RotateCcw, Activity } from 'lucide-react';
import './ServicePopup.css';

const ServicePopup = ({ serviceId, serviceConfig, serviceState, onFaultInjection, onClose, isVisible }) => {
  const [faultSettings, setFaultSettings] = useState({
    isFailed: false,
    latency: 0,
    errorRate: 0
  });

  useEffect(() => {
    if (isVisible) {
      // Reset settings when popup opens
      setFaultSettings({
        isFailed: false,
        latency: 0,
        errorRate: 0
      });
    }
  }, [isVisible, serviceId]);

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
    
    // Use the reset service event instead of fault injection
    onFaultInjection(serviceId, {
      type: 'RESET_SERVICE'
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

  if (!isVisible) return null;

  return (
    <div className="popup-overlay" onClick={onClose}>
      <div className="service-popup" onClick={(e) => e.stopPropagation()}>
        <div className="popup-header">
          <div className="service-info">
            <div className="service-icon-large">
              {getHealthIcon(serviceState?.health)}
            </div>
            <div>
              <h3>{serviceConfig?.name || serviceId}</h3>
              <div className="health-status" style={{ color: getHealthColor(serviceState?.health) }}>
                {serviceState?.health || 'unknown'}
              </div>
            </div>
          </div>
          <button className="close-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="popup-content">
          {/* Service Details */}
          <div className="service-details-section">
            <h4>
              <Activity size={16} />
              Service Status
            </h4>
            <div className="detail-grid">
              <div className="detail-item">
                <span className="detail-label">Health:</span>
                <span className="detail-value" style={{ color: getHealthColor(serviceState?.health) }}>
                  {serviceState?.health || 'unknown'}
                </span>
              </div>
              {serviceState?.lastUpdated && (
                <div className="detail-item">
                  <span className="detail-label">Last Updated:</span>
                  <span className="detail-value">
                    {new Date(serviceState.lastUpdated).toLocaleTimeString()}
                  </span>
                </div>
              )}
              {serviceState?.dependencies && (
                <div className="detail-item full-width">
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
          </div>

          {/* Fault Injection Controls */}
          <div className="fault-controls-section">
            <h4>Fault Injection</h4>
            
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

          {/* Reset Button */}
          <div className="reset-section">
            <button className="reset-button" onClick={handleReset}>
              <RotateCcw size={16} />
              Reset Service
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ServicePopup;
