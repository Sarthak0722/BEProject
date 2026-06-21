import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './InsightsPanel.css';

const ML_URL = process.env.REACT_APP_ML_URL || 'http://localhost:5001';

const RiskBar = ({ score, service }) => {
  const color = score >= 70 ? '#ef4444' : score >= 40 ? '#f59e0b' : '#10b981';
  return (
    <div className="risk-row">
      <span className="risk-service">{service}</span>
      <div className="risk-bar-track">
        <div className="risk-bar-fill" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="risk-score" style={{ color }}>{score}</span>
    </div>
  );
};

const InsightsPanel = ({ isMLReady }) => {
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isMLReady) fetchInsights();
  }, [isMLReady]);

  const fetchInsights = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${ML_URL}/insights`);
      setInsights(res.data);
    } catch (e) {
      setError('Could not load insights');
    } finally {
      setLoading(false);
    }
  };

  if (!isMLReady) {
    return (
      <div className="insights-panel not-ready">
        <h3>ML Insights</h3>
        <p>Run Log Analysis to unlock insights</p>
      </div>
    );
  }

  if (loading) return (
    <div className="insights-panel">
      <h3>ML Insights</h3>
      <div className="insights-loading">Analyzing historical data...</div>
    </div>
  );

  if (error) return (
    <div className="insights-panel">
      <h3>ML Insights</h3>
      <div className="insights-error">{error}</div>
    </div>
  );

  if (!insights) return null;

  const topRisks = Object.entries(insights.risk_scores || {})
    .sort(([, a], [, b]) => b - a);

  const topSaturation = (insights.saturation_points || [])
    .sort((a, b) => a.cpu_saturation_at_requests - b.cpu_saturation_at_requests);

  const retryInfo = insights.retry_amplification || {};

  return (
    <div className="insights-panel">
      <div className="insights-header">
        <h3>ML Insights</h3>
        <span className="insights-badge">
          {(insights.log_summary?.total_rows || 0).toLocaleString()} rows analyzed
        </span>
      </div>

      {/* Risk Scores */}
      <div className="insight-section">
        <div className="insight-section-title">Service Risk Score (0-100)</div>
        <div className="risk-bars">
          {topRisks.map(([svc, score]) => (
            <RiskBar key={svc} service={svc} score={score} />
          ))}
        </div>
      </div>

      {/* Saturation Points */}
      {topSaturation.length > 0 && (
        <div className="insight-section">
          <div className="insight-section-title">CPU Saturation Points</div>
          <div className="saturation-list">
            {topSaturation.map(item => (
              <div key={item.service} className="saturation-item">
                <span className="sat-service">{item.service}</span>
                <span className="sat-value">
                  ~{item.cpu_saturation_at_requests.toLocaleString()} req/s
                </span>
              </div>
            ))}
          </div>
          <p className="insight-note">CPU hits 95% at these concurrent request levels</p>
        </div>
      )}

      {/* Retry Amplification */}
      {retryInfo.amplification_factor > 1 && (
        <div className="insight-section">
          <div className="insight-section-title">Retry Amplification</div>
          <div className="amplification-display">
            <div className="amp-number">{retryInfo.peak_amplification_factor}×</div>
            <div className="amp-desc">
              peak actual load vs visible requests
              <br />
              <span className="amp-sub">
                {retryInfo.total_retries?.toLocaleString()} retries across {retryInfo.total_requests?.toLocaleString()} requests
              </span>
            </div>
          </div>
          <p className="insight-note">
            Retries create hidden load — real DB pressure is higher than request count suggests
          </p>
        </div>
      )}

      {/* Anomaly Periods */}
      {insights.anomaly_periods?.length > 0 && (
        <div className="insight-section">
          <div className="insight-section-title">Detected Anomaly Periods</div>
          <div className="anomaly-list">
            {insights.anomaly_periods.slice(0, 4).map((p, i) => {
              const start = new Date(p.start);
              const end = new Date(p.end);
              return (
                <div key={i} className="anomaly-item">
                  <span className="anomaly-dot" />
                  <span className="anomaly-time">
                    {isNaN(start) ? p.start : start.toLocaleTimeString()} –{' '}
                    {isNaN(end) ? p.end : end.toLocaleTimeString()}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="insight-note">Isolation Forest detected these as statistically anomalous</p>
        </div>
      )}
    </div>
  );
};

export default InsightsPanel;
