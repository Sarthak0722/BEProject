import React, { useEffect, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import './ServiceGraph.css';

const ServiceGraph = ({ servicesConfig, systemState, onServiceSelect, selectedService }) => {
  const containerRef = useRef(null);
  const cyRef = useRef(null);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (!containerRef.current || !servicesConfig.nodes || servicesConfig.nodes.length === 0) return;

    // Initialize Cytoscape with a small delay to ensure DOM is ready
    if (!cyRef.current) {
      const initCytoscape = () => {
        try {
        cyRef.current = cytoscape({
          container: containerRef.current,
          elements: {
            nodes: servicesConfig.nodes.map(node => ({
              data: {
                id: node.id,
                label: node.name,
                service: node
              }
            })),
            edges: servicesConfig.edges.map(edge => ({
              data: {
                id: `${edge.source}-${edge.target}`,
                source: edge.source,
                target: edge.target
              }
            }))
          },
        style: [
          {
            selector: 'node',
            style: {
              'background-color': '#3b82f6',
              'label': 'data(label)',
              'text-valign': 'center',
              'text-halign': 'center',
              'color': '#ffffff',
              'font-size': '12px',
              'font-weight': 'bold',
              'text-outline-width': 2,
              'text-outline-color': '#000000',
              'width': 80,
              'height': 80,
              'shape': 'ellipse',
              'border-width': 3,
              'border-color': '#1e40af'
            }
          },
          {
            selector: 'edge',
            style: {
              'width': 3,
              'line-color': '#64748b',
              'target-arrow-color': '#64748b',
              'target-arrow-shape': 'triangle',
              'curve-style': 'bezier',
              'arrow-scale': 1.2
            }
          },
          {
            selector: 'node:selected',
            style: {
              'border-width': 5,
              'border-color': '#f59e0b',
              'background-color': '#f59e0b'
            }
          }
        ],
        layout: {
          name: 'cose',
          animate: true,
          animationDuration: 1000,
          nodeRepulsion: 4000,
          idealEdgeLength: 100,
          edgeElasticity: 0.45,
          nestingFactor: 0.1,
          gravity: 0.25,
          numIter: 1000,
          tile: true,
          tilingPaddingVertical: 10,
          tilingPaddingHorizontal: 10,
          gravityRangeCompound: 1.5,
          gravityCompound: 1.0,
          gravityRange: 3.8
        },
        userPanningEnabled: true,
        userZoomingEnabled: true,
        boxSelectionEnabled: false,
        selectionType: 'single'
      });

      // Add click handler
      cyRef.current.on('tap', 'node', (evt) => {
        const node = evt.target;
        onServiceSelect(node.id());
      });

      setIsInitialized(true);
        } catch (error) {
          console.error('Error initializing Cytoscape:', error);
          // Don't set initialized to true if there was an error
        }
      };

      // Use setTimeout to ensure DOM is fully ready
      const timeoutId = setTimeout(initCytoscape, 100);
      
      return () => {
        clearTimeout(timeoutId);
      };
    }

    return () => {
      if (cyRef.current) {
        try {
          cyRef.current.destroy();
        } catch (error) {
          console.error('Error destroying Cytoscape:', error);
        }
        cyRef.current = null;
        setIsInitialized(false);
      }
    };
  }, [servicesConfig, onServiceSelect]);

  // Update node styles based on system state
  useEffect(() => {
    if (!cyRef.current || !isInitialized || !servicesConfig.nodes) return;

    try {
      servicesConfig.nodes.forEach(node => {
        const cyNode = cyRef.current.getElementById(node.id);
        const serviceState = systemState[node.id];
        
        if (cyNode && serviceState) {
          const health = serviceState.health || 'unknown';
          
          let backgroundColor, borderColor;
          
          switch (health) {
            case 'healthy':
              backgroundColor = '#10b981';
              borderColor = '#059669';
              break;
            case 'degraded':
              backgroundColor = '#f59e0b';
              borderColor = '#d97706';
              break;
            case 'failed':
              backgroundColor = '#ef4444';
              borderColor = '#dc2626';
              break;
            default:
              backgroundColor = '#6b7280';
              borderColor = '#4b5563';
          }

          cyNode.style({
            'background-color': backgroundColor,
            'border-color': borderColor
          });

          // Add pulsing animation for failed services
          if (health === 'failed') {
            cyNode.addClass('failed-pulse');
          } else {
            cyNode.removeClass('failed-pulse');
          }
        }
      });
    } catch (error) {
      console.error('Error updating node styles:', error);
    }
  }, [systemState, servicesConfig.nodes, isInitialized]);

  // Handle selected service highlighting
  useEffect(() => {
    if (!cyRef.current || !isInitialized) return;

    // Clear previous selection
    cyRef.current.elements().removeClass('selected');
    
    if (selectedService) {
      const selectedNode = cyRef.current.getElementById(selectedService);
      if (selectedNode) {
        selectedNode.addClass('selected');
        // Center the view on the selected node
        cyRef.current.animate({
          center: { eles: selectedNode },
          zoom: 1.5
        }, {
          duration: 500
        });
      }
    }
  }, [selectedService, isInitialized]);

  if (!servicesConfig.nodes || servicesConfig.nodes.length === 0) {
    return (
      <div className="service-graph">
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
    <div className="service-graph">
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
      <div ref={containerRef} className="graph-container"></div>
    </div>
  );
};

export default ServiceGraph;
