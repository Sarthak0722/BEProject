# Kendra - Microservice Failure Propagation Simulator

A complete, runnable prototype of a microservice failure propagation simulator that uses live, containerized microservices as execution actors. The system features a central Simulation Engine that reads a detailed Behavioral Rulebook and orchestrates fault injection across a network of interconnected services.

## 🎯 Core Concept

Kendra is an offline-first simulator that demonstrates how failures cascade through a microservice architecture. The system consists of:

- **Microservice Actors**: 6-7 stateful Node.js/Express services with real dependency relationships
- **Behavioral Rulebook**: A JSON configuration that defines failure propagation rules
- **Simulation Engine**: Central orchestrator that injects faults and calculates ripple effects
- **Control Panel UI**: Interactive frontend for visualizing and controlling the simulation

## 🏗️ System Architecture

### The Four Core Components

#### A. Microservice Actors (The "Puppets")
Six Node.js/Express microservices with real dependency relationships:

- **api-gateway**: Entry point that routes requests to other services
- **auth-service**: Handles authentication and authorization
- **user-service**: Manages user data and operations
- **order-service**: Processes orders with dependencies on user and product services
- **product-service**: Manages product catalog
- **database-service**: Simulated database with in-memory data

Each service includes:
- Health monitoring of downstream dependencies
- Fault injection API (`POST /inject-fault`)
- Reset functionality (`POST /reset`)
- Real-time health status (`GET /health`)

#### B. Behavioral Rulebook (services.json)
Defines the system's topology and failure propagation rules:

```json
{
  "nodes": [...],      // Service definitions
  "edges": [...],      // Dependency relationships
  "behaviors": {       // Failure propagation rules
    "order-service": {
      "dependencies": {
        "user-service": {
          "onFailure": { "newState": "failed", "reason": "Critical dependency failed" }
        }
      }
    }
  }
}
```

#### C. Simulation Engine (The "Puppet Master")
Central Node.js service that:
- Reads and parses the behavioral rulebook
- Orchestrates fault injection across services
- Calculates and propagates failure cascades
- Broadcasts real-time system state via WebSockets
- Provides REST API for external control

#### D. Frontend Control Panel (The "Cockpit")
React-based UI featuring:
- **Cytoscape.js Graph Visualization**: Real-time service topology
- **Interactive Control Panel**: Per-service fault injection controls
- **System Status Dashboard**: Overall health monitoring
- **WebSocket Integration**: Live updates from simulation engine

## 🚀 Quick Start

### Prerequisites
- Windows 10/11 with PowerShell
- Docker Desktop installed and running
- At least 4GB RAM available for containers

### Installation & Setup

1. **Clone or download the project**
   ```bash
   # If using git
   git clone <repository-url>
   cd KendraV1.O
   ```

2. **Build and start all services**
   ```bash
   docker compose up --build -d
   ```

3. **Wait for services to be ready** (about 30-60 seconds)
   ```bash
   # Check if services are running
   docker compose ps
   ```

4. **Access the application**
   - Frontend Control Panel: http://localhost:3000
   - Simulation Engine API: http://localhost:4000
   - API Gateway: http://localhost:8001

### Stopping the Application

```bash
# Stop all services
docker compose down

# Stop and remove all containers, networks, and volumes
docker compose down -v
```

## 🎮 Usage Guide

### Basic Operation

1. **Open the Control Panel**
   - Navigate to http://localhost:3000
   - Wait for the service graph to load

2. **Inject Faults**
   - Click on any service node in the graph
   - Use the control panel to inject specific faults:
     - **Total Failure**: Complete service shutdown
     - **Latency**: Add response delays (0-5000ms)
     - **Error Rate**: Simulate random failures (0-100%)

3. **Observe Propagation**
   - Watch how failures cascade through dependent services
   - Monitor real-time health status updates
   - See the behavioral rules in action

4. **Reset the System**
   - Use "Reset All Services" to restore normal operation
   - Or reset individual services from their control panels

### Advanced Features

#### Custom Fault Injection
The system supports various fault types:

```javascript
// Complete failure
{ "type": "FAILURE", "isFailed": true }

// Latency injection
{ "type": "LATENCY", "delay": 2500 }

// Error rate simulation
{ "type": "ERROR_RATE", "rate": 0.5 }
```

#### Behavioral Rule Customization
Edit `simulation-engine/services.json` to modify:
- Service dependencies
- Failure propagation thresholds
- Cascade behavior rules

#### API Integration
The simulation engine provides REST endpoints:

```bash
# Get system health
GET http://localhost:4000/api/health

# Inject fault programmatically
POST http://localhost:4000/api/inject-fault
{
  "serviceId": "database-service",
  "fault": { "type": "LATENCY", "delay": 2000 }
}

# Reset all services
POST http://localhost:4000/api/reset-all
```

## 🛠️ Management Commands

### Service Management
```powershell
# View all running containers
docker compose ps

# View logs for specific service
docker compose logs -f simulation-engine
docker compose logs -f frontend
docker compose logs -f api-gateway

# Restart specific service
docker compose restart database-service

# Scale a service (if needed)
docker compose up -d --scale user-service=2
```

### Troubleshooting
```powershell
# Check service health
curl http://localhost:4000/api/health

# View all container logs
docker compose logs

# Stop all services
docker compose down

# Clean up Docker resources
docker system prune -f
```

### Development Mode
```powershell
# Run with live code reloading
docker compose -f docker-compose.yml -f docker-compose.dev.yml up

# Access container shell
docker compose exec simulation-engine sh
docker compose exec frontend sh
```

## 📊 Service Ports

| Service | Port | Description |
|---------|------|-------------|
| Frontend | 3000 | React control panel |
| Simulation Engine | 4000 | Central orchestrator |
| API Gateway | 8001 | Request routing |
| Auth Service | 8002 | Authentication |
| User Service | 8003 | User management |
| Order Service | 8004 | Order processing |
| Product Service | 8005 | Product catalog |
| Database Service | 8006 | Data storage |

## 🔧 Configuration

### Environment Variables
- `COMPOSE_PROJECT_NAME`: Docker project name (default: "kendra")
- `NODE_ENV`: Node.js environment (default: "development")
- `REACT_APP_SIMULATOR_URL`: Frontend API URL (default: "http://localhost:4000")

### Behavioral Rules
The `simulation-engine/services.json` file contains:
- **nodes**: Service definitions with URLs
- **edges**: Dependency relationships
- **behaviors**: Failure propagation rules per service

### Customization
- Modify service behavior by editing individual service files
- Add new services by extending the rulebook
- Customize UI themes in `frontend/src/App.css`

## 🧪 Testing Scenarios

### Scenario 1: Database Failure Cascade
1. Inject total failure into `database-service`
2. Observe all dependent services fail
3. Note the cascade order: database → user/auth/product → order → api-gateway

### Scenario 2: Latency Propagation
1. Add 3000ms latency to `database-service`
2. Watch services degrade based on latency thresholds
3. See how different services have different tolerance levels

### Scenario 3: Partial System Degradation
1. Inject errors into `product-service` only
2. Observe `order-service` degradation
3. Note that `user-service` remains healthy

### Scenario 4: Recovery Testing
1. Inject failures across multiple services
2. Use "Reset All Services"
3. Verify all services return to healthy state

## 🐛 Troubleshooting

### Common Issues

**Services not starting**
```powershell
# Check Docker daemon
docker info

# Check port conflicts
netstat -an | findstr :3000
netstat -an | findstr :4000
```

**Frontend not loading**
```powershell
# Check frontend logs
docker compose logs frontend

# Verify simulation engine is running
curl http://localhost:4000/api/health
```

**WebSocket connection issues**
```powershell
# Check simulation engine logs
docker compose logs simulation-engine

# Verify firewall settings
# Allow ports 3000 and 4000 through Windows Firewall
```

**Memory issues**
```powershell
# Check Docker resource usage
docker stats

# Increase Docker memory limit in Docker Desktop settings
# Recommended: 4GB+ RAM, 2GB+ swap
```

### Performance Optimization
- Increase Docker Desktop memory allocation
- Close unnecessary applications
- Use `docker system prune` regularly
- Consider running fewer services for testing

## 🤝 Contributing

### Development Setup
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with the full system
5. Submit a pull request

### Adding New Services
1. Create service directory in `microservices/`
2. Add service definition to `services.json`
3. Update `docker-compose.yml`
4. Test integration with existing services

### Extending the Rulebook
1. Modify `simulation-engine/services.json`
2. Add new behavioral rules
3. Test failure propagation scenarios
4. Update documentation

## 📄 License

This project is provided as-is for educational and demonstration purposes.

## 🙏 Acknowledgments

- Built with Node.js, React, and Docker
- Uses Cytoscape.js for graph visualization
- Inspired by chaos engineering principles
- Designed for microservice architecture learning

---

**Happy Simulating! 🎭**

For questions or issues, please check the troubleshooting section or review the service logs.
