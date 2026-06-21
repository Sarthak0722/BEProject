"""
ML Models for Kendra Log Analyzer

Model 1 — Load-Latency Curve (scipy exponential fit per service)
Model 2 — Cascade Probability (Bayesian co-occurrence from logs)
Model 3 — Anomaly Detection (Isolation Forest on normal-period data)
Model 4 — Resource Saturation Point (linear regression cpu vs load)
"""

import math
import numpy as np
from collections import defaultdict
from typing import Dict, List, Tuple, Optional
from datetime import datetime, timedelta

from sklearn.ensemble import IsolationForest
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import StandardScaler
from scipy.optimize import curve_fit
import warnings
warnings.filterwarnings("ignore")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_ts(ts: str) -> datetime:
    ts = ts.replace("Z", "").replace("T", " ")
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(ts, fmt)
        except ValueError:
            continue
    raise ValueError(f"Cannot parse timestamp: {ts}")


def _exp_model(x, a, b, c):
    """Exponential latency model: latency = a * exp(b * x) + c"""
    return a * np.exp(b * x) + c


# ---------------------------------------------------------------------------
# Model 1: Load-Latency Curves
# ---------------------------------------------------------------------------

class LoadLatencyModel:
    """
    Fits an exponential curve (latency = a*exp(b*load) + c) per service.
    Predicts health state (healthy / degraded / failed) at any load level.
    """

    # Latency thresholds for state transitions (ms)
    DEGRADED_THRESHOLD_MULTIPLIER = 2.0   # 2× baseline p95 → degraded
    FAILED_LATENCY_MS = 5000
    FAILED_ERROR_RATE = 0.15

    def __init__(self):
        self.curves: Dict[str, dict] = {}          # service -> curve params
        self.baselines: Dict[str, float] = {}      # service -> p95 at low load
        self.error_rates: Dict[str, List] = defaultdict(list)

    def fit(self, rows: List[dict]):
        """Fit load-latency curves from normalized log rows."""
        # Group by target service
        by_service: Dict[str, List[Tuple[int, float]]] = defaultdict(list)
        error_by_service: Dict[str, List[Tuple[int, int]]] = defaultdict(list)

        for r in rows:
            if r.get("concurrent_requests") and r.get("latency_ms"):
                svc = r["target_service"]
                by_service[svc].append((r["concurrent_requests"], r["latency_ms"]))
                is_error = 1 if (r.get("status_code") or 200) >= 500 else 0
                error_by_service[svc].append((r["concurrent_requests"], is_error))

        for svc, points in by_service.items():
            if len(points) < 20:
                continue

            loads = np.array([p[0] for p in points], dtype=float)
            lats  = np.array([p[1] for p in points], dtype=float)

            # Compute baseline (p95 at low load ≤ 300 users)
            low_mask = loads <= 300
            if low_mask.sum() >= 5:
                self.baselines[svc] = float(np.percentile(lats[low_mask], 95))
            else:
                self.baselines[svc] = float(np.percentile(lats, 50))

            # Normalise loads to [0, 1] for stable fitting
            max_load = float(loads.max()) or 1.0
            x = loads / max_load

            try:
                # Initial guesses: a=baseline, b=1.5, c=10
                p0 = [self.baselines[svc], 1.5, 10.0]
                popt, _ = curve_fit(
                    _exp_model, x, lats,
                    p0=p0, maxfev=5000,
                    bounds=([0, 0, 0], [np.inf, 10, np.inf])
                )
                self.curves[svc] = {"a": popt[0], "b": popt[1], "c": popt[2],
                                    "max_load": max_load}
            except RuntimeError:
                # Fall back to simple mean-based lookup
                self.curves[svc] = {"fallback": True, "max_load": max_load,
                                    "points": list(zip(loads.tolist(), lats.tolist()))}

            # Error rate model per load bucket
            err_loads = np.array([p[0] for p in error_by_service[svc]])
            err_vals  = np.array([p[1] for p in error_by_service[svc]])
            self.error_rates[svc] = list(zip(err_loads.tolist(), err_vals.tolist()))

        return self

    def predict_latency(self, service: str, concurrent: int) -> float:
        if service not in self.curves:
            return 200.0
        c = self.curves[service]
        if c.get("fallback"):
            # Nearest-neighbour fallback
            pts = sorted(c["points"], key=lambda p: abs(p[0] - concurrent))
            return pts[0][1]
        x = concurrent / c["max_load"]
        return float(_exp_model(x, c["a"], c["b"], c["c"]))

    def predict_error_rate(self, service: str, concurrent: int) -> float:
        pts = self.error_rates.get(service, [])
        if not pts:
            return 0.0
        # Average error rate in nearby load bucket (±200)
        nearby = [e for (l, e) in pts if abs(l - concurrent) <= 200]
        if not nearby:
            nearby = [e for (_, e) in pts]
        return float(np.mean(nearby))

    def predict_health(self, service: str, concurrent: int) -> str:
        lat = self.predict_latency(service, concurrent)
        err = self.predict_error_rate(service, concurrent)
        baseline = self.baselines.get(service, 200)
        degraded_threshold = baseline * self.DEGRADED_THRESHOLD_MULTIPLIER

        if err >= self.FAILED_ERROR_RATE or lat >= self.FAILED_LATENCY_MS:
            return "failed"
        if lat >= degraded_threshold or err >= 0.05:
            return "degraded"
        return "healthy"

    def predict_all_services(self, concurrent: int, services: List[str]) -> Dict[str, dict]:
        result = {}
        for svc in services:
            lat = self.predict_latency(svc, concurrent)
            err = self.predict_error_rate(svc, concurrent)
            health = self.predict_health(svc, concurrent)
            result[svc] = {
                "predicted_latency_ms": round(lat, 1),
                "predicted_error_rate": round(err, 3),
                "health": health,
            }
        return result


# ---------------------------------------------------------------------------
# Model 2: Cascade Probability
# ---------------------------------------------------------------------------

class CascadeModel:
    """
    Builds a Bayesian co-occurrence matrix from logs.
    P(service_B fails | service_A fails) derived from time-windowed failures.
    """

    FAILURE_LATENCY_THRESHOLD = 3000   # ms — defines what counts as "failure event"
    WINDOW_SECONDS = 30                # co-occurrence window

    def __init__(self):
        self.co_occurrence: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
        self.propagation_delay: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(list))
        self.failure_rates: Dict[str, float] = {}

    def fit(self, rows: List[dict]):
        if not rows:
            return self

        # Sort by timestamp
        sorted_rows = sorted(rows, key=lambda r: r["timestamp"])

        # Identify failure events per service
        failures: Dict[str, List[datetime]] = defaultdict(list)
        total_counts: Dict[str, int] = defaultdict(int)
        fail_counts: Dict[str, int] = defaultdict(int)

        for r in sorted_rows:
            svc = r["target_service"]
            total_counts[svc] += 1
            lat = r.get("latency_ms") or 0
            status = r.get("status_code") or 200
            if lat >= self.FAILURE_LATENCY_THRESHOLD or status >= 500:
                fail_counts[svc] += 1
                try:
                    failures[svc].append(_parse_ts(r["timestamp"]))
                except ValueError:
                    pass

        # Base failure rates
        for svc in total_counts:
            self.failure_rates[svc] = fail_counts[svc] / max(total_counts[svc], 1)

        # Co-occurrence: for each failure of svc_a, check if svc_b fails within window
        all_services = list(failures.keys())
        for svc_a in all_services:
            for ts_a in failures[svc_a]:
                window_end = ts_a + timedelta(seconds=self.WINDOW_SECONDS)
                for svc_b in all_services:
                    if svc_b == svc_a:
                        continue
                    # Did svc_b fail after svc_a within the window?
                    for ts_b in failures[svc_b]:
                        if ts_a <= ts_b <= window_end:
                            self.co_occurrence[svc_a][svc_b] += 1
                            delay_s = (ts_b - ts_a).total_seconds()
                            self.propagation_delay[svc_a][svc_b].append(delay_s)
                            break

        # Normalise co-occurrence to probabilities
        for svc_a in self.co_occurrence:
            total_a_failures = len(failures[svc_a]) or 1
            for svc_b in self.co_occurrence[svc_a]:
                self.co_occurrence[svc_a][svc_b] /= total_a_failures
                delays = self.propagation_delay[svc_a][svc_b]
                self.propagation_delay[svc_a][svc_b] = float(np.median(delays)) if delays else 5.0

        return self

    def predict_cascade(self, failed_service: str) -> List[dict]:
        """Return sorted list of services likely to cascade with probabilities."""
        cascades = []
        for svc_b, prob in self.co_occurrence.get(failed_service, {}).items():
            if prob >= 0.05:
                delay = self.propagation_delay.get(failed_service, {}).get(svc_b, 5.0)
                cascades.append({
                    "service": svc_b,
                    "probability": round(prob, 3),
                    "expected_delay_seconds": round(delay, 1),
                })
        return sorted(cascades, key=lambda x: -x["probability"])


# ---------------------------------------------------------------------------
# Model 3: Anomaly Detection
# ---------------------------------------------------------------------------

class AnomalyDetector:
    """
    Isolation Forest trained on 'normal' period metrics.
    Scores each time window — high score = anomalous.
    """

    def __init__(self, contamination: float = 0.05):
        self.model = IsolationForest(contamination=contamination, random_state=42, n_estimators=100)
        self.scaler = StandardScaler()
        self.feature_cols = ["latency_ms", "cpu_percent", "memory_percent", "concurrent_requests"]
        self.trained = False

    def _extract_features(self, rows: List[dict]) -> Optional[np.ndarray]:
        features = []
        for r in rows:
            row_feats = [
                r.get("latency_ms") or 0,
                r.get("cpu_percent") or 0,
                r.get("memory_percent") or 0,
                r.get("concurrent_requests") or 0,
            ]
            features.append(row_feats)
        if not features:
            return None
        return np.array(features, dtype=float)

    def fit(self, rows: List[dict]):
        """Train on rows from the 'normal' period (e.g., first 8 hours)."""
        X = self._extract_features(rows)
        if X is None or len(X) < 10:
            return self
        X_scaled = self.scaler.fit_transform(X)
        self.model.fit(X_scaled)
        self.trained = True
        return self

    def score_rows(self, rows: List[dict]) -> List[dict]:
        """Score all rows — returns rows with anomaly_score and is_anomaly fields."""
        if not self.trained:
            return [{**r, "anomaly_score": 0.0, "is_anomaly": False} for r in rows]
        X = self._extract_features(rows)
        if X is None:
            return rows
        X_scaled = self.scaler.transform(X)
        scores = self.model.decision_function(X_scaled)   # lower = more anomalous
        labels = self.model.predict(X_scaled)             # -1 = anomaly, 1 = normal
        result = []
        for i, r in enumerate(rows):
            normalized_score = float(1 / (1 + math.exp(scores[i])))   # sigmoid, higher = anomalous
            result.append({
                **r,
                "anomaly_score": round(normalized_score, 4),
                "is_anomaly": bool(labels[i] == -1),
            })
        return result

    def get_anomaly_periods(self, scored_rows: List[dict]) -> List[dict]:
        """Aggregate anomalous rows into time periods."""
        anomalies = [r for r in scored_rows if r.get("is_anomaly")]
        if not anomalies:
            return []
        # Group into periods (gap > 10 min = new period)
        periods = []
        start = anomalies[0]["timestamp"]
        prev_ts = _parse_ts(anomalies[0]["timestamp"])
        for r in anomalies[1:]:
            try:
                ts = _parse_ts(r["timestamp"])
            except ValueError:
                continue
            if (ts - prev_ts).total_seconds() > 600:
                periods.append({"start": start, "end": anomalies[anomalies.index(r) - 1]["timestamp"]})
                start = r["timestamp"]
            prev_ts = ts
        periods.append({"start": start, "end": anomalies[-1]["timestamp"]})
        return periods


# ---------------------------------------------------------------------------
# Model 4: Resource Saturation Point
# ---------------------------------------------------------------------------

class SaturationModel:
    """
    Fits linear regression: cpu_percent = m * concurrent_requests + b per service.
    Solves for concurrent_requests when cpu_percent = 95 (saturation point).
    """

    def __init__(self):
        self.models: Dict[str, LinearRegression] = {}
        self.saturation_points: Dict[str, int] = {}
        self.memory_saturation: Dict[str, int] = {}

    def fit(self, rows: List[dict]):
        by_service: Dict[str, List] = defaultdict(list)
        for r in rows:
            if r.get("concurrent_requests") and r.get("cpu_percent") and r.get("memory_percent"):
                by_service[r["target_service"]].append(
                    (r["concurrent_requests"], r["cpu_percent"], r["memory_percent"])
                )

        for svc, pts in by_service.items():
            if len(pts) < 10:
                continue
            loads  = np.array([p[0] for p in pts]).reshape(-1, 1)
            cpus   = np.array([p[1] for p in pts])
            mems   = np.array([p[2] for p in pts])

            cpu_model = LinearRegression().fit(loads, cpus)
            mem_model = LinearRegression().fit(loads, mems)
            self.models[svc] = {"cpu": cpu_model, "mem": mem_model}

            # Saturation: when does predicted value hit 95%?
            m_cpu = cpu_model.coef_[0]
            b_cpu = cpu_model.intercept_
            if m_cpu > 0:
                self.saturation_points[svc] = int((95 - b_cpu) / m_cpu)

            m_mem = mem_model.coef_[0]
            b_mem = mem_model.intercept_
            if m_mem > 0:
                self.memory_saturation[svc] = int((95 - b_mem) / m_mem)

        return self

    def get_saturation_info(self) -> List[dict]:
        result = []
        for svc in self.saturation_points:
            result.append({
                "service": svc,
                "cpu_saturation_at_requests": max(0, self.saturation_points[svc]),
                "memory_saturation_at_requests": max(0, self.memory_saturation.get(svc, 0)),
            })
        return sorted(result, key=lambda x: x["cpu_saturation_at_requests"])


# ---------------------------------------------------------------------------
# Retry Amplification Insight
# ---------------------------------------------------------------------------

def compute_retry_amplification(rows: List[dict]) -> dict:
    """
    Compute how much hidden load retries add to the system.
    actual_load = visible_requests * (1 + avg_retry_count)
    """
    total_requests = len(rows)
    total_retries  = sum(r.get("retry_count") or 0 for r in rows)
    if total_requests == 0:
        return {"amplification_factor": 1.0, "total_retries": 0}
    avg_retries = total_retries / total_requests
    amplification = 1.0 + avg_retries

    # Find peak period retries
    peak_rows = [r for r in rows if (r.get("concurrent_requests") or 0) >= 1200]
    peak_retries = sum(r.get("retry_count") or 0 for r in peak_rows)
    peak_amp = 1.0 + (peak_retries / max(len(peak_rows), 1))

    return {
        "amplification_factor": round(amplification, 2),
        "peak_amplification_factor": round(peak_amp, 2),
        "total_retries": total_retries,
        "total_requests": total_requests,
    }


# ---------------------------------------------------------------------------
# Risk Score (0-100) per service
# ---------------------------------------------------------------------------

def compute_risk_scores(
    rows: List[dict],
    cascade_model: CascadeModel,
    saturation_model: SaturationModel,
) -> Dict[str, int]:
    """
    Composite risk score based on:
      - Historical failure rate (40%)
      - Number of services that cascade from this one (30%)
      - How close saturation point is to current peak load (30%)
    """
    peak_load = max((r.get("concurrent_requests") or 0) for r in rows) if rows else 1000
    services = list({r["target_service"] for r in rows})
    scores = {}

    for svc in services:
        # Component 1: failure rate
        fail_rate = cascade_model.failure_rates.get(svc, 0)
        failure_score = min(100, fail_rate * 200)   # 50% fail rate → 100 score

        # Component 2: cascade impact (how many services depend on this)
        cascade_count = len(cascade_model.co_occurrence.get(svc, {}))
        cascade_score = min(100, cascade_count * 25)

        # Component 3: proximity to saturation
        sat_point = saturation_model.saturation_points.get(svc, 9999)
        proximity = peak_load / max(sat_point, 1)
        saturation_score = min(100, proximity * 80)

        composite = (
            0.40 * failure_score +
            0.30 * cascade_score +
            0.30 * saturation_score
        )
        scores[svc] = min(100, int(composite))

    return scores
