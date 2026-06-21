import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { X, AlertTriangle, Clock, Zap, RotateCcw, Activity } from 'lucide-react';
import './ServicePopup.css';

const ML_URL = process.env.REACT_APP_ML_URL || 'http://localhost:5001';

const ServicePopup = ({ serviceId, serviceConfig, serviceState, currentFaults, onFaultInjection, onClose, isVisible, isMLReady }) => {
  const [faultSettings, setFaultSettings] = useState({ isFailed: false, latency: 0, errorRate: 0 });
  const [cascadePrediction, setCascadePrediction] = useState(null);
  const [predicting, setPredicting] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const busyTimerRef = useRef(null);

  // When popup opens for a (possibly different) service, load its current fault state
  useEffect(() => {
    if (isVisible && serviceId) {
      const faults = {
        isFailed: currentFaults.isFailed || false,
        latency: currentFaults.latency || 0,
        errorRate: currentFaults.errorRate || 0,
      };
      setFaultSettings(faults);
      // Re-fetch cascade prediction if active faults exist that would trigger it
      if (faults.isFailed) {
        fetchCascadePrediction({ type: 'FAILURE', isFailed: true });
      } else if (faults.latency >= 800) {
        fetchCascadePrediction({ type: 'LATENCY', delay: faults.latency });
      } else if (faults.errorRate >= 15) {
        fetchCascadePrediction({ type: 'FAILURE', isFailed: true });
      } else {
        setCascadePrediction(null);
      }
    }
  }, [isVisible, serviceId]); // intentionally not depending on currentFaults to avoid loop

  const fetchCascadePrediction = async (fault) => {
    if (!isMLReady || !serviceId) return;
    setPredicting(true);
    try {
      const res = await axios.post(`${ML_URL}/predict/cascade`, { serviceId, fault });
      setCascadePrediction(res.data);
    } catch { setCascadePrediction(null); }
    finally { setPredicting(false); }
  };

  const triggerBusy = () => {
    setIsBusy(true);
    clearTimeout(busyTimerRef.current);
    busyTimerRef.current = setTimeout(() => setIsBusy(false), 700);
  };

  const handleFaultChange = (type, value) => {
    const newSettings = { ...faultSettings, [type]: value };
    setFaultSettings(newSettings);
    triggerBusy();

    let fault = {};
    if (type === 'isFailed') {
      fault = { type: 'FAILURE', isFailed: value, reason: value ? 'Manual failure injection' : undefined };
      if (value) fetchCascadePrediction(fault);
      else setCascadePrediction(null);
    } else if (type === 'latency') {
      fault = { type: 'LATENCY', delay: value };
      if (value >= 800) fetchCascadePrediction(fault);
      else setCascadePrediction(null);
    } else if (type === 'errorRate') {
      fault = { type: 'ERROR_RATE', rate: value / 100 };
      if (value >= 15) fetchCascadePrediction({ type: 'FAILURE', isFailed: true });
    }
    if (Object.keys(fault).length > 0) onFaultInjection(serviceId, fault);
  };

  const handleReset = () => {
    setFaultSettings({ isFailed: false, latency: 0, errorRate: 0 });
    setCascadePrediction(null);
    onFaultInjection(serviceId, { type: 'RESET_SERVICE' });
  };

  const getHealthColor = (h) => ({ healthy: '#10b981', degraded: '#f59e0b', failed: '#ef4444' }[h] || '#6b7280');
  const getHealthLabel = (h) => ({ healthy: 'HEALTHY', degraded: 'DEGRADED', failed: 'FAILED' }[h] || 'UNKNOWN');

  const hasActiveFault = faultSettings.isFailed || faultSettings.latency > 0 || faultSettings.errorRate > 0;

  if (!isVisible) return null;

  return (
    <div className="popup-overlay" onClick={onClose}>
      <div className="service-popup" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="popup-header" style={{ borderBottom: `2px solid ${getHealthColor(serviceState?.health)}22` }}>
          <div className="popup-svc-info">
            <div className="popup-health-dot" style={{ background: getHealthColor(serviceState?.health) }} />
            <div>
              <div className="popup-svc-name">{serviceConfig?.name || serviceId}</div>
              <div className="popup-svc-health" style={{ color: getHealthColor(serviceState?.health) }}>
                {getHealthLabel(serviceState?.health)}
              </div>
            </div>
          </div>
          <div className="popup-header-right">
            {isBusy && <span className="popup-busy-spinner" />}
            {hasActiveFault && !isBusy && <span className="fault-active-badge">FAULT ACTIVE</span>}
            <button className="close-btn" onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        <div className="popup-body">
          {/* Current injected state summary */}
          {hasActiveFault && (
            <div className="active-faults-row">
              {faultSettings.isFailed && <span className="fault-chip chip-red">Total Failure</span>}
              {faultSettings.latency > 0 && <span className="fault-chip chip-amber">{faultSettings.latency}ms Latency</span>}
              {faultSettings.errorRate > 0 && <span className="fault-chip chip-orange">{faultSettings.errorRate}% Errors</span>}
            </div>
          )}

          {/* Cascade Prediction */}
          {(cascadePrediction || predicting) && (
            <div className="cascade-box">
              <div className="cascade-box-title">
                <Activity size={12} /> ML Cascade Prediction
              </div>
              {predicting ? (
                <div className="cascade-loading">Analyzing historical patterns...</div>
              ) : cascadePrediction?.cascade_predictions?.length > 0 ? (
                <div className="cascade-items">
                  {cascadePrediction.cascade_predictions.map(c => (
                    <div key={c.service} className="cascade-row">
                      <span className="cascade-svc">{c.service}</span>
                      <span className="cascade-prob" style={{
                        color: c.probability >= 0.7 ? '#f87171' : c.probability >= 0.4 ? '#fbbf24' : '#34d399'
                      }}>
                        {Math.round(c.probability * 100)}%
                      </span>
                      <span className="cascade-delay">~{c.expected_delay_seconds}s</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="cascade-none">No significant cascade risk</div>
              )}
            </div>
          )}

          {/* Fault Controls */}
          <div className="controls-section">
            <div className="controls-title">Fault Injection Controls</div>

            {/* Total Failure */}
            <div className="control-row">
              <div className="control-label-row">
                <AlertTriangle size={14} className="ctrl-icon red" />
                <span>Total Failure</span>
                <span className="ctrl-desc">Service returns 500 for all requests</span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={faultSettings.isFailed}
                  onChange={e => handleFaultChange('isFailed', e.target.checked)}
                />
                <span className="toggle-track">
                  <span className="toggle-thumb" />
                </span>
              </label>
            </div>

            {/* Latency */}
            <div className="control-row vertical">
              <div className="control-label-row">
                <Clock size={14} className="ctrl-icon amber" />
                <span>Inject Latency</span>
                <span className="ctrl-value">{faultSettings.latency}ms</span>
              </div>
              <input
                type="range" min="0" max="5000" step="100"
                value={faultSettings.latency}
                onChange={e => handleFaultChange('latency', parseInt(e.target.value))}
                className={`ctrl-slider ${faultSettings.latency >= 3000 ? 'slider-red' : faultSettings.latency >= 800 ? 'slider-amber' : ''}`}
              />
              <div className="slider-scale">
                <span>0ms</span>
                <span className="scale-mid">800ms</span>
                <span className="scale-mid">3000ms</span>
                <span>5000ms</span>
              </div>
            </div>

            {/* Error Rate */}
            <div className="control-row vertical">
              <div className="control-label-row">
                <Zap size={14} className="ctrl-icon orange" />
                <span>Error Rate</span>
                <span className="ctrl-value">{faultSettings.errorRate}%</span>
                {faultSettings.errorRate >= 50 && <span className="ctrl-warn">will fail</span>}
                {faultSettings.errorRate >= 15 && faultSettings.errorRate < 50 && <span className="ctrl-caution">will degrade</span>}
              </div>
              <input
                type="range" min="0" max="100" step="5"
                value={faultSettings.errorRate}
                onChange={e => handleFaultChange('errorRate', parseInt(e.target.value))}
                className={`ctrl-slider ${faultSettings.errorRate >= 50 ? 'slider-red' : faultSettings.errorRate >= 15 ? 'slider-amber' : ''}`}
              />
              <div className="slider-scale">
                <span>0%</span>
                <span className="scale-mid">15% → degrade</span>
                <span className="scale-mid">50% → fail</span>
                <span>100%</span>
              </div>
            </div>
          </div>

          {/* Reset */}
          <button className={`reset-svc-btn ${hasActiveFault ? 'reset-active' : ''}`} onClick={handleReset}>
            <RotateCcw size={14} />
            {hasActiveFault ? 'Reset This Service' : 'Service is Clean'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ServicePopup;
