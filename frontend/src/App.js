import React, { useState, useEffect, useCallback, useRef } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import ConnectedServiceGraph from './components/ConnectedServiceGraph';
import ServicePopup from './components/ServicePopup';
import SystemStatus from './components/SystemStatus';
import LoadSimulator from './components/LoadSimulator';
import InsightsPanel from './components/InsightsPanel';
import TourGuide from './components/TourGuide';
import './App.css';

const SIMULATOR_URL = process.env.REACT_APP_SIMULATOR_URL || 'http://localhost:4001';
const ML_URL = process.env.REACT_APP_ML_URL || 'http://localhost:5001';

export default function App() {
  const [socket, setSocket] = useState(null);
  const [systemState, setSystemState] = useState({});
  const [servicesConfig, setServicesConfig] = useState({ nodes: [], edges: [], behaviors: {} });
  const [selectedService, setSelectedService] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [showPopup, setShowPopup] = useState(false);

  // Mode: 'monitoring' | 'simulation'
  const [mode, setMode] = useState('monitoring');
  const [switchingMode, setSwitchingMode] = useState(false);

  // Tracks what faults are currently injected per service — persists across popup opens
  const [serviceFaults, setServiceFaults] = useState({});

  // Activity loader — shows a thin bar when fault injection is in flight
  const [isInjecting, setIsInjecting] = useState(false);
  const injectTimerRef = useRef(null);

  // Tour guide
  const [showTour, setShowTour] = useState(() => !localStorage.getItem('kendra_tour_done'));

  // ML state
  const [isMLReady, setIsMLReady] = useState(false);
  const [loadPredictions, setLoadPredictions] = useState(null);
  const [showAnalyzeModal, setShowAnalyzeModal] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState(null);
  const [analyzeError, setAnalyzeError] = useState(null);

  const socketRef = useRef(null);

  // Check ML service on load
  useEffect(() => {
    const checkML = async () => {
      try {
        const res = await axios.get(`${ML_URL}/health`, { timeout: 5000 });
        setIsMLReady(res.data.trained === true);
      } catch { setIsMLReady(false); }
    };
    checkML();
    const iv = setInterval(checkML, 15000);
    return () => clearInterval(iv);
  }, []);

  // Socket setup
  useEffect(() => {
    const newSocket = io(SIMULATOR_URL);
    socketRef.current = newSocket;
    setSocket(newSocket);

    axios.get(`${SIMULATOR_URL}/api/services`).then(r => setServicesConfig(r.data)).catch(() => {});

    newSocket.on('connect', () => setIsConnected(true));
    newSocket.on('disconnect', () => setIsConnected(false));
    newSocket.on('health_update', (data) => {
      setSystemState(data.services);
      setLastUpdate(data.timestamp);
    });

    return () => newSocket.close();
  }, []);

  // Mode switch handler
  const handleModeSwitch = async (newMode) => {
    if (newMode === mode) return;
    if (newMode === 'monitoring' && mode === 'simulation') {
      // Reset all services when leaving simulation
      setSwitchingMode(true);
      setShowPopup(false);
      setLoadPredictions(null);
      if (socketRef.current?.connected) {
        socketRef.current.emit('reset_all');
      }
      setServiceFaults({});
      setTimeout(() => setSwitchingMode(false), 1200);
    }
    setMode(newMode);
  };

  // Fault injection — also updates local tracking state
  const handleFaultInjection = (serviceId, fault) => {
    // Trigger the mini activity bar
    setIsInjecting(true);
    clearTimeout(injectTimerRef.current);
    injectTimerRef.current = setTimeout(() => setIsInjecting(false), 900);
    setServiceFaults(prev => {
      const current = prev[serviceId] || {};
      let updated = { ...current };
      if (fault.type === 'RESET_SERVICE') {
        updated = {};
      } else if (fault.type === 'FAILURE') {
        updated.isFailed = fault.isFailed;
      } else if (fault.type === 'LATENCY') {
        updated.latency = fault.delay;
      } else if (fault.type === 'ERROR_RATE') {
        updated.errorRate = Math.round(fault.rate * 100);
      }
      return { ...prev, [serviceId]: updated };
    });

    if (socketRef.current?.connected) {
      if (fault.type === 'RESET_SERVICE') {
        socketRef.current.emit('reset_service', { serviceId });
      } else {
        socketRef.current.emit('inject_fault', { serviceId, fault });
      }
    }
  };

  const handleSystemReset = () => {
    if (socketRef.current?.connected) socketRef.current.emit('reset_all');
    setServiceFaults({});
    setLoadPredictions(null);
  };

  const handleServiceSelect = (serviceId) => {
    if (mode === 'simulation') {
      setSelectedService(serviceId);
      setShowPopup(true);
    }
  };

  const handleClosePopup = () => {
    setShowPopup(false);
    setSelectedService(null);
  };

  const handleAnalyzeLogs = async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    setAnalyzeResult(null);
    try {
      const res = await axios.post(`${ML_URL}/analyze`, {}, { timeout: 60000 });
      setAnalyzeResult(res.data);
      setIsMLReady(true);
      const cfgRes = await axios.get(`${SIMULATOR_URL}/api/services`);
      setServicesConfig(cfgRes.data);
    } catch (e) {
      setAnalyzeError(e.response?.data?.error || 'Analysis failed. Check ML service.');
    } finally {
      setAnalyzing(false);
    }
  };

  // Active faults count for badge
  const activeFaultCount = Object.values(serviceFaults).filter(
    f => f.isFailed || f.latency > 0 || f.errorRate > 0
  ).length;

  // Graph state: show load predictions overlay in simulation mode when slider is active
  const displayState = useCallback(() => {
    if (mode !== 'simulation' || !loadPredictions) return systemState;
    const merged = { ...systemState };
    Object.keys(merged).forEach(id => {
      if (loadPredictions[id]) {
        merged[id] = { ...merged[id], health: loadPredictions[id].health, predicted: true };
      }
    });
    return merged;
  }, [systemState, loadPredictions, mode]);

  return (
    <div className={`app mode-${mode}`}>
      {/* Mini activity bar — appears during fault injection */}
      {isInjecting && <div className="inject-loader" />}

      {/* Tour guide */}
      {showTour && (
        <TourGuide onDone={() => {
          setShowTour(false);
          localStorage.setItem('kendra_tour_done', '1');
        }} />
      )}

      {/* Header */}
      <header className="app-header">
        <div className="header-inner">
          <div className="header-brand">
            <span className="brand-name">Kendra</span>
            <span className="brand-sub">Microservice Failure Propagation Simulator</span>
          </div>

          {/* Mode Toggle — the hero UI element */}
          <div className="mode-toggle">
            <button
              className={`mode-btn ${mode === 'monitoring' ? 'active' : ''}`}
              onClick={() => handleModeSwitch('monitoring')}
            >
              <span className="mode-icon">◉</span>
              Monitoring
            </button>
            <button
              className={`mode-btn simulation-btn ${mode === 'simulation' ? 'active' : ''}`}
              onClick={() => handleModeSwitch('simulation')}
            >
              <span className="mode-icon">⚡</span>
              Simulation
              {activeFaultCount > 0 && (
                <span className="fault-badge">{activeFaultCount}</span>
              )}
            </button>
          </div>

          <div className="header-right">
            <div className="connection-pills">
              <div className={`pill ${isConnected ? 'pill-green' : 'pill-red'}`}>
                <span className="pill-dot" />
                {isConnected ? 'Engine' : 'Disconnected'}
              </div>
              <div className={`pill ${isMLReady ? 'pill-blue' : 'pill-amber'}`}>
                <span className="pill-dot" />
                {isMLReady ? 'ML Ready' : 'ML Pending'}
              </div>
            </div>
            <button className="tour-btn" onClick={() => setShowTour(true)} title="Take the product tour">
              Take A Tour
            </button>
            <button className="analyze-btn" onClick={() => setShowAnalyzeModal(true)} disabled={analyzing}>
              {analyzing ? '⟳ Analyzing...' : '⬆ Analyze Logs'}
            </button>
          </div>
        </div>
      </header>

      {/* Mode banner */}
      {mode === 'simulation' && (
        <div className="simulation-banner">
          <span className="sim-banner-icon">⚡</span>
          <strong>Simulation Mode</strong> — Click any service node to inject faults. All changes are simulated. Nothing breaks for real.
          {activeFaultCount > 0 && (
            <span className="sim-fault-count">{activeFaultCount} active fault{activeFaultCount > 1 ? 's' : ''}</span>
          )}
        </div>
      )}

      {switchingMode && (
        <div className="mode-switching-overlay">
          <div className="switching-msg">
            <div className="switching-spinner" />
            Resetting all services...
          </div>
        </div>
      )}

      {/* Main */}
      <main className="app-main">
        <div className="main-layout">
          {/* Left sidebar */}
          <aside className="left-sidebar">
            {mode === 'monitoring' ? (
              <InsightsPanel isMLReady={isMLReady} />
            ) : (
              <>
                <LoadSimulator onPredictionsChange={setLoadPredictions} isMLReady={isMLReady} />
                <div className="simulation-hint-card">
                  <div className="hint-title">How to Simulate</div>
                  <ol className="hint-steps">
                    <li>Drag the slider above to predict load behavior</li>
                    <li>Click any service node on the graph</li>
                    <li>Toggle failure, inject latency, or set error rate</li>
                    <li>Watch the cascade propagate in real time</li>
                    <li>Return to Monitoring to auto-reset everything</li>
                  </ol>
                </div>
              </>
            )}
          </aside>

          {/* Graph */}
          <section className="graph-section">
            {loadPredictions && mode === 'simulation' && (
              <div className="prediction-banner">
                ⚠ Showing <strong>predicted</strong> state — drag slider to 0 to restore live view
              </div>
            )}
            {mode === 'monitoring' && (
              <div className="graph-mode-label">Live Service Topology</div>
            )}
            {mode === 'simulation' && !loadPredictions && (
              <div className="graph-mode-label sim">Click a node to inject a fault</div>
            )}
            <ConnectedServiceGraph
              servicesConfig={servicesConfig}
              systemState={displayState()}
              onServiceSelect={handleServiceSelect}
              selectedService={selectedService}
              isPredicted={!!loadPredictions}
              isSimulationMode={mode === 'simulation'}
              serviceFaults={serviceFaults}
            />
          </section>

          {/* Right sidebar */}
          <aside className="right-sidebar">
            <SystemStatus
              systemState={systemState}
              lastUpdate={lastUpdate}
              onReset={handleSystemReset}
              serviceFaults={serviceFaults}
              mode={mode}
            />
          </aside>
        </div>
      </main>

      {/* Service Popup — only in simulation mode */}
      {mode === 'simulation' && (
        <ServicePopup
          serviceId={selectedService}
          serviceConfig={servicesConfig.nodes.find(n => n.id === selectedService)}
          serviceState={systemState[selectedService]}
          currentFaults={serviceFaults[selectedService] || {}}
          onFaultInjection={handleFaultInjection}
          onClose={handleClosePopup}
          isVisible={showPopup}
          isMLReady={isMLReady}
        />
      )}

      {/* Analyze Modal */}
      {showAnalyzeModal && (
        <div className="modal-overlay" onClick={() => !analyzing && setShowAnalyzeModal(false)}>
          <div className="analyze-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Log Analysis</h2>
              <button className="modal-close" onClick={() => !analyzing && setShowAnalyzeModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="modal-desc">
                Analyzes 194,000+ synthetic BBD Flipkart log rows to train 4 ML models and auto-generate a data-driven service rulebook.
              </p>
              <div className="adapter-note">
                <div className="adapter-note-title">Adapter Config — how to plug in your own logs</div>
                <pre className="adapter-config-display">{JSON.stringify({
                  input_format: "csv",
                  field_mappings: {
                    timestamp: "your_timestamp_field",
                    source_service: "your_caller_field",
                    target_service: "your_callee_field",
                    latency_ms: "your_duration_field",
                    status_code: "your_http_status_field",
                    concurrent_requests: "your_active_connections_field"
                  }
                }, null, 2)}</pre>
                <p className="adapter-hint">Change only the values — map your field names to ours. Supports CSV, JSON, Nginx/Apache formats.</p>
              </div>
              {analyzeResult && (
                <div className="analyze-success">
                  <div className="success-icon">✓</div>
                  <div>
                    <strong>Analysis complete</strong>
                    <p>{analyzeResult.rows_analyzed?.toLocaleString()} rows · {analyzeResult.services_discovered} services · {analyzeResult.edges_discovered} edges discovered</p>
                  </div>
                </div>
              )}
              {analyzeError && <div className="analyze-error">{analyzeError}</div>}
            </div>
            <div className="modal-footer">
              <button className="modal-cancel" onClick={() => !analyzing && setShowAnalyzeModal(false)} disabled={analyzing}>
                {analyzeResult ? 'Close' : 'Cancel'}
              </button>
              <button className="modal-analyze" onClick={handleAnalyzeLogs} disabled={analyzing}>
                {analyzing ? 'Training Models...' : 'Run Analysis'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
