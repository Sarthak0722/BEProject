"""
Analyzer — derives services.json from normalized logs.
Extracts real dependency graph, thresholds, and behaviors from data.
"""

import json
import numpy as np
from collections import defaultdict
from typing import List, Dict, Any


def _percentile(values: List[float], p: int) -> float:
    if not values:
        return 0.0
    return float(np.percentile(values, p))


def _failure_correlation(rows: List[dict], src: str, tgt: str) -> str:
    """
    Given rows where source=src and target=tgt, what new state should src be in
    when tgt fails? Derived from historical error rate.
    """
    relevant = [r for r in rows if r["source_service"] == src and r["target_service"] == tgt]
    if not relevant:
        return "degraded"

    failure_rows = [r for r in relevant if (r.get("status_code") or 200) >= 500
                    or (r.get("latency_ms") or 0) >= 4000]
    rate = len(failure_rows) / len(relevant)
    return "failed" if rate >= 0.4 else "degraded"


def generate_services_json(rows: List[dict], existing_config: dict = None) -> dict:
    """
    Generate a complete services.json from normalized log rows.
    If existing_config is provided, we keep its node metadata (url, type, criticality)
    and only override the data-driven fields.
    """
    if not rows:
        raise ValueError("No log rows provided for analysis")

    # -----------------------------------------------------------------------
    # 1. Discover nodes and edges from logs
    # -----------------------------------------------------------------------
    all_services = set()
    edge_set = set()
    latency_by_edge: Dict[tuple, List[float]] = defaultdict(list)
    errors_by_edge: Dict[tuple, int] = defaultdict(int)
    count_by_edge: Dict[tuple, int] = defaultdict(int)

    for r in rows:
        src = r["source_service"]
        tgt = r["target_service"]
        all_services.add(src)
        all_services.add(tgt)
        edge = (src, tgt)
        edge_set.add(edge)
        latency_by_edge[edge].append(r.get("latency_ms") or 0)
        count_by_edge[edge] += 1
        if (r.get("status_code") or 200) >= 500:
            errors_by_edge[edge] += 1

    # -----------------------------------------------------------------------
    # 2. Build nodes — merge with existing config if available
    # -----------------------------------------------------------------------
    existing_nodes = {}
    if existing_config and "nodes" in existing_config:
        for n in existing_config["nodes"]:
            existing_nodes[n["id"]] = n

    nodes = []
    for svc in sorted(all_services):
        if svc in existing_nodes:
            nodes.append(existing_nodes[svc])
        else:
            nodes.append({
                "id": svc,
                "name": svc.replace("-", " ").title(),
                "url": f"http://{svc}:3000",
                "type": "business",
                "criticality": "medium",
            })

    # -----------------------------------------------------------------------
    # 3. Build edges
    # -----------------------------------------------------------------------
    edges = [{"source": src, "target": tgt} for (src, tgt) in sorted(edge_set)]

    # -----------------------------------------------------------------------
    # 4. Build behaviors — data-driven thresholds
    # -----------------------------------------------------------------------
    # For each service, find what it depends on
    deps_of: Dict[str, set] = defaultdict(set)
    for (src, tgt) in edge_set:
        deps_of[src].add(tgt)

    behaviors = {}
    for svc in sorted(all_services):
        dep_behaviors = {}
        for tgt in sorted(deps_of.get(svc, [])):
            edge = (svc, tgt)
            lats = latency_by_edge[edge]
            n = count_by_edge[edge]
            errs = errors_by_edge[edge]

            p95_lat = _percentile(lats, 95)
            p99_lat = _percentile(lats, 99)
            error_rate = errs / max(n, 1)

            # Latency threshold: p95 × 1.5 (anything above is abnormal)
            latency_threshold = int(p95_lat * 1.5)
            latency_threshold = max(500, min(latency_threshold, 4000))

            # Propagation delay: derived from analysis (median propagation time in ms)
            propagation_delay = max(200, int(p95_lat * 0.3))

            on_failure_state = _failure_correlation(rows, svc, tgt)

            dep_behaviors[tgt] = {
                "onFailure": {
                    "newState": on_failure_state,
                    "reason": f"{tgt} failure affects {svc} operations",
                    "propagationDelay": propagation_delay,
                    "historical_error_rate": round(error_rate, 3),
                },
                "onLatency": {
                    "threshold_ms": latency_threshold,
                    "newState": "degraded",
                    "reason": f"High latency from {tgt} degrading {svc} performance",
                    "propagationDelay": max(100, propagation_delay // 2),
                    "p95_baseline_ms": round(p95_lat, 1),
                    "p99_baseline_ms": round(p99_lat, 1),
                },
                "onDegraded": {
                    "newState": "degraded",
                    "reason": f"{tgt} degradation cascades to {svc}",
                },
            }

        # Resilience config
        is_critical = len(deps_of.get(svc, [])) == 0   # leaf node (e.g. database)
        resilience = {
            "circuitBreaker": not is_critical,
            "retryPolicy": "exponential" if len(deps_of.get(svc, [])) > 1 else "linear",
            "timeout": 5000,
        }

        behaviors[svc] = {
            "dependencies": dep_behaviors,
            "resilience": resilience,
        }

    # -----------------------------------------------------------------------
    # 5. Compute monitoring thresholds from data
    # -----------------------------------------------------------------------
    all_lats = [r.get("latency_ms") or 0 for r in rows]
    p95_system = _percentile(all_lats, 95)

    monitoring = {
        "healthCheckInterval": 5000,
        "propagationTimeout": 10000,
        "recoveryTimeout": 15000,
        "alertThresholds": {
            "failedServices": 2,
            "degradedServices": 3,
            "systemLatency": int(p95_system * 1.5),
        },
        "derivedFrom": {
            "logRows": len(rows),
            "uniqueServices": len(all_services),
            "uniqueEdges": len(edge_set),
            "systemP95LatencyMs": round(p95_system, 1),
        },
    }

    # -----------------------------------------------------------------------
    # 6. Keep existing testScenarios if present
    # -----------------------------------------------------------------------
    test_scenarios = existing_config.get("testScenarios", []) if existing_config else []

    return {
        "nodes": nodes,
        "edges": edges,
        "behaviors": behaviors,
        "testScenarios": test_scenarios,
        "monitoring": monitoring,
    }
