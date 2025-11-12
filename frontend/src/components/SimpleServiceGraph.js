import React from 'react';
import './SimpleServiceGraph.css';

const SimpleServiceGraph = ({ servicesConfig, systemState, onServiceSelect, selectedService }) => {
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

  if (!servicesConfig.nodes || servicesConfig.nodes.length === 0) {
    return (
      <div className="simple-service-graph">
        <div className="graph-header">
          <h3>Service Topology</h3>
        </div>
        <div className="graph-container loading">
          <div className="loading-message">
            Loading service configuration...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="simple-service-graph">
      <div className="graph-header">
        <h3>Service Topology</h3>
        <div className="legend">
          <div className="legend-item">
            <div className="legend-color healthy"></div>
            <span>Healthy</span>
          </div>
          <div className="legend-item">
            <div className="legend-color degraded"></div>
            <span>Degraded</span>
          </div>
          <div className="legend-item">
            <div className="legend-color failed"></div>
            <span>Failed</span>
          </div>
        </div>
      </div>
      <div className="graph-container">
        <div className="services-grid">
          {servicesConfig.nodes.map((node) => {
            const serviceState = systemState[node.id];
            const health = serviceState?.health || 'unknown';
            const isSelected = selectedService === node.id;
            
            return (
              <div
                key={node.id}
                className={`service-node ${isSelected ? 'selected' : ''}`}
                style={{
                  backgroundColor: getHealthColor(health),
                  borderColor: isSelected ? '#f59e0b' : getHealthColor(health)
                }}
                onClick={() => onServiceSelect(node.id)}
              >
                <div className="service-icon">
                  {getHealthIcon(health)}
                </div>
                <div className="service-name">
                  {node.name}
                </div>
                <div className="service-health">
                  {health}
                </div>
              </div>
            );
          })}
        </div>
        
        {/* Show connections */}
        <div className="connections">
          {servicesConfig.edges.map((edge) => {
            const sourceNode = servicesConfig.nodes.find(n => n.id === edge.source);
            const targetNode = servicesConfig.nodes.find(n => n.id === edge.target);
            
            if (!sourceNode || !targetNode) return null;
            
            return (
              <div key={`${edge.source}-${edge.target}`} className="connection-line">
                <div className="connection-arrow">→</div>
                <span className="connection-label">
                  {sourceNode.name} → {targetNode.name}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default SimpleServiceGraph;
