const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DATABASE_SERVICE_URL = process.env.DATABASE_SERVICE_URL || 'http://localhost:8006';

// Service state
let serviceState = {
  health: 'healthy',
  isFailed: false,
  isDegraded: false,
  injectedLatency: 0,
  errorRate: 0,
  lastFault: null,
  dependencyHealth: {
    database: 'healthy'
  }
};

// Helper function to simulate latency
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to simulate errors
const shouldFail = () => Math.random() < serviceState.errorRate;

// Check dependency health
async function checkDependencyHealth() {
  try {
    const response = await axios.get(`${DATABASE_SERVICE_URL}/health`, { timeout: 5000 });
    serviceState.dependencyHealth.database = response.data.health;
    
    // Update own health based on dependencies
    if (response.data.health === 'failed') {
      serviceState.health = 'failed';
      serviceState.isFailed = true;
    } else if (response.data.health === 'degraded') {
      serviceState.health = 'degraded';
      serviceState.isDegraded = true;
    } else if (!serviceState.isFailed && !serviceState.isDegraded) {
      serviceState.health = 'healthy';
    }
  } catch (error) {
    serviceState.dependencyHealth.database = 'failed';
    serviceState.health = 'failed';
    serviceState.isFailed = true;
  }
}

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await checkDependencyHealth();
    
    if (serviceState.isFailed) {
      return res.status(500).json({
        health: 'failed',
        service: 'user-service',
        timestamp: new Date().toISOString(),
        reason: serviceState.lastFault?.reason || 'Service is in failed state',
        dependencies: serviceState.dependencyHealth
      });
    }

    if (serviceState.isDegraded) {
      return res.json({
        health: 'degraded',
        service: 'user-service',
        timestamp: new Date().toISOString(),
        reason: serviceState.lastFault?.reason || 'Service is in degraded state',
        dependencies: serviceState.dependencyHealth
      });
    }

    res.json({
      health: 'healthy',
      service: 'user-service',
      timestamp: new Date().toISOString(),
      dependencies: serviceState.dependencyHealth
    });
  } catch (error) {
    res.status(500).json({
      health: 'failed',
      service: 'user-service',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Fault injection endpoint
app.post('/inject-fault', async (req, res) => {
  const { type, isFailed, isDegraded, delay: latency, rate, reason } = req.body;
  
  console.log(`🔧 User service received fault injection:`, req.body);
  
  switch (type) {
    case 'FAILURE':
      serviceState.isFailed = isFailed || false;
      serviceState.health = isFailed ? 'failed' : 'healthy';
      serviceState.lastFault = { type, reason };
      break;
      
    case 'DEGRADED':
      serviceState.isDegraded = isDegraded || false;
      serviceState.health = isDegraded ? 'degraded' : 'healthy';
      serviceState.lastFault = { type, reason };
      break;
      
    case 'LATENCY':
      serviceState.injectedLatency = latency || 0;
      serviceState.lastFault = { type, delay: latency };
      break;
      
    case 'ERROR_RATE':
      serviceState.errorRate = rate || 0;
      serviceState.lastFault = { type, rate };
      break;
  }
  
  res.json({
    success: true,
    message: 'Fault injected successfully',
    currentState: serviceState
  });
});

// Reset endpoint
app.post('/reset', async (req, res) => {
  console.log('🔄 Resetting user service...');
  
  serviceState = {
    health: 'healthy',
    isFailed: false,
    isDegraded: false,
    injectedLatency: 0,
    errorRate: 0,
    lastFault: null,
    dependencyHealth: {
      database: 'healthy'
    }
  };
  
  res.json({
    success: true,
    message: 'User service reset successfully',
    state: serviceState
  });
});

// User endpoints
app.get('/users', async (req, res) => {
  try {
    if (serviceState.injectedLatency > 0) {
      await delay(serviceState.injectedLatency);
    }
    
    if (shouldFail()) {
      return res.status(500).json({ error: 'Simulated user service error' });
    }
    
    if (serviceState.isFailed) {
      return res.status(500).json({ error: 'User service is failed' });
    }
    
    const response = await axios.get(`${DATABASE_SERVICE_URL}/users`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/users/:id', async (req, res) => {
  try {
    if (serviceState.injectedLatency > 0) {
      await delay(serviceState.injectedLatency);
    }
    
    if (shouldFail()) {
      return res.status(500).json({ error: 'Simulated user service error' });
    }
    
    if (serviceState.isFailed) {
      return res.status(500).json({ error: 'User service is failed' });
    }
    
    const response = await axios.get(`${DATABASE_SERVICE_URL}/users/${req.params.id}`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/users', async (req, res) => {
  try {
    if (serviceState.injectedLatency > 0) {
      await delay(serviceState.injectedLatency);
    }
    
    if (shouldFail()) {
      return res.status(500).json({ error: 'Simulated user service error' });
    }
    
    if (serviceState.isFailed) {
      return res.status(500).json({ error: 'User service is failed' });
    }
    
    // Simulate user creation logic
    const newUser = {
      id: Date.now(),
      ...req.body,
      createdAt: new Date().toISOString()
    };
    
    res.status(201).json(newUser);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start dependency health monitoring
setInterval(checkDependencyHealth, 10000);

app.listen(PORT, () => {
  console.log(`👤 User Service running on port ${PORT}`);
  console.log(`🔗 Connected to database: ${DATABASE_SERVICE_URL}`);
});
