import React, { useState, useRef, useCallback } from 'react';
import axios from 'axios';
import './AnalyzeModal.css';

const ML_URL = process.env.REACT_APP_ML_URL || 'http://localhost:5001';
const SIMULATOR_URL = process.env.REACT_APP_SIMULATOR_URL || 'http://localhost:4001';

const REQUIRED_COLUMNS = ['timestamp', 'source_service', 'target_service', 'latency_ms', 'status_code'];
const OPTIONAL_COLUMNS = ['endpoint', 'error_type', 'concurrent_requests', 'cpu_percent', 'memory_percent', 'retry_count'];

const SAMPLE_CSV = `timestamp,source_service,target_service,endpoint,latency_ms,status_code,error_type,concurrent_requests,cpu_percent,memory_percent,retry_count
2024-11-01T05:00:00Z,api-gateway,auth-service,/validate,45,200,,120,23.5,41.2,0
2024-11-01T05:00:01Z,api-gateway,user-service,/users,52,200,,122,24.1,41.5,0
2024-11-01T06:30:00Z,order-service,database-service,/query,78,200,,350,31.2,45.8,0
2024-11-01T09:15:00Z,api-gateway,order-service,/orders,320,200,,900,55.3,58.2,0
2024-11-01T10:30:00Z,api-gateway,database-service,/query,1200,503,TIMEOUT,1500,91.2,79.3,2
2024-11-01T10:31:00Z,order-service,database-service,/query,1450,503,TIMEOUT,1520,92.8,80.1,3`;

const AnalyzeModal = ({ onClose, onSuccess }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileInfo, setFileInfo] = useState(null);
  const [clientErrors, setClientErrors] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const [serverError, setServerError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef(null);

  // ── Client-side validation ────────────────────────────────────────────────
  const validateAndLoadFile = (file) => {
    setResult(null);
    setServerError(null);
    const errors = [];

    if (!file.name.toLowerCase().endsWith('.csv')) {
      errors.push('File must have a .csv extension.');
      setClientErrors(errors);
      setSelectedFile(null);
      setFileInfo(null);
      return;
    }
    if (file.size === 0) {
      errors.push('File is empty.');
      setClientErrors(errors);
      setSelectedFile(null);
      setFileInfo(null);
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      errors.push('File is too large (max 50 MB).');
      setClientErrors(errors);
      setSelectedFile(null);
      setFileInfo(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) {
        setClientErrors(['File has no data rows (only a header or completely empty).']);
        setSelectedFile(null);
        setFileInfo(null);
        return;
      }

      const headerLine = lines[0];
      const headers = headerLine.split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

      const missing = REQUIRED_COLUMNS.filter(r => !headers.includes(r));
      if (missing.length) {
        setClientErrors([
          `Missing required columns: ${missing.map(m => `"${m}"`).join(', ')}`,
          `Your columns: ${headers.join(', ')}`,
        ]);
        setSelectedFile(null);
        setFileInfo(null);
        return;
      }

      const dataRows = lines.length - 1;
      if (dataRows < 10) {
        errors.push(`Too few rows (${dataRows}). At least 10 rows are needed; 1,000+ recommended for good ML quality.`);
      }

      // Quick sample check on latency_ms and status_code (first 20 rows)
      const latIdx = headers.indexOf('latency_ms');
      const scIdx = headers.indexOf('status_code');
      const sample = lines.slice(1, 21);
      let badLatency = 0, badStatus = 0;
      sample.forEach(line => {
        const cols = line.split(',');
        const lat = parseFloat(cols[latIdx]);
        const sc = parseInt(cols[scIdx]);
        if (isNaN(lat) || lat < 0) badLatency++;
        if (isNaN(sc) || sc < 100 || sc > 999) badStatus++;
      });
      if (badLatency > sample.length * 0.5) {
        errors.push(`"latency_ms" column: ${badLatency}/${sample.length} sampled rows have non-numeric or negative values.`);
      }
      if (badStatus > sample.length * 0.5) {
        errors.push(`"status_code" column: ${badStatus}/${sample.length} sampled rows are not valid HTTP codes (100–999).`);
      }

      const optionalFound = OPTIONAL_COLUMNS.filter(c => headers.includes(c));
      setClientErrors(errors);
      setSelectedFile(errors.length === 0 ? file : null);
      setFileInfo({
        name: file.name,
        size: (file.size / 1024).toFixed(1) + ' KB',
        rowCount: dataRows,
        optionalFound,
        raw: file,
      });
    };
    reader.readAsText(file);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) validateAndLoadFile(file);
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) validateAndLoadFile(file);
  }, []);

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);

  // ── Upload & train ────────────────────────────────────────────────────────
  const handleTrain = async () => {
    if (!fileInfo?.raw || clientErrors.length > 0) return;
    setAnalyzing(true);
    setServerError(null);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', fileInfo.raw);
      const res = await axios.post(`${ML_URL}/upload-logs`, formData, {
        timeout: 120000,
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(res.data);
      if (onSuccess) onSuccess(res.data);
      // Refresh services config
      try {
        await axios.get(`${SIMULATOR_URL}/api/services`);
      } catch (_) {}
    } catch (e) {
      const d = e.response?.data;
      setServerError({ message: d?.error || 'Upload failed.', details: d?.details || [] });
    } finally {
      setAnalyzing(false);
    }
  };

  // ── Download sample CSV ───────────────────────────────────────────────────
  const downloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kendra_sample_logs.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const copySample = () => {
    navigator.clipboard.writeText(SAMPLE_CSV).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const canTrain = fileInfo && clientErrors.length === 0 && !result;

  return (
    <div className="modal-overlay" onClick={() => !analyzing && onClose()}>
      <div className="analyze-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="modal-header">
          <div>
            <h2>Analyze Logs</h2>
            <p className="modal-subtitle">Upload your service logs to train ML models for predictions and risk scoring</p>
          </div>
          <button className="modal-close" onClick={() => !analyzing && onClose()}>✕</button>
        </div>

        <div className="modal-body">

          {/* ── Schema section ── */}
          <div className="schema-section">
            <div className="schema-header">
              <div className="schema-title">Required CSV Format</div>
              <div className="schema-actions">
                <button className="schema-btn" onClick={copySample}>{copied ? '✓ Copied' : '📋 Copy'}</button>
                <button className="schema-btn primary" onClick={downloadSample}>⬇ Download sample.csv</button>
              </div>
            </div>

            <div className="schema-cols">
              <div className="schema-group">
                <div className="schema-group-label required">Required columns</div>
                {REQUIRED_COLUMNS.map(c => (
                  <div key={c} className="schema-col required">
                    <span className="col-name">{c}</span>
                    <span className="col-hint">{
                      c === 'timestamp' ? 'ISO 8601 — 2024-11-01T05:00:00Z' :
                      c === 'source_service' ? 'Service making the call — api-gateway' :
                      c === 'target_service' ? 'Service being called — auth-service' :
                      c === 'latency_ms' ? 'Response time in ms — 45' :
                      'HTTP status code — 200 / 503'
                    }</span>
                  </div>
                ))}
              </div>
              <div className="schema-group">
                <div className="schema-group-label optional">Optional columns</div>
                {OPTIONAL_COLUMNS.map(c => (
                  <div key={c} className="schema-col optional">
                    <span className="col-name">{c}</span>
                  </div>
                ))}
              </div>
            </div>

            <pre className="sample-preview">{SAMPLE_CSV}</pre>
          </div>

          {/* ── Upload zone ── */}
          {!result && (
            <div
              className={`upload-dropzone ${isDragging ? 'dragging' : ''} ${fileInfo && clientErrors.length === 0 ? 'file-ok' : ''} ${clientErrors.length > 0 ? 'file-error' : ''}`}
              onClick={() => !fileInfo && fileInputRef.current.click()}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <input
                type="file"
                accept=".csv"
                ref={fileInputRef}
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              {!fileInfo ? (
                <>
                  <div className="dropzone-icon">📁</div>
                  <div className="dropzone-label">Drop your CSV file here or <span className="dropzone-link">click to browse</span></div>
                  <div className="dropzone-hint">Max 50 MB · .csv only</div>
                </>
              ) : (
                <div className="file-info-row">
                  <div className={`file-status-icon ${clientErrors.length === 0 ? 'ok' : 'err'}`}>
                    {clientErrors.length === 0 ? '✓' : '✕'}
                  </div>
                  <div className="file-details">
                    <div className="file-name">{fileInfo.name}</div>
                    <div className="file-meta">
                      {fileInfo.rowCount.toLocaleString()} rows · {fileInfo.size}
                      {fileInfo.optionalFound?.length > 0 && ` · optional: ${fileInfo.optionalFound.join(', ')}`}
                    </div>
                  </div>
                  <button className="file-change-btn" onClick={e => { e.stopPropagation(); setFileInfo(null); setSelectedFile(null); setClientErrors([]); fileInputRef.current.click(); }}>
                    Change file
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Client validation errors ── */}
          {clientErrors.length > 0 && (
            <div className="validation-errors">
              <div className="ve-title">⚠ Validation failed — fix these before uploading:</div>
              {clientErrors.map((e, i) => (
                <div key={i} className="ve-item">✕ {e}</div>
              ))}
            </div>
          )}

          {/* ── Server errors ── */}
          {serverError && (
            <div className="validation-errors">
              <div className="ve-title">✕ {serverError.message}</div>
              {serverError.details.map((d, i) => (
                <div key={i} className="ve-item">{d}</div>
              ))}
            </div>
          )}

          {/* ── Success ── */}
          {result && (
            <div className="analyze-success">
              <div className="success-icon">✓</div>
              <div>
                <strong>Models trained successfully</strong>
                <p>
                  {result.rows_analyzed?.toLocaleString()} rows &nbsp;·&nbsp;
                  {result.services_discovered} services &nbsp;·&nbsp;
                  {result.edges_discovered} edges discovered
                </p>
                {result.warnings?.map((w, i) => (
                  <p key={i} className="success-warning">⚠ {w}</p>
                ))}
              </div>
            </div>
          )}

          {/* ── Analyzing spinner ── */}
          {analyzing && (
            <div className="analyzing-row">
              <div className="analyzing-spinner" />
              <span>Training 4 ML models on your data — this may take up to 30 seconds…</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="modal-cancel" onClick={() => !analyzing && onClose()} disabled={analyzing}>
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button className="modal-analyze" onClick={handleTrain} disabled={!canTrain || analyzing}>
              {analyzing ? 'Training…' : '▶ Train on this file'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AnalyzeModal;
