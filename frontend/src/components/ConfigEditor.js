import React, { useState } from 'react';
import axios from 'axios';
import './ConfigEditor.css';

const ML_URL = process.env.REACT_APP_ML_URL || 'http://localhost:5001';

const DEFAULT_CONFIG = {
  input_format: 'csv',
  field_mappings: {
    timestamp: 'timestamp',
    source_service: 'source_service',
    target_service: 'target_service',
    endpoint: 'endpoint',
    latency_ms: 'latency_ms',
    status_code: 'status_code',
    error_type: 'error_type',
    concurrent_requests: 'concurrent_requests',
    cpu_percent: 'cpu_percent',
    memory_percent: 'memory_percent',
    retry_count: 'retry_count',
  },
  error_detection: {
    from_status_code: true,
    error_threshold: 400,
  },
};

const DEFAULT_LOGS = `timestamp,source_service,target_service,endpoint,latency_ms,status_code
2024-11-01T09:45:12Z,api-gateway,auth-service,/validate,120,200
2024-11-01T09:45:13Z,auth-service,database-service,/query,85,200
2024-11-01T10:30:01Z,order-service,database-service,/query,1800,503
2024-11-01T10:30:02Z,user-service,database-service,/users,2100,503`;

const CANONICAL_FIELDS = [
  'timestamp', 'source_service', 'target_service', 'endpoint',
  'latency_ms', 'status_code', 'error_type', 'concurrent_requests',
  'cpu_percent', 'memory_percent', 'retry_count',
];

const FIELD_HINTS = {
  timestamp: 'ISO 8601 datetime',
  source_service: 'Service making the call',
  target_service: 'Service being called',
  endpoint: 'API path',
  latency_ms: 'Response time in ms',
  status_code: 'HTTP status (200, 503…)',
  error_type: 'Error name/message',
  concurrent_requests: 'Active connections at time of request',
  cpu_percent: 'CPU usage %',
  memory_percent: 'Memory usage %',
  retry_count: 'Number of retries',
};

export default function ConfigEditor({ onClose }) {
  const [configText, setConfigText] = useState(JSON.stringify(DEFAULT_CONFIG, null, 2));
  const [logText, setLogText] = useState(DEFAULT_LOGS);
  const [configError, setConfigError] = useState(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);
  const [apiError, setApiError] = useState(null);
  const [activeTab, setActiveTab] = useState('visual');

  // Parse config safely
  const getParsedConfig = () => {
    try {
      return { ok: true, config: JSON.parse(configText) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };

  const handleConfigChange = (val) => {
    setConfigText(val);
    setConfigError(null);
    setResult(null);
    setApiError(null);
    const parsed = (() => { try { JSON.parse(val); return true; } catch { return false; } })();
    if (!parsed) setConfigError('Invalid JSON');
  };

  // Visual editor — update a single field_mapping
  const handleMappingChange = (canonicalField, value) => {
    const { ok, config } = getParsedConfig();
    if (!ok) return;
    config.field_mappings[canonicalField] = value || null;
    setConfigText(JSON.stringify(config, null, 2));
    setResult(null);
    setApiError(null);
  };

  const handleFormatChange = (val) => {
    const { ok, config } = getParsedConfig();
    if (!ok) return;
    config.input_format = val;
    setConfigText(JSON.stringify(config, null, 2));
    setResult(null);
  };

  const handleTest = async () => {
    const { ok, config, error } = getParsedConfig();
    if (!ok) { setConfigError(error); return; }
    if (!logText.trim()) { setApiError('Paste some log content above to test.'); return; }

    setTesting(true);
    setResult(null);
    setApiError(null);
    try {
      const res = await axios.post(`${ML_URL}/normalize`, {
        log_content: logText,
        adapter_config: config,
      }, { timeout: 15000 });
      setResult(res.data);
    } catch (e) {
      setApiError(e.response?.data?.error || 'Test failed. Is the ML service running?');
    } finally {
      setTesting(false);
    }
  };

  const downloadConfig = () => {
    const blob = new Blob([configText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kendra_adapter_config.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const { ok: configValid, config: parsedConfig } = getParsedConfig();
  const mappings = configValid ? (parsedConfig.field_mappings || {}) : {};
  const format = configValid ? (parsedConfig.input_format || 'csv') : 'csv';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="config-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="config-header">
          <div>
            <h2>Adapter Config Editor</h2>
            <p className="config-subtitle">
              Map your log fields to Kendra's schema — paste your logs, adjust the mapping, click Test
            </p>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="config-body">

          {/* Top row: log input + config editor */}
          <div className="config-top">

            {/* Left: paste logs */}
            <div className="config-section">
              <div className="section-label">1. Paste your logs</div>
              <textarea
                className="log-input"
                value={logText}
                onChange={e => { setLogText(e.target.value); setResult(null); setApiError(null); }}
                placeholder="Paste your raw log content here (CSV, JSON, or Apache/Nginx format)…"
                spellCheck={false}
              />
            </div>

            {/* Right: config */}
            <div className="config-section">
              <div className="section-label-row">
                <span className="section-label">2. Map your fields</span>
                <div className="editor-tabs">
                  <button className={`etab ${activeTab === 'visual' ? 'active' : ''}`} onClick={() => setActiveTab('visual')}>Visual</button>
                  <button className={`etab ${activeTab === 'json' ? 'active' : ''}`} onClick={() => setActiveTab('json')}>JSON</button>
                </div>
              </div>

              {activeTab === 'visual' ? (
                <div className="visual-editor">
                  <div className="format-row">
                    <span className="field-label">input_format</span>
                    <select
                      className="format-select"
                      value={format}
                      onChange={e => handleFormatChange(e.target.value)}
                    >
                      <option value="csv">csv</option>
                      <option value="json">json</option>
                      <option value="apache">apache / nginx</option>
                    </select>
                  </div>
                  <div className="mappings-grid">
                    {CANONICAL_FIELDS.map(f => (
                      <div key={f} className="mapping-row">
                        <div className="mapping-canonical">
                          <span className="canonical-name">{f}</span>
                          <span className="canonical-hint">{FIELD_HINTS[f]}</span>
                        </div>
                        <span className="mapping-arrow">←</span>
                        <input
                          className="mapping-input"
                          placeholder="your column name (or leave blank)"
                          value={mappings[f] || ''}
                          onChange={e => handleMappingChange(f, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="json-editor-wrap">
                  <textarea
                    className={`json-input ${configError ? 'json-error' : ''}`}
                    value={configText}
                    onChange={e => handleConfigChange(e.target.value)}
                    spellCheck={false}
                  />
                  {configError && <div className="json-error-msg">{configError}</div>}
                </div>
              )}
            </div>
          </div>

          {/* Test button row */}
          <div className="test-row">
            <button
              className="test-btn"
              onClick={handleTest}
              disabled={testing || !!configError || !logText.trim()}
            >
              {testing ? <><span className="btn-spinner" /> Testing…</> : '▶ Test Conversion'}
            </button>
            <button className="download-btn" onClick={downloadConfig} disabled={!!configError}>
              ⬇ Download Config
            </button>
            {apiError && <span className="test-error">{apiError}</span>}
          </div>

          {/* Result table */}
          {result && (
            <div className="config-result">
              <div className="result-meta-row">
                <span className="result-ok">✓ {result.total_rows} rows normalized</span>
                <span className="result-note">showing first {result.sample_rows?.length}</span>
              </div>
              <div className="result-table-wrap">
                <table className="result-table">
                  <thead>
                    <tr>{CANONICAL_FIELDS.map(f => <th key={f}>{f}</th>)}</tr>
                  </thead>
                  <tbody>
                    {result.sample_rows?.map((row, i) => (
                      <tr key={i}>
                        {CANONICAL_FIELDS.map(f => (
                          <td key={f} className={row[f] != null && row[f] !== '' ? '' : 'null-cell'}>
                            {row[f] != null && row[f] !== '' ? String(row[f]) : '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="config-footer">
          <span className="footer-note">Download the config and pass it via the /analyze API to use with your real logs</span>
          <button className="modal-cancel" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
