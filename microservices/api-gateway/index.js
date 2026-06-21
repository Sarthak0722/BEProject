const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:8002';
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:8003';
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://localhost:8004';
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:8005';

// Service state
let serviceState = {
  health: 'healthy',
  isFailed: false,
  isDegraded: false,
  injectedLatency: 0,
  errorRate: 0,
  lastFault: null,
  dependencyHealth: {
    auth: 'healthy',
    user: 'healthy',
    order: 'healthy',
    product: 'healthy'
  }
};

// Helper function to simulate latency
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to simulate errors
const shouldFail = () => Math.random() < serviceState.errorRate;

// Check dependency health — only tracks dependency status, does not modify own state
// Own state is controlled exclusively by /inject-fault and /reset
async function checkDependencyHealth() {
  const dependencies = [
    { name: 'auth', url: AUTH_SERVICE_URL },
    { name: 'user', url: USER_SERVICE_URL },
    { name: 'order', url: ORDER_SERVICE_URL },
    { name: 'product', url: PRODUCT_SERVICE_URL }
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
        health: 'failed', service: 'api-gateway', timestamp: new Date().toISOString(),
        reason: serviceState.lastFault?.reason || 'Service is in failed state',
        dependencies: serviceState.dependencyHealth,
        injectedLatency: serviceState.injectedLatency, errorRate: serviceState.errorRate
      });
    }
    if (health === 'degraded') {
      return res.json({
        health: 'degraded', service: 'api-gateway', timestamp: new Date().toISOString(),
        reason: serviceState.lastFault?.reason || 'High latency or error rate detected',
        dependencies: serviceState.dependencyHealth,
        injectedLatency: serviceState.injectedLatency, errorRate: serviceState.errorRate
      });
    }
    res.json({ health: 'healthy', service: 'api-gateway', timestamp: new Date().toISOString(), dependencies: serviceState.dependencyHealth });
  } catch (error) {
    res.status(500).json({ health: 'failed', service: 'api-gateway', error: error.message, timestamp: new Date().toISOString() });
  }
});

// Fault injection endpoint
app.post('/inject-fault', async (req, res) => {
  const { type, isFailed, isDegraded, delay: latency, rate, reason } = req.body;
  
  console.log(`🔧 API Gateway received fault injection:`, req.body);
  
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
  console.log('🔄 Resetting API Gateway...');
  
  serviceState = {
    health: 'healthy',
    isFailed: false,
    isDegraded: false,
    injectedLatency: 0,
    errorRate: 0,
    lastFault: null,
    dependencyHealth: {
      auth: 'healthy',
      user: 'healthy',
      order: 'healthy',
      product: 'healthy'
    }
  };
  
  res.json({
    success: true,
    message: 'API Gateway reset successfully',
    state: serviceState
  });
});

// Middleware for authentication
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const response = await axios.post(`${AUTH_SERVICE_URL}/validate`, { token });
    req.user = response.data.user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Gateway routes
app.post('/api/auth/login', async (req, res) => {
  try {
    if (serviceState.injectedLatency > 0) {
      await delay(serviceState.injectedLatency);
    }
    
    if (shouldFail()) {
      return res.status(500).json({ error: 'Simulated API Gateway error' });
    }
    
    if (serviceState.isFailed) {
      return res.status(500).json({ error: 'API Gateway is failed' });
    }
    
    const response = await axios.post(`${AUTH_SERVICE_URL}/login`, req.body);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/logout', authenticateToken, async (req, res) => {
  try {
    if (serviceState.injectedLatency > 0) {
      await delay(serviceState.injectedLatency);
    }
    
    if (shouldFail()) {
      return res.status(500).json({ error: 'Simulated API Gateway error' });
    }
    
    if (serviceState.isFailed) {
      return res.status(500).json({ error: 'API Gateway is failed' });
    }
    
    const response = await axios.post(`${AUTH_SERVICE_URL}/logout`, req.body);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    if (serviceState.injectedLatency > 0) {
      await delay(serviceState.injectedLatency);
    }
    
    if (shouldFail()) {
      return res.status(500).json({ error: 'Simulated API Gateway error' });
    }
    
    if (serviceState.isFailed) {
      return res.status(500).json({ error: 'API Gateway is failed' });
    }
    
    const response = await axios.get(`${USER_SERVICE_URL}/users`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users/:id', authenticateToken, async (req, res) => {
  try {
    if (serviceState.injectedLatency > 0) {
      await delay(serviceState.injectedLatency);
    }
    
    if (shouldFail()) {
      return res.status(500).json({ error: 'Simulated API Gateway error' });
    }
    
    if (serviceState.isFailed) {
      return res.status(500).json({ error: 'API Gateway is failed' });
    }
    
    const response = await axios.get(`${USER_SERVICE_URL}/users/${req.params.id}`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/products', async (req, res) => {
  try {
    if (serviceState.injectedLatency > 0) {
      await delay(serviceState.injectedLatency);
    }
    
    if (shouldFail()) {
      return res.status(500).json({ error: 'Simulated API Gateway error' });
    }
    
    if (serviceState.isFailed) {
      return res.status(500).json({ error: 'API Gateway is failed' });
    }
    
    const response = await axios.get(`${PRODUCT_SERVICE_URL}/products`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    if (serviceState.injectedLatency > 0) {
      await delay(serviceState.injectedLatency);
    }
    
    if (shouldFail()) {
      return res.status(500).json({ error: 'Simulated API Gateway error' });
    }
    
    if (serviceState.isFailed) {
      return res.status(500).json({ error: 'API Gateway is failed' });
    }
    
    const response = await axios.get(`${PRODUCT_SERVICE_URL}/products/${req.params.id}`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders', authenticateToken, async (req, res) => {
  try {
    if (serviceState.injectedLatency > 0) {
      await delay(serviceState.injectedLatency);
    }
    
    if (shouldFail()) {
      return res.status(500).json({ error: 'Simulated API Gateway error' });
    }
    
    if (serviceState.isFailed) {
      return res.status(500).json({ error: 'API Gateway is failed' });
    }
    
    const response = await axios.get(`${ORDER_SERVICE_URL}/orders`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders/:id', authenticateToken, async (req, res) => {
  try {
    if (serviceState.injectedLatency > 0) {
      await delay(serviceState.injectedLatency);
    }
    
    if (shouldFail()) {
      return res.status(500).json({ error: 'Simulated API Gateway error' });
    }
    
    if (serviceState.isFailed) {
      return res.status(500).json({ error: 'API Gateway is failed' });
    }
    
    const response = await axios.get(`${ORDER_SERVICE_URL}/orders/${req.params.id}`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orders', authenticateToken, async (req, res) => {
  try {
    if (serviceState.injectedLatency > 0) {
      await delay(serviceState.injectedLatency);
    }
    
    if (shouldFail()) {
      return res.status(500).json({ error: 'Simulated API Gateway error' });
    }
    
    if (serviceState.isFailed) {
      return res.status(500).json({ error: 'API Gateway is failed' });
    }
    
    const response = await axios.post(`${ORDER_SERVICE_URL}/orders`, req.body);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start dependency health monitoring
setInterval(checkDependencyHealth, 10000);

app.listen(PORT, () => {
  console.log(`🚪 API Gateway running on port ${PORT}`);
  console.log(`🔗 Connected to auth service: ${AUTH_SERVICE_URL}`);
  console.log(`🔗 Connected to user service: ${USER_SERVICE_URL}`);
  console.log(`🔗 Connected to order service: ${ORDER_SERVICE_URL}`);
  console.log(`🔗 Connected to product service: ${PRODUCT_SERVICE_URL}`);
});
