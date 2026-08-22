export async function getMarketQuote(symbol) {
  const response = await fetch(`/api/market?symbol=${encodeURIComponent(symbol)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Market data unavailable');
  return data;
}
export async function searchStocks(query) {
  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Search unavailable');
  return data;
}
export async function generateReport(stock, metrics) {
  const response = await fetch('/api/report', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({stock,metrics}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Report unavailable');
  return data;
}
