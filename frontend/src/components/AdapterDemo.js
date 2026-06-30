import React, { useState } from 'react';
import axios from 'axios';
import './AdapterDemo.css';

const ML_URL = process.env.REACT_APP_ML_URL || 'http://localhost:5001';

const PRESETS = {
  datadog: {
    label: 'Datadog APM',
    color: '#7b5ea7',
    icon: '🐶',
    description: 'Datadog APM trace logs exported as JSON. Duration in nanoseconds, service names differ.',
    sampleLog: `[
  {"timestamp":"2024-11-01T09:45:12.342Z","service":"auth-service","resource_name":"database-service","http.url":"/auth/validate","duration":342500000,"http.status_code":"200","error":0},
  {"timestamp":"2024-11-01T09:45:13.100Z","service":"api-gateway","resource_name":"auth-service","http.url":"/validate","duration":125000000,"http.status_code":"200","error":0},
  {"timestamp":"2024-11-01T10:30:01.500Z","service":"order-service","resource_name":"database-service","http.url":"/query","duration":1800000000,"http.status_code":"503","error":1},
  {"timestamp":"2024-11-01T10:30:02.800Z","service":"user-service","resource_name":"database-service","http.url":"/users","duration":2100000000,"http.status_code":"503","error":1},
  {"timestamp":"2024-11-01T10:30:04.000Z","service":"api-gateway","resource_name":"order-service","http.url":"/orders","duration":980000000,"http.status_code":"503","error":1}
]`,
    adapterConfig: {
      input_format: 'json',
      field_mappings: {
        timestamp: 'timestamp',
        source_service: 'service',
        target_service: 'resource_name',
        endpoint: 'http.url',
        latency_ms: 'duration',
        status_code: 'http.status_code',
        error_type: null,
        concurrent_requests: null,
        cpu_percent: null,
        memory_percent: null,
        retry_count: null,
      },
      error_detection: { from_status_code: true, error_threshold: 400 },
    },
    highlights: ['duration (ns) → latency_ms (ms)', 'service → source_service', 'resource_name → target_service'],
  },
  cloudwatch: {
    label: 'AWS CloudWatch',
    color: '#e8812a',
    icon: '☁',
    description: 'CloudWatch Logs Insights CSV export. Has resource metrics like CPU and memory.',
    sampleLog: `@timestamp,log_group,upstream_service,request_path,response_time_ms,http_status,active_connections,cpu_utilization,memory_utilization,retry_attempts,error_message
2024-11-01 09:45:12.342,/ecs/auth-service,database-service,/auth/validate,342.5,200,450,45.2,61.8,0,
2024-11-01 09:45:13.100,/ecs/api-gateway,auth-service,/validate,125.0,200,448,22.1,38.4,0,
2024-11-01 10:30:01.500,/ecs/order-service,database-service,/query,1800.0,503,1520,91.2,79.3,2,TIMEOUT
2024-11-01 10:30:02.800,/ecs/user-service,database-service,/users,2100.0,503,1518,92.8,80.1,3,TIMEOUT
2024-11-01 10:30:04.000,/ecs/api-gateway,order-service,/orders,980.0,503,1519,88.4,76.2,1,UPSTREAM_ERROR`,
    adapterConfig: {
      input_format: 'csv',
      field_mappings: {
        timestamp: '@timestamp',
        source_service: 'log_group',
        target_service: 'upstream_service',
        endpoint: 'request_path',
        latency_ms: 'response_time_ms',
        status_code: 'http_status',
        error_type: 'error_message',
        concurrent_requests: 'active_connections',
        cpu_percent: 'cpu_utilization',
        memory_percent: 'memory_utilization',
        retry_count: 'retry_attempts',
      },
      error_detection: { from_status_code: true, error_threshold: 400 },
    },
    highlights: ['log_group (/ecs/auth-service) → source_service', '@timestamp → timestamp', 'cpu_utilization → cpu_percent'],
  },
  nginx: {
    label: 'Nginx Access Log',
    color: '#269539',
    icon: '⚙',
    description: 'Standard Nginx combined access log format. No service names — uses static mapping.',
    sampleLog: `192.168.1.1 - - [01/Nov/2024:09:45:12 +0000] "POST /auth/validate HTTP/1.1" 200 512 0.342
10.0.0.2 - - [01/Nov/2024:09:45:13 +0000] "GET /users/profile HTTP/1.1" 200 1024 0.125
10.0.0.5 - - [01/Nov/2024:10:30:01 +0000] "POST /orders HTTP/1.1" 503 256 1.800
10.0.0.3 - - [01/Nov/2024:10:30:02 +0000] "GET /products HTTP/1.1" 503 128 2.100
10.0.0.1 - - [01/Nov/2024:10:30:04 +0000] "PUT /orders/123 HTTP/1.1" 503 64 0.980`,
    adapterConfig: {
      input_format: 'apache',
      field_mappings: {
        timestamp: 'time',
        endpoint: 'path',
        latency_ms: 'duration',
        status_code: 'status',
      },
      derived_fields: {
        source_service: 'static:api-gateway',
        target_service: 'static:auth-service',
        concurrent_requests: 'ignore',
        cpu_percent: 'ignore',
        memory_percent: 'ignore',
        retry_count: 'ignore',
      },
      error_detection: { from_status_code: true, error_threshold: 400 },
    },
    highlights: ['Apache log format auto-parsed', 'Static service names injected', 'Duration (seconds) → latency_ms'],
  },
};

const CANONICAL_FIELDS = ['timestamp', 'source_service', 'target_service', 'endpoint', 'latency_ms', 'status_code', 'error_type', 'concurrent_requests', 'cpu_percent', 'memory_percent', 'retry_count'];

export default function AdapterDemo({ onClose }) {
  const [activePreset, setActivePreset] = useState('datadog');
  const [converting, setConverting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const preset = PRESETS[activePreset];

  const handleConvert = async () => {
    setConverting(true);
    setResult(null);
    setError(null);
    try {
      const res = await axios.post(`${ML_URL}/normalize`, {
        log_content: preset.sampleLog,
        adapter_config: preset.adapterConfig,
      }, { timeout: 15000 });
      setResult(res.data);
    } catch (e) {
      setError(e.response?.data?.error || 'Conversion failed. Is the ML service running?');
    } finally {
      setConverting(false);
    }
  };

  const handleTabChange = (key) => {
    setActivePreset(key);
    setResult(null);
    setError(null);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="adapter-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="adapter-header">
          <div>
            <h2>Log Format Adapter</h2>
            <p className="adapter-subtitle">
              Convert any log format into Kendra's canonical schema — no code changes needed
            </p>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div className="adapter-tabs">
          {Object.entries(PRESETS).map(([key, p]) => (
            <button
              key={key}
              className={`adapter-tab ${activePreset === key ? 'active' : ''}`}
              style={activePreset === key ? { borderBottomColor: p.color, color: p.color } : {}}
              onClick={() => handleTabChange(key)}
            >
              <span>{p.icon}</span> {p.label}
            </button>
          ))}
        </div>

        <div className="adapter-body">
          {/* Description + transformation highlights */}
          <div className="adapter-desc-row">
            <p className="adapter-desc">{preset.description}</p>
            <div className="adapter-highlights">
              <span className="highlights-label">Key mappings:</span>
              {preset.highlights.map((h, i) => (
                <span key={i} className="highlight-tag" style={{ borderColor: preset.color }}>
                  {h}
                </span>
              ))}
            </div>
          </div>

          {/* Two-panel layout */}
          <div className="adapter-panels">
            {/* Left: raw input */}
            <div className="adapter-panel">
              <div className="panel-label">
                <span className="panel-badge input">INPUT</span>
                {preset.label} format
              </div>
              <pre className="log-box">{preset.sampleLog}</pre>
            </div>

            {/* Arrow */}
            <div className="adapter-arrow">
              {converting ? (
                <div className="convert-spinner" />
              ) : (
                <button
                  className="convert-btn"
                  style={{ background: preset.color }}
                  onClick={handleConvert}
                  disabled={converting}
                >
                  Convert
                  <span className="arrow-icon">→</span>
                </button>
              )}
            </div>

            {/* Right: normalized output */}
            <div className="adapter-panel">
              <div className="panel-label">
                <span className="panel-badge output">OUTPUT</span>
                Kendra canonical schema
              </div>
              {!result && !error && (
                <div className="output-placeholder">
                  Click <strong>Convert</strong> to see normalized rows
                </div>
              )}
              {error && (
                <div className="adapter-error">{error}</div>
              )}
              {result && (
                <div className="result-box">
                  <div className="result-meta">
                    {result.total_rows} rows normalized · showing first {result.sample_rows?.length}
                  </div>
                  <div className="result-table-wrap">
                    <table className="result-table">
                      <thead>
                        <tr>
                          {CANONICAL_FIELDS.map(f => (
                            <th key={f}>{f}</th>
                          ))}
                        </tr>
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
          </div>
        </div>

        <div className="adapter-footer">
          <span className="footer-note">
            Adapter config is a JSON mapping — works with any log format without changing your pipeline
          </span>
          <button className="modal-cancel" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
