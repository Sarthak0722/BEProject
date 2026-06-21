const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// In-memory database simulation
let database = {
  users: [
    { id: 1, name: 'John Doe', email: 'john@example.com' },
    { id: 2, name: 'Jane Smith', email: 'jane@example.com' },
    { id: 3, name: 'Bob Johnson', email: 'bob@example.com' }
  ],
  products: [
    { id: 1, name: 'Laptop', price: 999.99, stock: 10 },
    { id: 2, name: 'Mouse', price: 29.99, stock: 50 },
    { id: 3, name: 'Keyboard', price: 79.99, stock: 25 }
  ],
  orders: [
    { id: 1, userId: 1, productId: 1, quantity: 1, status: 'completed' },
    { id: 2, userId: 2, productId: 2, quantity: 2, status: 'pending' }
  ],
  authTokens: [
    { token: 'valid-token-123', userId: 1, expires: Date.now() + 3600000 }
  ]
};

// Service state
let serviceState = {
  health: 'healthy',
  isFailed: false,
  isDegraded: false,
  injectedLatency: 0,
  errorRate: 0,
  lastFault: null
};

// Helper function to simulate latency
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to simulate errors
const shouldFail = () => Math.random() < serviceState.errorRate;

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
    const health = getEffectiveHealth();
    serviceState.health = health;

    if (health === 'failed') {
      return res.status(500).json({
        health: 'failed',
        service: 'database-service',
        timestamp: new Date().toISOString(),
        reason: serviceState.lastFault?.reason || 'Service is in failed state',
        injectedLatency: serviceState.injectedLatency,
        errorRate: serviceState.errorRate
      });
    }

    if (health === 'degraded') {
      return res.json({
        health: 'degraded',
        service: 'database-service',
        timestamp: new Date().toISOString(),
        reason: serviceState.lastFault?.reason || 'High latency or error rate detected',
        injectedLatency: serviceState.injectedLatency,
        errorRate: serviceState.errorRate
      });
    }

    res.json({
      health: 'healthy',
      service: 'database-service',
      timestamp: new Date().toISOString(),
      dataCount: {
        users: database.users.length,
        products: database.products.length,
        orders: database.orders.length
      }
    });
  } catch (error) {
    res.status(500).json({ health: 'failed', service: 'database-service', error: error.message, timestamp: new Date().toISOString() });
  }
});

// Fault injection endpoint
app.post('/inject-fault', async (req, res) => {
  const { type, isFailed, isDegraded, delay: latency, rate, reason } = req.body;
  
  console.log(`🔧 Database service received fault injection:`, req.body);
  
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
  console.log('🔄 Resetting database service...');
  
  serviceState = {
    health: 'healthy',
    isFailed: false,
    isDegraded: false,
    injectedLatency: 0,
    errorRate: 0,
    lastFault: null
  };
  
  res.json({
    success: true,
    message: 'Database service reset successfully',
    state: serviceState
  });
});

// Database operation endpoints
app.get('/users', async (req, res) => {
  try {
    if (serviceState.injectedLatency > 0) {
      await delay(serviceState.injectedLatency);
    }
    
    if (shouldFail()) {
      return res.status(500).json({ error: 'Simulated database error' });
    }
    
    if (serviceState.isFailed) {
      return res.status(500).json({ error: 'Database service is failed' });
    }
    
    res.json(database.users);
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
      return res.status(500).json({ error: 'Simulated database error' });
    }
    
    if (serviceState.isFailed) {
      return res.status(500).json({ error: 'Database service is failed' });
    }
    
    const user = database.users.find(u => u.id === parseInt(req.params.id));
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/products', async (req, res) => {
  try {
    if (serviceState.injectedLatency > 0) {
      await delay(serviceState.injectedLatency);
    }
    
    if (shouldFail()) {
      return res.status(500).json({ error: 'Simulated database error' });
    }
    
    if (serviceState.isFailed) {
      return res.status(500).json({ error: 'Database service is failed' });
    }
    
    res.json(database.products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/products/:id', async (req, res) => {
  try {
    if (serviceState.injectedLatency > 0) {
      await delay(serviceState.injectedLatency);
    }
    
    if (shouldFail()) {
      return res.status(500).json({ error: 'Simulated database error' });
    }
    
    if (serviceState.isFailed) {
      return res.status(500).json({ error: 'Database service is failed' });
    }
    
    const product = database.products.find(p => p.id === parseInt(req.params.id));
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/orders', async (req, res) => {
  try {
    if (serviceState.injectedLatency > 0) {
      await delay(serviceState.injectedLatency);
    }
    
    if (shouldFail()) {
      return res.status(500).json({ error: 'Simulated database error' });
    }
    
    if (serviceState.isFailed) {
      return res.status(500).json({ error: 'Database service is failed' });
    }
    
    res.json(database.orders);
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
      return res.status(500).json({ error: 'Simulated database error' });
    }
    
    if (serviceState.isFailed) {
      return res.status(500).json({ error: 'Database service is failed' });
    }
    
    const newOrder = {
      id: database.orders.length + 1,
      ...req.body,
      status: 'pending'
    };
    
    database.orders.push(newOrder);
    res.status(201).json(newOrder);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/auth/validate', async (req, res) => {
  try {
    if (serviceState.injectedLatency > 0) {
      await delay(serviceState.injectedLatency);
    }
    
    if (shouldFail()) {
      return res.status(500).json({ error: 'Simulated database error' });
    }
    
    if (serviceState.isFailed) {
      return res.status(500).json({ error: 'Database service is failed' });
    }
    
    const { token } = req.body;
    const authToken = database.authTokens.find(t => t.token === token);
    
    if (!authToken || authToken.expires < Date.now()) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    const user = database.users.find(u => u.id === authToken.userId);
    res.json({ valid: true, user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🗄️  Database Service running on port ${PORT}`);
  console.log(`📊 Simulated database with ${database.users.length} users, ${database.products.length} products, ${database.orders.length} orders`);
});
