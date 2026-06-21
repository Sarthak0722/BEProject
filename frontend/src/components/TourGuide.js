import React, { useState, useEffect, useRef } from 'react';
import './TourGuide.css';

const STEPS = [
  {
    title: 'Welcome to Kendra',
    body: 'A real-time microservice failure propagation simulator powered by ML. This 8-step tour walks you through every feature. Press Skip anytime to exit.',
    target: null,
    side: 'center',
    icon: '◉',
  },
  {
    title: 'Monitoring vs Simulation',
    body: 'These two buttons switch the entire product mode. Monitoring = observe live service health and ML insights. Simulation = inject faults and predict failures. Switching back to Monitoring automatically resets all injected faults.',
    target: '.mode-toggle',
    side: 'bottom',
    icon: '⚡',
  },
  {
    title: 'Live Service Topology',
    body: 'The graph shows all 6 microservices and their call dependencies in real time. Green = healthy, amber = degraded, red = failed. Edges represent which service calls which. In Simulation mode, click any node to inject faults.',
    target: '.graph-section',
    side: 'left',
    icon: '◎',
  },
  {
    title: 'System Status Panel',
    body: 'Scoreboard for all services — healthy / degraded / failed count at a glance. Each card shows the service name and current health. In Simulation mode, it also shows exactly which faults are active on each service.',
    target: '.right-sidebar',
    side: 'left',
    icon: '⊕',
  },
  {
    title: 'ML Insights (Monitoring Mode)',
    body: 'Trained on 194,000 real BBD Flipkart log rows. Shows risk scores per service (0–100), CPU saturation req/s for each, retry amplification factor (hidden load), and detected anomaly time windows.',
    target: '.left-sidebar',
    side: 'right',
    icon: '🧠',
  },
  {
    title: 'Load Simulator (Simulation Mode)',
    body: 'Switch to Simulation mode to see this slider. Drag it to simulate 0–2,000 concurrent users. The ML load-latency model predicts which services degrade or fail at that traffic level — the graph updates instantly.',
    target: '.left-sidebar',
    side: 'right',
    icon: '⬆',
  },
  {
    title: 'Fault Injection',
    body: 'In Simulation mode, click any service node on the graph. A panel opens with 3 controls: Total Failure toggle (100% 500 errors), Inject Latency slider (0–5000ms), and Error Rate slider (0–100%). The ML cascade model immediately predicts which downstream services will be affected.',
    target: '.graph-section',
    side: 'left',
    icon: '⚠',
  },
  {
    title: 'Analyze Logs & Adapter',
    body: "Click 'Analyze Logs' to upload your own production logs and retrain all 4 ML models. Use the adapter config to map any log format — Datadog, CloudWatch, Nginx — to our schema. Just change the field names, nothing else.",
    target: '.analyze-btn',
    side: 'bottom-left',
    icon: '⬆',
  },
  {
    title: "You're all set!",
    body: "Try this: click 'Simulation', click the Auth Service node, drag the latency slider to 1500ms, and watch the cascade prediction appear. Then switch back to Monitoring — everything resets.",
    target: null,
    side: 'center',
    icon: '✓',
  },
];

const PAD = 16; // padding around the highlighted element

const TourGuide = ({ onDone }) => {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);
  const tooltipRef = useRef(null);

  const current = STEPS[step];
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;

  useEffect(() => {
    if (current.target) {
      const el = document.querySelector(current.target);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({
          top: r.top - PAD,
          left: r.left - PAD,
          width: r.width + PAD * 2,
          height: r.height + PAD * 2,
        });
        return;
      }
    }
    setRect(null);
  }, [step, current.target]);

  const tooltipStyle = () => {
    if (!rect) {
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    const tip = { position: 'fixed', maxWidth: 340 };

    switch (current.side) {
      case 'bottom':
        return { ...tip, top: rect.top + rect.height + 14, left: Math.max(12, rect.left + rect.width / 2 - 170) };
      case 'left':
        return { ...tip, top: Math.max(12, rect.top + rect.height / 2 - 100), left: Math.max(12, rect.left - 356) };
      case 'right':
        return { ...tip, top: Math.max(12, rect.top + rect.height / 2 - 100), left: Math.min(w - 356, rect.left + rect.width + 14) };
      case 'bottom-left':
        return { ...tip, top: rect.top + rect.height + 14, left: Math.max(12, rect.left + rect.width - 340) };
      default:
        return { ...tip, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    }
  };

  return (
    <div className="tour-overlay">
      {/* Dark mask with spotlight cutout */}
      {rect && (
        <svg className="tour-mask" width="100%" height="100%">
          <defs>
            <mask id="spotlight">
              <rect width="100%" height="100%" fill="white" />
              <rect
                x={rect.left} y={rect.top}
                width={rect.width} height={rect.height}
                rx="10" fill="black"
              />
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="rgba(0,0,0,0.68)" mask="url(#spotlight)" />
          {/* Glowing border around spotlight */}
          <rect
            x={rect.left} y={rect.top}
            width={rect.width} height={rect.height}
            rx="10" fill="none"
            stroke="#3b82f6" strokeWidth="2"
            className="tour-spotlight-border"
          />
        </svg>
      )}

      {/* Dark overlay when no spotlight */}
      {!rect && <div className="tour-dark-bg" />}

      {/* Tooltip */}
      <div className="tour-tooltip" style={tooltipStyle()} ref={tooltipRef}>
        <div className="tour-step-counter">
          {STEPS.map((_, i) => (
            <div key={i} className={`tour-dot ${i === step ? 'active' : i < step ? 'done' : ''}`} />
          ))}
        </div>

        <div className="tour-icon">{current.icon}</div>
        <div className="tour-title">{current.title}</div>
        <div className="tour-body">{current.body}</div>

        <div className="tour-actions">
          <button className="tour-skip" onClick={onDone}>
            Skip tour
          </button>
          <div className="tour-nav">
            {!isFirst && (
              <button className="tour-prev" onClick={() => setStep(s => s - 1)}>
                ← Back
              </button>
            )}
            <button className="tour-next" onClick={isLast ? onDone : () => setStep(s => s + 1)}>
              {isLast ? 'Start exploring →' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TourGuide;
