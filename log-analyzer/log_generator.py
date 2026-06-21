import csv
import random
import math
import os
from datetime import datetime, timedelta

random.seed(42)

SERVICES = [
    "api-gateway",
    "auth-service",
    "user-service",
    "order-service",
    "product-service",
    "database-service",
]

# Which service calls which (source -> [targets])
DEPENDENCIES = {
    "api-gateway":    ["auth-service", "user-service", "order-service", "product-service"],
    "auth-service":   ["database-service"],
    "user-service":   ["database-service"],
    "order-service":  ["database-service", "product-service", "user-service"],
    "product-service":["database-service"],
    "database-service": [],
}

ENDPOINTS = {
    "api-gateway":     ["/api/auth/login", "/api/users", "/api/orders", "/api/products"],
    "auth-service":    ["/validate", "/login", "/logout"],
    "user-service":    ["/users", "/users/:id"],
    "order-service":   ["/orders", "/orders/:id"],
    "product-service": ["/products", "/products/:id"],
    "database-service":["/users", "/products", "/orders", "/auth/validate"],
}

# Normal (baseline) latency per target service in ms
BASE_LATENCY = {
    "database-service":  80,
    "auth-service":     120,
    "user-service":     100,
    "product-service":   90,
    "order-service":    150,
    "api-gateway":      200,
}

# CPU baseline per service (%)
BASE_CPU = {
    "database-service": 20,
    "auth-service":     15,
    "user-service":     12,
    "product-service":  12,
    "order-service":    18,
    "api-gateway":      10,
}

BASE_MEMORY = {
    "database-service": 40,
    "auth-service":     30,
    "user-service":     28,
    "product-service":  28,
    "order-service":    35,
    "api-gateway":      25,
}


def concurrent_users_at(hour: float) -> int:
    """Return realistic concurrent users for a BBD sale day given decimal hour."""
    if hour < 8.0:
        # Overnight — low traffic
        return int(random.gauss(150, 30))
    elif hour < 9.0:
        # BBD opens — rapid ramp
        t = (hour - 8.0)
        return int(150 + 650 * t + random.gauss(0, 40))
    elif hour < 12.0:
        # Morning surge
        t = (hour - 9.0) / 3.0
        return int(800 + 700 * t + random.gauss(0, 60))
    elif hour < 13.5:
        # Absolute peak
        return int(random.gauss(1800, 100))
    elif hour < 16.0:
        # Traffic drops after lunch
        t = (hour - 13.5) / 2.5
        return int(1800 - 1000 * t + random.gauss(0, 80))
    elif hour < 20.0:
        # Evening moderate surge
        return int(random.gauss(900, 70))
    else:
        # Night wind-down
        t = (hour - 20.0) / 4.0
        return int(900 - 700 * t + random.gauss(0, 40))


def latency_for(service: str, concurrent: int) -> float:
    """
    Exponential load-latency model:
      latency = base * exp(k * load_factor) + noise
    where load_factor = concurrent / saturation_point
    """
    saturation = {
        "database-service": 900,
        "auth-service":    1200,
        "user-service":    1300,
        "product-service": 1400,
        "order-service":   1100,
        "api-gateway":     1500,
    }
    k = 1.8  # growth steepness
    load_factor = min(concurrent / saturation[service], 1.5)
    base = BASE_LATENCY[service]
    predicted = base * math.exp(k * load_factor)
    noise = random.gauss(0, predicted * 0.12)
    return max(10, predicted + noise)


def cpu_for(service: str, concurrent: int) -> float:
    saturation = {
        "database-service": 900,
        "auth-service":    1200,
        "user-service":    1300,
        "product-service": 1400,
        "order-service":   1100,
        "api-gateway":     1500,
    }
    load_factor = min(concurrent / saturation[service], 1.2)
    base = BASE_CPU[service]
    return min(99, base + (100 - base) * load_factor + random.gauss(0, 3))


def memory_for(service: str, concurrent: int) -> float:
    saturation = {
        "database-service": 900,
        "auth-service":    1200,
        "user-service":    1300,
        "product-service": 1400,
        "order-service":   1100,
        "api-gateway":     1500,
    }
    load_factor = min(concurrent / saturation[service], 1.1)
    base = BASE_MEMORY[service]
    return min(99, base + (100 - base) * load_factor * 0.6 + random.gauss(0, 2))


def error_type_and_status(latency_ms: float, concurrent: int, target: str) -> tuple:
    saturation = {"database-service": 900, "auth-service": 1200, "user-service": 1300,
                  "product-service": 1400, "order-service": 1100, "api-gateway": 1500}
    overload = concurrent / saturation.get(target, 1200)

    if overload > 1.3 and random.random() < 0.55:
        return "connection_refused", 503
    if latency_ms > 5000 and random.random() < 0.6:
        return "timeout", 504
    if latency_ms > 3000 and random.random() < 0.25:
        return "timeout", 504
    if overload > 1.0 and random.random() < 0.12:
        return "internal_error", 500
    return None, 200


def retry_count_for(status_code: int, concurrent: int) -> int:
    if status_code in (503, 504):
        return random.randint(2, 4)
    if status_code == 500 and concurrent > 1000:
        return random.randint(1, 2)
    return 0


def generate_logs(output_path: str, rows_per_minute: int = 12):
    start = datetime(2024, 11, 1, 0, 0, 0)
    rows = []

    # Generate one full day, sampling every 5 seconds
    current = start
    end = start + timedelta(hours=24)

    while current < end:
        hour_decimal = current.hour + current.minute / 60.0 + current.second / 3600.0
        concurrent = max(50, concurrent_users_at(hour_decimal))

        # How many log entries in this 5-second window (proportional to load)
        n_entries = max(1, int(concurrent / 60))

        for _ in range(n_entries):
            # Pick a random dependency call
            source = random.choice([s for s in SERVICES if DEPENDENCIES[s]])
            target = random.choice(DEPENDENCIES[source])
            endpoint = random.choice(ENDPOINTS.get(target, ["/health"]))

            latency = latency_for(target, concurrent)
            cpu = cpu_for(target, concurrent)
            memory = memory_for(target, concurrent)
            error_t, status = error_type_and_status(latency, concurrent, target)
            retries = retry_count_for(status, concurrent)

            # Add a few ms jitter to timestamp
            ts = current + timedelta(milliseconds=random.randint(0, 4999))

            rows.append({
                "timestamp": ts.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
                "source_service": source,
                "target_service": target,
                "endpoint": endpoint,
                "latency_ms": round(latency, 1),
                "status_code": status,
                "error_type": error_t if error_t else "",
                "concurrent_requests": concurrent,
                "cpu_percent": round(cpu, 1),
                "memory_percent": round(memory, 1),
                "retry_count": retries,
            })

        current += timedelta(seconds=5)

    # Sort by timestamp
    rows.sort(key=lambda r: r["timestamp"])

    fieldnames = [
        "timestamp", "source_service", "target_service", "endpoint",
        "latency_ms", "status_code", "error_type",
        "concurrent_requests", "cpu_percent", "memory_percent", "retry_count",
    ]

    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Generated {len(rows):,} log rows -> {output_path}")
    return len(rows)


if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "sample_logs", "bbd_logs.csv")
    generate_logs(out)
