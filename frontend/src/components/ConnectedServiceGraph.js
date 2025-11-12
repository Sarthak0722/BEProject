import React, { useRef, useEffect, useState } from 'react';
import './ConnectedServiceGraph.css';

const ConnectedServiceGraph = ({ servicesConfig, systemState, onServiceSelect, selectedService }) => {
  const svgRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

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
      case 'healthy': return '✓';
      case 'degraded': return '⚠';
      case 'failed': return '✗';
      default: return '?';
    }
  };

  // Calculate node positions in a circular layout
  const calculateNodePositions = () => {
    if (!servicesConfig.nodes || servicesConfig.nodes.length === 0) return [];
    
    const centerX = dimensions.width / 2;
    const centerY = dimensions.height / 2;
    const radius = Math.min(dimensions.width, dimensions.height) * 0.3;
    
    return servicesConfig.nodes.map((node, index) => {
      const angle = (index * 2 * Math.PI) / servicesConfig.nodes.length - Math.PI / 2;
      return {
        ...node,
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle)
      };
    });
  };

  // Calculate edge paths
  const calculateEdges = () => {
    if (!servicesConfig.edges || !servicesConfig.nodes) return [];
    
    const nodePositions = calculateNodePositions();
    
    return servicesConfig.edges.map(edge => {
      const sourceNode = nodePositions.find(n => n.id === edge.source);
      const targetNode = nodePositions.find(n => n.id === edge.target);
      
      if (!sourceNode || !targetNode) return null;
      
      return {
        id: `${edge.source}-${edge.target}`,
        source: sourceNode,
        target: targetNode,
        sourceId: edge.source,
        targetId: edge.target
      };
    }).filter(Boolean);
  };

  useEffect(() => {
    const handleResize = () => {
      if (svgRef.current) {
        const rect = svgRef.current.getBoundingClientRect();
        setDimensions({ width: rect.width, height: rect.height });
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (!servicesConfig.nodes || servicesConfig.nodes.length === 0) {
    return (
      <div className="connected-service-graph">
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

  const nodePositions = calculateNodePositions();
  const edges = calculateEdges();

  return (
    <div className="connected-service-graph">
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
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
          className="service-svg"
        >
          {/* Render edges first (behind nodes) */}
          {edges.map(edge => {
            const sourceHealth = systemState[edge.sourceId]?.health || 'unknown';
            const targetHealth = systemState[edge.targetId]?.health || 'unknown';
            const edgeColor = sourceHealth === 'failed' || targetHealth === 'failed' ? '#ef4444' : '#64748b';
            
            return (
              <g key={edge.id}>
                <line
                  x1={edge.source.x}
                  y1={edge.source.y}
                  x2={edge.target.x}
                  y2={edge.target.y}
                  stroke={edgeColor}
                  strokeWidth="2"
                  markerEnd="url(#arrowhead)"
                />
              </g>
            );
          })}
          
          {/* Arrow marker definition */}
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon
                points="0 0, 10 3.5, 0 7"
                fill="#64748b"
              />
            </marker>
          </defs>
          
          {/* Render nodes */}
          {nodePositions.map(node => {
            const serviceState = systemState[node.id];
            const health = serviceState?.health || 'unknown';
            const isSelected = selectedService === node.id;
            const healthColor = getHealthColor(health);
            const isFailed = health === 'failed';
            
            return (
              <g key={node.id}>
                {/* Node circle */}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r="40"
                  fill={healthColor}
                  stroke={isSelected ? '#f59e0b' : healthColor}
                  strokeWidth={isSelected ? '4' : '2'}
                  className={`service-node ${isFailed ? 'failed-pulse' : ''}`}
                  onClick={() => onServiceSelect(node.id)}
                  style={{ cursor: 'pointer' }}
                />
                
                {/* Node icon */}
                <text
                  x={node.x}
                  y={node.y - 5}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="white"
                  fontSize="20"
                  fontWeight="bold"
                  pointerEvents="none"
                >
                  {getHealthIcon(health)}
                </text>
                
                {/* Node label */}
                <text
                  x={node.x}
                  y={node.y + 25}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="white"
                  fontSize="12"
                  fontWeight="500"
                  pointerEvents="none"
                >
                  {node.name}
                </text>
                
                {/* Health status */}
                <text
                  x={node.x}
                  y={node.y + 40}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="white"
                  fontSize="10"
                  fontWeight="400"
                  pointerEvents="none"
                >
                  {health.toUpperCase()}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

export default ConnectedServiceGraph;
