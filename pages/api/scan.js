// pages/api/scan.js  —  Server-side scanner
export const maxDuration = 60; // Allow up to 60s for 300 coins on Vercel


const CANDLES = 100;
const OBV_SLOPE_MIN     = 0.02;   // Standard balanced threshold
const PRICE_FLAT_MAX    = 0.002;  // Standard balanced threshold
const SQUEEZE_TIGHT     = 0.012;
const STEALTH_VOL_RATIO = 1.8;
const STEALTH_PRICE_MAX = 0.005;
const RS_THRESHOLD      = 0.4;
const MIN_SCORE         = 4;      // Standard balanced threshold


async function fetchJSON(url) {
  const res = await fetch(url, { 
    cache: 'no-store',
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  return res.json();
}

// Hardcoded Breakout.com crypto symbols → Binance USDT pairs
const BREAKOUT_SYMBOLS = [
  'AAVEUSDT','ADAUSDT','AIXBTUSDT','ALGOUSDT','APTUSDT',
  'ARBUSDT','ATOMUSDT','AVAXUSDT','BCHUSDT','BNBUSDT',
  'BONKUSDT','BTCUSDT','CRVUSDT','DOGEUSDT','DOTUSDT',
  'ENAUSDT','ETCUSDT','ETHUSDT','ETHFIUSDT','FARTCOINUSDT',
  'FILUSDT','FLOKIUSDT','GRASSUSDT','HBARUSDT','HYPEUSDT',
  'ICPUSDT','INJUSDT','JTOUSDT','JUPUSDT','KAITOUSDT',
  'LDOUSDT','LINKUSDT','LITUSDT','LTCUSDT','MOODENGUSDT',
  'NEARUSDT','ONDOUSDT','OPUSDT','ORDIUSDT','PENDLEUSDT',
  'PENGUUSDT','PEPEUSDT','PNUTUSDT','POLUSDT','POPCATUSDT',
  'PUMPUSDT','RENDERUSDT','SHIBUSDT','SOLUSDT','STXUSDT',
  'SUIUSDT','TAOUSDT','TIAUSDT','TRUMPUSDT','TRXUSDT',
  'UNIUSDT','VIRTUALUSDT','WIFUSDT','WLDUSDT','XLMUSDT',
  'XRPUSDT','ZECUSDT','ZROUSDT',
];

async function getSymbols(limit = 300) {
  try {
    const data = await fetchJSON('https://api.binance.com/api/v3/ticker/24hr');
    // Guard: Binance sometimes returns an error object instead of array (rate limit etc)
    if (!Array.isArray(data)) {
      console.warn('Binance ticker API returned non-array, using fallback symbol list');
      return BREAKOUT_SYMBOLS; // skip validation, use all
    }
    
    // Sort and filter top 300 USDT pairs
    return data
      .filter(d => 
        d.symbol.endsWith('USDT') && 
        !d.symbol.includes('UPUSDT') && 
        !d.symbol.includes('DOWNUSDT') &&
        parseFloat(d.quoteVolume) > 1_000_000
      )
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, limit)
      .map(d => d.symbol);
      
  } catch (e) {
    console.warn('getSymbols error, using fallback list:', e.message);
    return BREAKOUT_SYMBOLS;
  }
}

async function getKlines(symbol, interval) {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${CANDLES}`;
    const data = await fetchJSON(url);
    if (!Array.isArray(data) || data.length < 30) return null;
    return data.map(c => ({
      time:   parseInt(c[0]),
      open:   parseFloat(c[1]),
      high:   parseFloat(c[2]),
      low:    parseFloat(c[3]),
      close:  parseFloat(c[4]),
      volume: parseFloat(c[5]),
    }));
  } catch { return null; }
}

function computeOBV(candles) {
  const obv = [0];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i-1].close)
      obv.push(obv[obv.length-1] + candles[i].volume);
    else if (candles[i].close < candles[i-1].close)
      obv.push(obv[obv.length-1] - candles[i].volume);
    else
      obv.push(obv[obv.length-1]);
  }
  return obv;
}

function linSlope(arr) {
  const n = arr.length;
  const xMean = (n - 1) / 2;
  const yMean = arr.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (arr[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function detectSignals(candles, btcCandles) {
  const signals = [];
  let score = 0, upVotes = 0, downVotes = 0;
  if (candles.length < 30) return null;

  const closes  = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const obv     = computeOBV(candles);
  const avgVol  = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const avgClose = closes.reduce((a, b) => a + b, 0) / closes.length;

  const obvSlope   = linSlope(obv.slice(-10))   / (avgVol   + 1e-9);
  const priceSlope = linSlope(closes.slice(-10)) / (avgClose + 1e-9);

  if (obvSlope > OBV_SLOPE_MIN && Math.abs(priceSlope) < PRICE_FLAT_MAX) {
    signals.push('Hidden Accumulation (OBV rising, price flat)');
    score += 3; upVotes++;
  } else if (obvSlope < -OBV_SLOPE_MIN && Math.abs(priceSlope) < PRICE_FLAT_MAX) {
    signals.push('Hidden Distribution (OBV falling, price flat)');
    score += 3; downVotes++;
  }

  const last5  = candles.slice(-5);
  const ranges = last5.map(c => (c.high - c.low) / c.close);
  if (ranges.every((r, i) => i === 0 || r <= ranges[i-1]) &&
      ranges.reduce((a,b)=>a+b,0)/ranges.length < SQUEEZE_TIGHT) {
    signals.push(`Volatility Squeeze`);
    score += 1;
  }

  if (btcCandles && btcCandles.length >= 10) {
    const coinPerf = (closes.at(-1) - closes.at(-10)) / closes.at(-10) * 100;
    const btcClose = btcCandles.map(c => c.close);
    const btcPerf  = (btcClose.at(-1) - btcClose.at(-10)) / btcClose.at(-10) * 100;
    const rsDelta  = coinPerf - btcPerf;
    if      (rsDelta >  RS_THRESHOLD   && btcPerf < -0.1) { signals.push(`RS Strength vs BTC`); score += 3; upVotes++; }
    else if (rsDelta < -RS_THRESHOLD   && btcPerf >  0.1) { signals.push(`RS Weakness vs BTC`); score += 3; downVotes++; }
    else if (rsDelta >  RS_THRESHOLD*2)                   { signals.push(`Outperforming BTC +${rsDelta.toFixed(2)}%`); score += 1; upVotes++; }
    else if (rsDelta < -RS_THRESHOLD*2)                   { signals.push(`Underperforming BTC ${rsDelta.toFixed(2)}%`); score += 1; downVotes++; }
  }

  if (candles.length >= 13) {
    const recentVol = volumes.slice(-3).reduce((a,b)=>a+b,0) / 3;
    const priorVol  = volumes.slice(-13,-3).reduce((a,b)=>a+b,0) / 10;
    const volRatio  = recentVol / (priorVol + 1e-9);
    const pxChange  = Math.abs(closes.at(-1) - closes.at(-4)) / closes.at(-4);
    if (volRatio > STEALTH_VOL_RATIO && pxChange < STEALTH_PRICE_MAX) {
      signals.push(`Stealth Volume (${volRatio.toFixed(1)}x)`);
      score += 2; upVotes++;
    }
  }

  if (score < MIN_SCORE || !signals.length) return null;
  const direction = upVotes > downVotes ? 'up' : downVotes > upVotes ? 'down' : 'neutral';
  return { signals, score, direction };
}

export default async function handler(req, res) {
  const interval = req.query.interval || '15m';
  try {
    const symbols = await getSymbols();
    const allSyms = [...new Set([...symbols, 'BTCUSDT'])];

    const BATCH = 30;
    const allData = {};
    for (let i = 0; i < allSyms.length; i += BATCH) {
      const batch = allSyms.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(s => getKlines(s, interval).then(d => [s, d])));
      results.forEach(([sym, data]) => { allData[sym] = data; });
    }

    const btcCandles = allData['BTCUSDT'];
    const chartLines = [];
    const signalList = [];

    for (const symbol of symbols) {
      const candles = allData[symbol];
      if (!candles || candles.length < 30) continue;
      const startPrice = candles[0].close;
      const timestamps = candles.map(c => c.time);
      const pctChange  = candles.map(c => ((c.close - startPrice) / startPrice) * 100);
      const result     = detectSignals(candles, btcCandles);
      if (!result) {
        chartLines.push({ symbol, timestamps, pctChange, type: 'gray', score: 0, direction: null, signals: [] });
      } else {
        chartLines.push({ symbol, timestamps, pctChange, type: 'signal', ...result });
        signalList.push({ symbol, ...result });
      }
    }

    if (btcCandles) {
      const sp = btcCandles[0].close;
      chartLines.push({
        symbol: 'BTC', timestamps: btcCandles.map(c=>c.time),
        pctChange: btcCandles.map(c=>((c.close-sp)/sp)*100),
        type: 'btc', score: 0, direction: null, signals: [],
      });
    }

    signalList.sort((a, b) => b.score - a.score);
    res.json({
      ok: true, interval, scanned: symbols.length,
      signalCount: signalList.length,
      upCount:   signalList.filter(s=>s.direction==='up').length,
      downCount: signalList.filter(s=>s.direction==='down').length,
      signals: signalList,
      chartLines,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
