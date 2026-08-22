export function calculateTechnicalSnapshot(prices = []) {
  const values = prices.map(Number).filter(Number.isFinite);
  if (!values.length) return { trend: 'Unavailable', rsi: null, movingAverage: null };
  const average = values.reduce((a,b)=>a+b,0) / values.length;
  const changes = values.slice(1).map((v,i)=>v-values[i]);
  const gains = changes.filter(v=>v>0), losses = changes.filter(v=>v<0).map(Math.abs);
  const rs = losses.length ? (gains.reduce((a,b)=>a+b,0)/Math.max(gains.length,1))/(losses.reduce((a,b)=>a+b,0)/losses.length) : 99;
  const rsi = Math.round(100-(100/(1+rs)));
  return { trend: values.at(-1) >= average ? 'Above average' : 'Below average', rsi, movingAverage: Number(average.toFixed(2)) };
}
export function scoreResearch({fundamental=50, technical=50, valuation=50, risk=50}={}) {
  return Math.round(fundamental*.3 + technical*.3 + valuation*.2 + (100-risk)*.2);
}
export function researchLabel(score) { return score >= 75 ? 'Strong setup' : score >= 60 ? 'Constructive' : score >= 45 ? 'Watchlist' : 'Needs caution'; }
