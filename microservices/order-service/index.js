const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DATABASE_SERVICE_URL = process.env.DATABASE_SERVICE_URL || 'http://localhost:8006';
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:8005';
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:8003';

// Service state
let serviceState = {
  health: 'healthy',
  isFailed: false,
  isDegraded: false,
  injectedLatency: 0,
  errorRate: 0,
  lastFault: null,
  dependencyHealth: {
    database: 'healthy',
    product: 'healthy',
    user: 'healthy'
  }
};

// Helper function to simulate latency
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to simulate errors
const shouldFail = () => Math.random() < serviceState.errorRate;

// Check dependency health — only tracks dependency status, does not modify own state
async function checkDependencyHealth() {
  const dependencies = [
    { name: 'database', url: DATABASE_SERVICE_URL },
    { name: 'product', url: PRODUCT_SERVICE_URL },
    { name: 'user', url: USER_SERVICE_URL }
  ];

  for (const dep of dependencies) {
    try {
      const response = await axios.get(`${dep.url}/health`, { timeout: 5000 });
      serviceState.dependencyHealth[dep.name] = response.data.health;
    } catch (error) {
      serviceState.dependencyHealth[dep.name] = 'failed';
    }
  }
}

function getEffectiveHealth() {
  if (serviceState.isFailed) return 'failed';
  if (serviceState.errorRate >= 0.5) return 'failed';
  if (serviceState.injectedLatency >= 3000) return 'failed';
  if (serviceState.isDegraded) return 'degraded';
  if (serviceState.errorRate >= 0.15) return 'degraded';
  if (serviceState.injectedLatency >= 800) return 'degraded';
  return 'healthy';
}

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await checkDependencyHealth();
    const health = getEffectiveHealth();
    serviceState.health = health;

    if (health === 'failed') {
      return res.status(500).json({
        health: 'failed', service: 'order-service', timestamp: new Date().toISOString(),
        reason: serviceState.lastFault?.reason || 'Service is in failed state',
        dependencies: serviceState.dependencyHealth,
        injectedLatency: serviceState.injectedLatency, errorRate: serviceState.errorRate
      });
    }
    if (health === 'degraded') {
      return res.json({
        health: 'degraded', service: 'order-service', timestamp: new Date().toISOString(),
        reason: serviceState.lastFault?.reason || 'High latency or error rate detected',
        dependencies: serviceState.dependencyHealth,
        injectedLatency: serviceState.injectedLatency, errorRate: serviceState.errorRate
      });
    }
    res.json({ health: 'healthy', service: 'order-service', timestamp: new Date().toISOString(), dependencies: serviceState.dependencyHealth });
  } catch (error) {
    res.status(500).json({ health: 'failed', service: 'order-service', error: error.message, timestamp: new Date().toISOString() });
  }
});

// Fault injection endpoint
app.post('/inject-fault', async (req, res) => {
  const { type, isFailed, isDegraded, delay: latency, rate, reason } = req.body;
  
  console.log(`🔧 Order service received fault injection:`, req.body);
  
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

    case 'RESET':
      serviceState.isFailed = false;
      serviceState.isDegraded = false;
      serviceState.health = 'healthy';
      serviceState.injectedLatency = 0;
      serviceState.errorRate = 0;
      serviceState.lastFault = null;
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
  console.log('🔄 Resetting order service...');
  
  serviceState = {
    health: 'healthy',
    isFailed: false,
    isDegraded: false,
    injectedLatency: 0,
    errorRate: 0,
    lastFault: null,
    dependencyHealth: {
      database: 'healthy',
      product: 'healthy',
      user: 'healthy'
    }
  };
  
  res.json({
    success: true,
    message: 'Order service reset successfully',
    state: serviceState
  });
});

// Order endpoints
app.get('/orders', async (req, res) => {
  try {
    if (serviceState.injectedLatency > 0) {
      await delay(serviceState.injectedLatency);
    }
    
    if (shouldFail()) {
      return res.status(500).json({ error: 'Simulated order service error' });
    }
    
    if (serviceState.isFailed) {
      return res.status(500).json({ error: 'Order service is failed' });
    }
    
    const response = await axios.get(`${DATABASE_SERVICE_URL}/orders`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/orders/:id', async (req, res) => {
  try {
    if (serviceState.injectedLatency > 0) {
      await delay(serviceState.injectedLatency);
    }
    
    if (shouldFail()) {
      return res.status(500).json({ error: 'Simulated order service error' });
    }
    
    if (serviceState.isFailed) {
      return res.status(500).json({ error: 'Order service is failed' });
    }
    
    // Simulate order retrieval with dependency calls
    const orderId = req.params.id;
    
    // Check if we can validate the order (requires user and product services)
    try {
      await axios.get(`${USER_SERVICE_URL}/users/1`); // Simulate user validation
      await axios.get(`${PRODUCT_SERVICE_URL}/products/1`); // Simulate product validation
    } catch (depError) {
      if (serviceState.dependencyHealth.user === 'failed' || serviceState.dependencyHealth.product === 'failed') {
        return res.status(500).json({ error: 'Cannot retrieve order due to dependency failures' });
      }
    }
    
    const mockOrder = {
      id: parseInt(orderId),
      userId: 1,
      productId: 1,
      quantity: 2,
      status: 'pending',
      total: 199.98,
      createdAt: new Date().toISOString()
    };
    
    res.json(mockOrder);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/orders', async (req, res) => {
  try {
    if (serviceState.injectedLatency > 0) {
      await delay(serviceState.injectedLatency);
    }
    
    if (shouldFail()) {
      return res.status(500).json({ error: 'Simulated order service error' });
    }
    
    if (serviceState.isFailed) {
      return res.status(500).json({ error: 'Order service is failed' });
    }
    
    const { userId, productId, quantity } = req.body;
    
    // Validate dependencies
    try {
      await axios.get(`${USER_SERVICE_URL}/users/${userId}`);
      await axios.get(`${PRODUCT_SERVICE_URL}/products/${productId}`);
    } catch (depError) {
      return res.status(400).json({ error: 'Invalid user or product' });
    }
    
    // Create order
    const newOrder = {
      id: Date.now(),
      userId,
      productId,
      quantity,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    
    // Store in database
    await axios.post(`${DATABASE_SERVICE_URL}/orders`, newOrder);
    
    res.status(201).json(newOrder);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start dependency health monitoring
setInterval(checkDependencyHealth, 10000);

app.listen(PORT, () => {
  console.log(`🛒 Order Service running on port ${PORT}`);
  console.log(`🔗 Connected to database: ${DATABASE_SERVICE_URL}`);
  console.log(`🔗 Connected to product service: ${PRODUCT_SERVICE_URL}`);
  console.log(`🔗 Connected to user service: ${USER_SERVICE_URL}`);
});
