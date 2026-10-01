import { useState, useEffect, useRef, useCallback } from 'react';
import Head from 'next/head';

const INTERVALS = ['1m','5m','15m','1h','4h','1d'];

// Direction color palette
function lineColor(type, direction, score) {
  if (type === 'gray') return 'rgba(80,80,100,0.12)';
  if (type === 'btc')  return 'rgba(255,200,0,0.85)';
  const strength = Math.min(1, 0.5 + (score / 10) * 0.5);
  if (direction === 'up')   return `rgba(0,${Math.round(180*strength+75)},${Math.round(80*strength)},0.92)`;
  if (direction === 'down') return `rgba(${Math.round(200*strength+55)},${Math.round(30*strength)},${Math.round(60*strength)},0.92)`;
  return `rgba(255,140,0,0.85)`;
}

function lineWidth(type, score) {
  if (type === 'gray') return 0.8;
  if (type === 'btc')  return 2;
  return Math.min(3.5, 1.5 + score * 0.3);
}

export default function Home() {
  const canvasRef    = useRef(null);
  const [interval, setIntervalVal] = useState('15m');
  const [data, setData]            = useState(null);
  const [loading, setLoading]      = useState(false);
  const [error, setError]          = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [hoveredCoin, setHoveredCoin] = useState(null);
  const [tab, setTab] = useState('up');

  const scan = useCallback(async (iv = interval) => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`/api/scan?interval=${iv}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setData(json);
      setLastUpdated(new Date());
    } catch(e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [interval]);

  useEffect(() => { scan(); }, []);
  useEffect(() => {
    if (!autoRefresh) return;
    const intervalMs = {
      '1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000
    }[interval] || 900000;
    const id = setInterval(() => scan(), intervalMs);
    return () => clearInterval(id);
  }, [autoRefresh, interval, scan]);

  // Draw spaghetti chart on canvas
  useEffect(() => {
    if (!data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext('2d');
    const dpr    = window.devicePixelRatio || 1;
    const W      = canvas.offsetWidth;
    const H      = canvas.offsetHeight;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, W, H);

    const PAD = { top: 30, right: 20, bottom: 40, left: 55 };
    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top  - PAD.bottom;

    // Find global min/max across all lines
    let globalMin =  Infinity;
    let globalMax = -Infinity;
    let globalMinTime = Infinity;
    let globalMaxTime = -Infinity;

    for (const line of data.chartLines) {
      if (!line.pctChange.length) continue;
      for (const v of line.pctChange) {
        if (v < globalMin) globalMin = v;
        if (v > globalMax) globalMax = v;
      }
      for (const t of line.timestamps) {
        if (t < globalMinTime) globalMinTime = t;
        if (t > globalMaxTime) globalMaxTime = t;
      }
    }

    const pad = (globalMax - globalMin) * 0.08;
    globalMin -= pad; globalMax += pad;
    const yRange = globalMax - globalMin || 1;
    const xRange = globalMaxTime - globalMinTime || 1;

    const toX = t => PAD.left + ((t - globalMinTime) / xRange) * chartW;
    const toY = v => PAD.top  + (1 - (v - globalMin) / yRange) * chartH;

    // Grid lines
    const ySteps = 6;
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= ySteps; i++) {
      const v = globalMin + (yRange / ySteps) * i;
      const y = toY(v);
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + chartW, y); ctx.stroke();

      ctx.fillStyle = 'rgba(180,180,200,0.5)';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(v.toFixed(1) + '%', PAD.left - 6, y + 3);
    }

    // Zero line
    const zeroY = toY(0);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.setLineDash([5, 5]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD.left, zeroY); ctx.lineTo(PAD.left + chartW, zeroY); ctx.stroke();
    ctx.setLineDash([]);

    // X axis labels
    const xSteps = 5;
    ctx.fillStyle = 'rgba(180,180,200,0.5)';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i <= xSteps; i++) {
      const t = globalMinTime + (xRange / xSteps) * i;
      const x = toX(t);
      const d = new Date(t);
      const label = d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
      ctx.fillText(label, x, H - 10);
    }

    // Draw lines: gray first, then signals on top
    const grays   = data.chartLines.filter(l => l.type === 'gray');
    const signals = data.chartLines.filter(l => l.type !== 'gray');

    for (const line of [...grays, ...signals]) {
      if (!line.timestamps.length) continue;
      ctx.beginPath();
      ctx.strokeStyle = lineColor(line.type, line.direction, line.score);
      ctx.lineWidth   = lineWidth(line.type, line.score);
      ctx.lineJoin    = 'round';

      let started = false;
      for (let i = 0; i < line.timestamps.length; i++) {
        const x = toX(line.timestamps[i]);
        const y = toY(line.pctChange[i]);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else            ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Axis border
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD.left, PAD.top, chartW, chartH);

  }, [data]);

  const upCoins   = data?.signals.filter(s => s.direction === 'up')      || [];
  const downCoins = data?.signals.filter(s => s.direction === 'down')    || [];
  const neutCoins = data?.signals.filter(s => s.direction === 'neutral') || [];
  const visibleCoins = tab === 'up' ? upCoins : tab === 'down' ? downCoins : neutCoins;

  return (
    <>
      <Head>
        <title>Crypto Pre-Move Scanner</title>
        <meta name="description" content="Real-time crypto breakout scanner — hidden accumulation, relative strength, volatility squeeze" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </Head>

      <div className="app">
        {/* ── HEADER ── */}
        <header className="header">
          <div className="header-left">
            <div className="logo">
              <span className="logo-icon">⚡</span>
              <span className="logo-text">CryptoScanner</span>
            </div>
            {data && (
              <div className="stats-pills">
                <span className="pill pill-neutral">Scanned {data.scanned}</span>
                <span className="pill pill-up">▲ {data.upCount} Up</span>
                <span className="pill pill-down">▼ {data.downCount} Down</span>
              </div>
            )}
          </div>

          <div className="header-right">
            <div className="interval-selector">
              {INTERVALS.map(iv => (
                <button
                  key={iv}
                  className={`iv-btn ${interval === iv ? 'active' : ''}`}
                  onClick={() => { setIntervalVal(iv); scan(iv); }}
                >
                  {iv}
                </button>
              ))}
            </div>

            <button
              className={`auto-btn ${autoRefresh ? 'on' : ''}`}
              onClick={() => setAutoRefresh(p => !p)}
              title="Auto refresh"
            >
              {autoRefresh ? '⏸ Live' : '▶ Auto'}
            </button>

            <button
              className={`scan-btn ${loading ? 'loading' : ''}`}
              onClick={() => scan()}
              disabled={loading}
            >
              {loading ? <span className="spinner" /> : '⟳ Scan'}
            </button>
          </div>
        </header>

        {/* ── MAIN ── */}
        <main className="main">
          {/* CHART PANEL */}
          <section className="chart-panel">
            <div className="chart-title">
              {loading && <span className="loading-bar" />}
              <span>Performance Chart — {interval} candles</span>
              {lastUpdated && (
                <span className="last-updated">
                  Updated {lastUpdated.toLocaleTimeString()}
                </span>
              )}
            </div>
            <div className="chart-legend">
              <span className="legend-item legend-gray">■ No Signal</span>
              <span className="legend-item legend-up">■ Upside Signal</span>
              <span className="legend-item legend-down">■ Downside Signal</span>
              <span className="legend-item legend-btc">-- BTC Reference</span>
            </div>
            <div className="canvas-wrap">
              {!data && !loading && (
                <div className="empty-state">
                  <div className="empty-icon">📡</div>
                  <p>Click Scan to load market data</p>
                </div>
              )}
              {loading && !data && (
                <div className="empty-state">
                  <div className="pulse-loader" />
                  <p>Scanning 300 coins...</p>
                </div>
              )}
              <canvas ref={canvasRef} className="chart-canvas" />
            </div>
            {error && <div className="error-bar">⚠ {error}</div>}
          </section>

          {/* SIGNALS PANEL */}
          <aside className="signals-panel">
            <div className="signals-header">
              <h2>Signals</h2>
              <div className="tab-row">
                <button className={`tab ${tab==='up'?'active-up':''}`}    onClick={()=>setTab('up')}>
                  ▲ Up ({upCoins.length})
                </button>
                <button className={`tab ${tab==='down'?'active-down':''}`} onClick={()=>setTab('down')}>
                  ▼ Down ({downCoins.length})
                </button>
                <button className={`tab ${tab==='?'?'active-neut':''}`}   onClick={()=>setTab('?')}>
                  ◆ Coil ({neutCoins.length})
                </button>
              </div>
            </div>

            <div className="coin-list">
              {loading && (
                <div className="skeleton-list">
                  {[...Array(8)].map((_,i)=>(<div key={i} className="skeleton-card"/>))}
                </div>
              )}
              {!loading && visibleCoins.length === 0 && (
                <div className="no-signals">
                  {data ? 'No signals in this category' : 'Run a scan to see signals'}
                </div>
              )}
              {!loading && visibleCoins.map(coin => (
                <div
                  key={coin.symbol}
                  className={`coin-card ${coin.direction}`}
                  onMouseEnter={() => setHoveredCoin(coin.symbol)}
                  onMouseLeave={() => setHoveredCoin(null)}
                >
                  <div className="coin-top">
                    <span className="coin-name">{coin.symbol.replace('USDT','')}</span>
                    <span className={`score-badge score-${Math.min(coin.score, 8)}`}>
                      {coin.score}/10
                    </span>
                  </div>
                  <div className="coin-signals">
                    {coin.signals.map((s, i) => (
                      <span key={i} className="signal-tag">{s}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </main>
      </div>

      <style jsx global>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; background: #080810; color: #e0e0f0; font-family: 'Inter', sans-serif; overflow: hidden; }
        @media (max-width: 768px) { html, body { overflow: auto; } }
      `}</style>

      <style jsx>{`
        .app { display: flex; flex-direction: column; height: 100vh; background: #080810; }

        /* ── HEADER ── */
        .header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 16px; border-bottom: 1px solid rgba(255,255,255,0.07);
          background: rgba(10,10,20,0.95); backdrop-filter: blur(12px);
          flex-shrink: 0; gap: 12px; flex-wrap: wrap;
        }
        .header-left  { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
        .header-right { display: flex; align-items: center; gap: 8px;  flex-wrap: wrap; }

        .logo { display: flex; align-items: center; gap: 8px; }
        .logo-icon { font-size: 20px; }
        .logo-text { font-size: 16px; font-weight: 700; letter-spacing: -0.3px;
                     background: linear-gradient(135deg, #a78bfa, #60a5fa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }

        .stats-pills { display: flex; gap: 6px; flex-wrap: wrap; }
        .pill { font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 20px; }
        .pill-neutral { background: rgba(255,255,255,0.07); color: #aaa; }
        .pill-up   { background: rgba(0,220,100,0.15); color: #00dc64; border: 1px solid rgba(0,220,100,0.3); }
        .pill-down { background: rgba(255,50,80,0.15);  color: #ff3250; border: 1px solid rgba(255,50,80,0.3); }

        .interval-selector { display: flex; background: rgba(255,255,255,0.05); border-radius: 8px; padding: 3px; gap: 2px; }
        .iv-btn { font-size: 11px; font-weight: 600; padding: 4px 9px; border: none; border-radius: 6px;
                  cursor: pointer; background: transparent; color: rgba(255,255,255,0.45); font-family: 'JetBrains Mono', monospace;
                  transition: all 0.15s; }
        .iv-btn:hover  { color: #fff; background: rgba(255,255,255,0.08); }
        .iv-btn.active { color: #fff; background: rgba(120,80,255,0.5); }

        .auto-btn { font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 8px; border: none;
                    cursor: pointer; background: rgba(255,255,255,0.06); color: #aaa; transition: all 0.15s; }
        .auto-btn.on { background: rgba(0,200,100,0.2); color: #00dc64; border: 1px solid rgba(0,200,100,0.3); }

        .scan-btn { font-size: 13px; font-weight: 600; padding: 7px 16px; border-radius: 8px; border: none;
                    cursor: pointer; background: linear-gradient(135deg, #7c3aed, #2563eb);
                    color: #fff; transition: all 0.2s; display: flex; align-items: center; gap: 6px; }
        .scan-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 15px rgba(124,58,237,0.4); }
        .scan-btn.loading { opacity: 0.7; cursor: not-allowed; }
        .spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3);
                   border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* ── MAIN ── */
        .main { display: flex; flex: 1; overflow: hidden; gap: 0; }
        @media (max-width: 768px) { .main { flex-direction: column; overflow: auto; } }

        /* ── CHART ── */
        .chart-panel { flex: 1; display: flex; flex-direction: column; padding: 12px; overflow: hidden; }
        .chart-title { display: flex; align-items: center; gap: 10px; font-size: 12px; font-weight: 500;
                       color: rgba(255,255,255,0.5); margin-bottom: 6px; position: relative; }
        .loading-bar { position: absolute; bottom: -2px; left: 0; height: 2px; width: 100%;
                       background: linear-gradient(90deg, #7c3aed, #2563eb, #7c3aed);
                       background-size: 200%; animation: shimmer 1.2s linear infinite; border-radius: 2px; }
        @keyframes shimmer { to { background-position: -200% center; } }
        .last-updated { margin-left: auto; font-size: 11px; color: rgba(255,255,255,0.25); font-family: 'JetBrains Mono', monospace; }

        .chart-legend { display: flex; gap: 14px; margin-bottom: 8px; flex-wrap: wrap; }
        .legend-item { font-size: 11px; color: rgba(255,255,255,0.35); display: flex; align-items: center; gap: 5px; }
        .legend-gray { color: rgba(150,150,180,0.5); }
        .legend-up   { color: #00dc64; }
        .legend-down { color: #ff3250; }
        .legend-btc  { color: #ffc800; }

        .canvas-wrap { flex: 1; position: relative; border-radius: 12px; overflow: hidden;
                       border: 1px solid rgba(255,255,255,0.06); background: #0a0a12;
                       min-height: 300px; }
        @media (max-width: 768px) { .canvas-wrap { min-height: 280px; height: 280px; } }

        .chart-canvas { width: 100%; height: 100%; display: block; }

        .empty-state { position: absolute; inset: 0; display: flex; flex-direction: column;
                       align-items: center; justify-content: center; gap: 12px; color: rgba(255,255,255,0.2); }
        .empty-icon { font-size: 40px; }
        .pulse-loader { width: 40px; height: 40px; border-radius: 50%;
                        border: 3px solid rgba(124,58,237,0.3); border-top-color: #7c3aed;
                        animation: spin 1s linear infinite; }

        .error-bar { margin-top: 8px; padding: 8px 12px; background: rgba(255,50,80,0.1);
                     border: 1px solid rgba(255,50,80,0.3); border-radius: 8px; font-size: 12px; color: #ff6080; }

        /* ── SIGNALS ── */
        .signals-panel { width: 280px; flex-shrink: 0; display: flex; flex-direction: column;
                         border-left: 1px solid rgba(255,255,255,0.06); background: rgba(10,10,20,0.6);
                         overflow: hidden; }
        @media (max-width: 768px) { .signals-panel { width: 100%; border-left: none; border-top: 1px solid rgba(255,255,255,0.06); } }

        .signals-header { padding: 12px 14px 0; flex-shrink: 0; }
        .signals-header h2 { font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.6); margin-bottom: 10px; }

        .tab-row { display: flex; gap: 4px; margin-bottom: 10px; }
        .tab { font-size: 11px; font-weight: 600; padding: 5px 10px; border-radius: 8px; border: none;
               cursor: pointer; background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.4); transition: all 0.15s; }
        .tab.active-up   { background: rgba(0,220,100,0.15); color: #00dc64; border: 1px solid rgba(0,220,100,0.25); }
        .tab.active-down { background: rgba(255,50,80,0.15);  color: #ff3250; border: 1px solid rgba(255,50,80,0.25); }
        .tab.active-neut { background: rgba(255,140,0,0.15);  color: #ffa040; border: 1px solid rgba(255,140,0,0.25); }

        .coin-list { flex: 1; overflow-y: auto; padding: 0 10px 12px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent; }

        .skeleton-list { display: flex; flex-direction: column; gap: 8px; }
        .skeleton-card { height: 64px; border-radius: 10px; background: rgba(255,255,255,0.04); animation: pulse 1.4s ease-in-out infinite; }
        @keyframes pulse { 0%,100%{opacity:0.4} 50%{opacity:0.8} }

        .no-signals { display: flex; align-items: center; justify-content: center; height: 100px;
                      font-size: 12px; color: rgba(255,255,255,0.2); text-align: center; }

        .coin-card { padding: 10px 12px; border-radius: 10px; margin-bottom: 7px; cursor: pointer;
                     transition: all 0.15s; border: 1px solid transparent; }
        .coin-card.up      { background: rgba(0,220,100,0.07);  border-color: rgba(0,220,100,0.15); }
        .coin-card.down    { background: rgba(255,50,80,0.07);   border-color: rgba(255,50,80,0.15); }
        .coin-card.neutral { background: rgba(255,140,0,0.07);   border-color: rgba(255,140,0,0.15); }
        .coin-card:hover   { transform: translateX(3px); filter: brightness(1.2); }

        .coin-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
        .coin-name { font-size: 13px; font-weight: 700; font-family: 'JetBrains Mono', monospace; color: #fff; }

        .score-badge { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 20px; }
        .score-4 { background: rgba(255,255,255,0.1); color: #aaa; }
        .score-5, .score-6 { background: rgba(255,165,0,0.2); color: #ffa040; }
        .score-7, .score-8 { background: rgba(124,58,237,0.3); color: #c084fc; }

        .coin-signals { display: flex; flex-direction: column; gap: 3px; }
        .signal-tag { font-size: 10px; color: rgba(255,255,255,0.45); line-height: 1.3; }
      `}</style>
    </>
  );
}
