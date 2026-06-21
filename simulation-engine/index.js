const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Load behavioral rulebook
let servicesConfig;
try {
  const configPath = path.join(__dirname, 'services.json');
  servicesConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log('✅ Loaded behavioral rulebook');
} catch (error) {
  console.error('❌ Failed to load services.json:', error.message);
  process.exit(1);
}

// System state tracking
let systemState = {};
let injectedFaults = {};

// Initialize system state
function initializeSystemState() {
  servicesConfig.nodes.forEach(node => {
    systemState[node.id] = {
      id: node.id,
      name: node.name,
      url: node.url,
      health: 'healthy',
      lastUpdated: new Date().toISOString(),
      dependencies: []
    };
    injectedFaults[node.id] = {};
  });
}

// Health check function
async function checkServiceHealth(serviceId) {
  try {
    const service = systemState[serviceId];
    const response = await axios.get(`${service.url}/health`, { timeout: 5000 });
    return response.data;
  } catch (error) {
    return { health: 'failed', error: error.message };
  }
}

// Inject fault into a service
async function injectFault(serviceId, fault) {
  try {
    const service = systemState[serviceId];
    const response = await axios.post(`${service.url}/inject-fault`, fault, { timeout: 10000 });
    
    // Store the injected fault
    injectedFaults[serviceId] = { ...injectedFaults[serviceId], ...fault };
    
    console.log(`🔧 Injected fault into ${serviceId}:`, fault);
    return response.data;
  } catch (error) {
    console.error(`❌ Failed to inject fault into ${serviceId}:`, error.message);
    throw error;
  }
}

// Reset a service
async function resetService(serviceId) {
  try {
    const service = systemState[serviceId];
    await axios.post(`${service.url}/reset`, {}, { timeout: 10000 });
    
    // Clear injected faults
    injectedFaults[serviceId] = {};
    
    console.log(`🔄 Reset service: ${serviceId}`);
  } catch (error) {
    console.error(`❌ Failed to reset ${serviceId}:`, error.message);
  }
}

// Calculate propagation effects based on behavioral rules
async function calculatePropagation(affectedServiceId, faultType, faultValue) {
  const behaviors = servicesConfig.behaviors;
  const affectedService = behaviors[affectedServiceId];
  
  if (!affectedService || !affectedService.dependencies) {
    return;
  }

  // Find services that depend on the affected service
  const dependentServices = servicesConfig.nodes.filter(node => {
    const serviceBehaviors = behaviors[node.id];
    return serviceBehaviors && 
           serviceBehaviors.dependencies && 
           serviceBehaviors.dependencies[affectedServiceId];
  });

  for (const dependentService of dependentServices) {
    const dependency = behaviors[dependentService.id].dependencies[affectedServiceId];
    
    let shouldPropagate = false;
    let propagationFault = null;

    if (faultType === 'FAILURE' && dependency.onFailure) {
      shouldPropagate = true;
      propagationFault = {
        type: 'FAILURE',
        isFailed: true,
        reason: dependency.onFailure.reason
      };
    } else if (faultType === 'LATENCY' && dependency.onLatency) {
      const threshold = dependency.onLatency.threshold_ms;
      if (faultValue >= threshold) {
        shouldPropagate = true;
        propagationFault = {
          type: 'DEGRADED',
          isDegraded: true,
          reason: dependency.onLatency.reason
        };
      }
    } else if (faultType === 'RESET' || faultType === 'RECOVERY') {
      // Handle recovery - reset dependent services if they were affected by this service
      shouldPropagate = true;
      propagationFault = {
        type: 'RESET',
        reason: `Parent service ${affectedServiceId} recovered`
      };
    }

    if (shouldPropagate && propagationFault) {
      const propagationDelay =
        dependency.onFailure?.propagationDelay ||
        dependency.onLatency?.propagationDelay ||
        0;

      if (propagationDelay > 0) {
        console.log(`⏱️  Waiting ${propagationDelay}ms before propagating to ${dependentService.id}`);
        await new Promise(resolve => setTimeout(resolve, propagationDelay));
      }

      console.log(`🌊 Propagating ${faultType} from ${affectedServiceId} to ${dependentService.id}`);
      await injectFault(dependentService.id, propagationFault);

      // Recursively calculate further propagation
      await calculatePropagation(dependentService.id, propagationFault.type, faultValue);
    }
  }
}

// Poll all services for health updates
async function pollSystemHealth() {
  const healthPromises = servicesConfig.nodes.map(async (node) => {
    const health = await checkServiceHealth(node.id);
    return { serviceId: node.id, health };
  });

  const healthResults = await Promise.all(healthPromises);
  
  // Update system state
  healthResults.forEach(({ serviceId, health }) => {
    if (systemState[serviceId]) {
      systemState[serviceId].health = health.health || 'unknown';
      systemState[serviceId].lastUpdated = new Date().toISOString();
      systemState[serviceId].details = health;
    }
  });

  // Broadcast updated state to all connected clients
  io.emit('health_update', {
    timestamp: new Date().toISOString(),
    services: systemState
  });
}

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);
  
  // Send initial system state
  socket.emit('health_update', {
    timestamp: new Date().toISOString(),
    services: systemState
  });

  // Handle fault injection
  socket.on('inject_fault', async (data) => {
    try {
      const { serviceId, fault } = data;
      console.log(`🎯 Injecting fault into ${serviceId}:`, fault);
      
      await injectFault(serviceId, fault);
      
      // Calculate and apply propagation
      const faultValue = fault.delay || (fault.isFailed ? 1 : 0);
      await calculatePropagation(serviceId, fault.type, faultValue);
      
      // Update health after fault injection
      setTimeout(pollSystemHealth, 1000);
      
      socket.emit('fault_injected', { serviceId, fault });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // Handle system reset
  socket.on('reset_all', async () => {
    try {
      console.log('🔄 Resetting all services...');
      
      const resetPromises = servicesConfig.nodes.map(node => resetService(node.id));
      await Promise.all(resetPromises);
      
      // Clear all injected faults
      Object.keys(injectedFaults).forEach(serviceId => {
        injectedFaults[serviceId] = {};
      });
      
      // Update health after reset
      setTimeout(pollSystemHealth, 2000);
      
      socket.emit('system_reset', { message: 'All services reset successfully' });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // Handle individual service reset with recovery propagation
  socket.on('reset_service', async (data) => {
    try {
      const { serviceId } = data;
      console.log(`🔄 Resetting service: ${serviceId}`);
      
      await resetService(serviceId);
      
      // Clear injected faults for this service
      injectedFaults[serviceId] = {};
      
      // Propagate recovery to dependent services
      await calculatePropagation(serviceId, 'RESET', 0);
      
      // Update health after reset
      setTimeout(pollSystemHealth, 1000);
      
      socket.emit('service_reset', { serviceId, message: 'Service reset successfully' });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
  });
});

// REST API endpoints
app.get('/api/services', (req, res) => {
  res.json({
    nodes: servicesConfig.nodes,
    edges: servicesConfig.edges,
    behaviors: servicesConfig.behaviors
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    services: systemState
  });
});

app.post('/api/inject-fault', async (req, res) => {
  try {
    const { serviceId, fault } = req.body;
    await injectFault(serviceId, fault);
    
    const faultValue = fault.delay || (fault.isFailed ? 1 : 0);
    await calculatePropagation(serviceId, fault.type, faultValue);
    
    setTimeout(pollSystemHealth, 1000);
    
    res.json({ success: true, message: 'Fault injected successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/reset-all', async (req, res) => {
  try {
    const resetPromises = servicesConfig.nodes.map(node => resetService(node.id));
    await Promise.all(resetPromises);
    
    Object.keys(injectedFaults).forEach(serviceId => {
      injectedFaults[serviceId] = {};
    });
    
    setTimeout(pollSystemHealth, 2000);
    
    res.json({ success: true, message: 'All services reset successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Start health polling — interval driven by config
const healthCheckInterval = servicesConfig.monitoring?.healthCheckInterval || 5000;
setInterval(pollSystemHealth, healthCheckInterval);

// Initialize and start server
initializeSystemState();
const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log(`🚀 Kendra Simulation Engine running on port ${PORT}`);
  console.log(`📊 Monitoring ${servicesConfig.nodes.length} microservices`);
  
  // Initial health check
  setTimeout(pollSystemHealth, 2000);
});
