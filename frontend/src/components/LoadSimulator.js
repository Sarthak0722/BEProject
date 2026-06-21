import React, { useState, useCallback, useRef } from 'react';
import axios from 'axios';
import './LoadSimulator.css';

const ML_URL = process.env.REACT_APP_ML_URL || 'http://localhost:5001';

const STATUS_COLOR = { healthy: '#10b981', degraded: '#f59e0b', failed: '#ef4444', unknown: '#6b7280' };

const LoadSimulator = ({ onPredictionsChange, isMLReady }) => {
  const [users, setUsers] = useState(0);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  const fetchPrediction = useCallback(async (value) => {
    if (value === 0) {
      onPredictionsChange(null);
      setSummary(null);
      return;
    }
    if (!isMLReady) {
      setError('ML service not ready. Run Log Analysis first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post(`${ML_URL}/predict/load`, { concurrent_users: value });
      onPredictionsChange(res.data.predictions);
      setSummary(res.data.summary);
    } catch (e) {
      setError('Prediction failed. Check ML service.');
      onPredictionsChange(null);
    } finally {
      setLoading(false);
    }
  }, [isMLReady, onPredictionsChange]);

  const handleSliderChange = (e) => {
    const value = parseInt(e.target.value);
    setUsers(value);
    // Show spinner immediately while dragging, not just after debounce fires
    if (value > 0) setLoading(true);
    else { setLoading(false); setSummary(null); onPredictionsChange(null); }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPrediction(value), 280);
  };

  const getOverallColor = () => {
    if (!summary) return '#6b7280';
    if (summary.overall_status === 'critical') return '#ef4444';
    if (summary.overall_status === 'degraded') return '#f59e0b';
    return '#10b981';
  };

  const zones = [
    { label: 'Safe', max: 600, color: '#10b981' },
    { label: 'Warning', max: 1100, color: '#f59e0b' },
    { label: 'Critical', max: 2000, color: '#ef4444' },
  ];

  const currentZone = zones.find(z => users <= z.max) || zones[zones.length - 1];

  return (
    <div className="load-simulator">
      <div className="load-header">
        <h3>Load Simulator</h3>
        <span className="load-badge" style={{ background: getOverallColor() }}>
          {users === 0 ? 'IDLE' : loading ? 'PREDICTING...' : (summary?.overall_status || 'OK').toUpperCase()}
        </span>
      </div>

      <div className="slider-section">
        <div className="slider-labels-top">
          <span className="users-label">
            <span className="users-count">{users.toLocaleString()}</span>
            <span className="users-unit"> concurrent users</span>
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {loading && <span className="ls-spinner" />}
            {users > 0 && !loading && (
              <span className="zone-label" style={{ color: currentZone.color }}>
                {currentZone.label} Zone
              </span>
            )}
          </div>
        </div>

        <div className="slider-track-wrapper">
          <input
            type="range"
            min="0"
            max="2000"
            step="50"
            value={users}
            onChange={handleSliderChange}
            className="load-slider"
          />
          <div className="zone-markers">
            <div className="zone-marker" style={{ left: '30%', background: '#10b981' }} title="Safe up to ~600" />
            <div className="zone-marker" style={{ left: '55%', background: '#f59e0b' }} title="Warning ~600-1100" />
            <div className="zone-marker" style={{ left: '100%', background: '#ef4444' }} title="Critical >1100" />
          </div>
        </div>

        <div className="slider-range-labels">
          <span>0</span>
          <span>500</span>
          <span>1,000</span>
          <span>1,500</span>
          <span>2,000</span>
        </div>
      </div>

      {error && <div className="load-error">{error}</div>}

      {summary && !loading && (
        <div className="prediction-summary">
          <div className="summary-row">
            {summary.healthy?.length > 0 && (
              <div className="summary-group">
                <span className="sg-label" style={{ color: '#10b981' }}>Healthy</span>
                <div className="sg-tags">
                  {summary.healthy.map(s => (
                    <span key={s} className="service-tag healthy-tag">{s}</span>
                  ))}
                </div>
              </div>
            )}
            {summary.degraded?.length > 0 && (
              <div className="summary-group">
                <span className="sg-label" style={{ color: '#f59e0b' }}>Degraded</span>
                <div className="sg-tags">
                  {summary.degraded.map(s => (
                    <span key={s} className="service-tag degraded-tag">{s}</span>
                  ))}
                </div>
              </div>
            )}
            {summary.failed?.length > 0 && (
              <div className="summary-group">
                <span className="sg-label" style={{ color: '#ef4444' }}>Failed</span>
                <div className="sg-tags">
                  {summary.failed.map(s => (
                    <span key={s} className="service-tag failed-tag">{s}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <p className="prediction-note">
            Graph colors reflect predicted state at {users.toLocaleString()} users
          </p>
        </div>
      )}

      {users === 0 && (
        <p className="idle-note">Drag the slider to simulate load and predict system behavior</p>
      )}
    </div>
  );
};

export default LoadSimulator;
