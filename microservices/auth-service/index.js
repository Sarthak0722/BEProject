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
        service: 'auth-service',
        timestamp: new Date().toISOString(),
        reason: serviceState.lastFault?.reason || 'Service is in failed state',
        dependencies: serviceState.dependencyHealth
      });
    }

    if (serviceState.isDegraded) {
      return res.json({
        health: 'degraded',
        service: 'auth-service',
        timestamp: new Date().toISOString(),
        reason: serviceState.lastFault?.reason || 'Service is in degraded state',
        dependencies: serviceState.dependencyHealth
      });
    }

    res.json({
      health: 'healthy',
      service: 'auth-service',
      timestamp: new Date().toISOString(),
      dependencies: serviceState.dependencyHealth
    });
  } catch (error) {
    res.status(500).json({
      health: 'failed',
      service: 'auth-service',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Fault injection endpoint
app.post('/inject-fault', async (req, res) => {
  const { type, isFailed, isDegraded, delay: latency, rate, reason } = req.body;
  
  console.log(`🔧 Auth service received fault injection:`, req.body);
  
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
  console.log('🔄 Resetting auth service...');
  
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
    message: 'Auth service reset successfully',
    state: serviceState
  });
});

// Auth endpoints
app.post('/login', async (req, res) => {
  try {
    if (serviceState.injectedLatency > 0) {
      await delay(serviceState.injectedLatency);
    }
    
    if (shouldFail()) {
      return res.status(500).json({ error: 'Simulated auth service error' });
    }
    
    if (serviceState.isFailed) {
      return res.status(500).json({ error: 'Auth service is failed' });
    }
    
    const { email, password } = req.body;
    
    // Simulate authentication logic
    if (email === 'john@example.com' && password === 'password') {
      const token = `auth-token-${Date.now()}`;
      
      // Store token in database
      try {
        await axios.post(`${DATABASE_SERVICE_URL}/auth/validate`, {
          token,
          userId: 1,
          expires: Date.now() + 3600000
        });
      } catch (dbError) {
        return res.status(500).json({ error: 'Database error during authentication' });
      }
      
      res.json({
        success: true,
        token,
        user: { id: 1, email, name: 'John Doe' }
      });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/validate', async (req, res) => {
  try {
    if (serviceState.injectedLatency > 0) {
      await delay(serviceState.injectedLatency);
    }
    
    if (shouldFail()) {
      return res.status(500).json({ error: 'Simulated auth service error' });
    }
    
    if (serviceState.isFailed) {
      return res.status(500).json({ error: 'Auth service is failed' });
    }
    
    const { token } = req.body;
    
    // Validate token with database
    try {
      const response = await axios.post(`${DATABASE_SERVICE_URL}/auth/validate`, { token });
      res.json(response.data);
    } catch (dbError) {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/logout', async (req, res) => {
  try {
    if (serviceState.injectedLatency > 0) {
      await delay(serviceState.injectedLatency);
    }
    
    if (shouldFail()) {
      return res.status(500).json({ error: 'Simulated auth service error' });
    }
    
    if (serviceState.isFailed) {
      return res.status(500).json({ error: 'Auth service is failed' });
    }
    
    // Simulate logout logic
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start dependency health monitoring
setInterval(checkDependencyHealth, 10000);

app.listen(PORT, () => {
  console.log(`🔐 Auth Service running on port ${PORT}`);
  console.log(`🔗 Connected to database: ${DATABASE_SERVICE_URL}`);
});
