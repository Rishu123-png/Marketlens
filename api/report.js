export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const { stock, metrics } = req.body || {};
  if (!stock || !metrics) return res.status(400).json({ error: 'stock and metrics are required' });
  const key = process.env.GROQ_API_KEY;
  if (!key) return res.status(503).json({ error: 'AI report service is not configured.' });
  const prompt = `Create a cautious, educational stock research summary. Never guarantee returns and never invent values. Stock: ${stock}. Verified metrics: ${JSON.stringify(metrics)}. Return JSON with summary, positives, risks, timeframe, and whatToMonitor.`;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', { method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`}, body:JSON.stringify({ model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile', temperature:0.2, response_format:{type:'json_object'}, messages:[{role:'system',content:'You are a careful financial education assistant.'},{role:'user',content:prompt}] }) });
    const data = await r.json(); if (!r.ok) return res.status(r.status).json({error:'AI provider error', details:data});
    return res.status(200).json(JSON.parse(data.choices?.[0]?.message?.content || '{}'));
  } catch { return res.status(502).json({ error:'Unable to generate report.' }); }
}
