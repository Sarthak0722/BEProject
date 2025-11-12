import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import ConnectedServiceGraph from './components/ConnectedServiceGraph';
import ServicePopup from './components/ServicePopup';
import SystemStatus from './components/SystemStatus';
import './App.css';

const SIMULATOR_URL = process.env.REACT_APP_SIMULATOR_URL || 'http://localhost:4000';

function App() {
  const [socket, setSocket] = useState(null);
  const [systemState, setSystemState] = useState({});
  const [servicesConfig, setServicesConfig] = useState({ nodes: [], edges: [], behaviors: {} });
  const [selectedService, setSelectedService] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [showPopup, setShowPopup] = useState(false);

  useEffect(() => {
    // Initialize socket connection
    const newSocket = io(SIMULATOR_URL);
    setSocket(newSocket);

    // Load services configuration
    const loadConfig = async () => {
      try {
        const response = await axios.get(`${SIMULATOR_URL}/api/services`);
        setServicesConfig(response.data);
      } catch (error) {
        console.error('Failed to load services configuration:', error);
      }
    };

    loadConfig();

    // Socket event listeners
    newSocket.on('connect', () => {
      console.log('Connected to simulation engine');
      setIsConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from simulation engine');
      setIsConnected(false);
    });

    newSocket.on('health_update', (data) => {
      setSystemState(data.services);
      setLastUpdate(data.timestamp);
    });

    newSocket.on('fault_injected', (data) => {
      console.log('Fault injected:', data);
    });

    newSocket.on('system_reset', (data) => {
      console.log('System reset:', data);
    });

    newSocket.on('error', (error) => {
      console.error('Socket error:', error);
    });

    return () => {
      newSocket.close();
    };
  }, []);

  const handleFaultInjection = (serviceId, fault) => {
    if (socket && socket.connected) {
      if (fault.type === 'RESET_SERVICE') {
        socket.emit('reset_service', { serviceId });
      } else {
        socket.emit('inject_fault', { serviceId, fault });
      }
    }
  };

  const handleSystemReset = () => {
    if (socket && socket.connected) {
      socket.emit('reset_all');
    }
  };

  const handleServiceSelect = (serviceId) => {
    setSelectedService(serviceId);
    setShowPopup(true);
  };

  const handleClosePopup = () => {
    setShowPopup(false);
    setSelectedService(null);
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <h1>Kendra - Microservice Failure Propagation Simulator</h1>
          <div className="connection-status">
            <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}></div>
            <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
        </div>
      </header>

      <main className="app-main">
        <div className="main-content">
          <div className="graph-section">
            <ConnectedServiceGraph
              servicesConfig={servicesConfig}
              systemState={systemState}
              onServiceSelect={handleServiceSelect}
              selectedService={selectedService}
            />
          </div>

          <div className="status-section">
            <SystemStatus
              systemState={systemState}
              lastUpdate={lastUpdate}
              onReset={handleSystemReset}
            />
          </div>
        </div>
      </main>

      {/* Service Control Popup */}
      <ServicePopup
        serviceId={selectedService}
        serviceConfig={servicesConfig.nodes.find(n => n.id === selectedService)}
        serviceState={systemState[selectedService]}
        onFaultInjection={handleFaultInjection}
        onClose={handleClosePopup}
        isVisible={showPopup}
      />
    </div>
  );
}

export default App;
