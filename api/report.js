export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "POST required."
    });
  }

  const {
    stock,
    metrics
  } = req.body || {};

  if (
    typeof stock !== "string" ||
    !stock.trim() ||
    !metrics ||
    typeof metrics !== "object" ||
    Array.isArray(metrics)
  ) {
    return res.status(400).json({
      error:
        "A valid stock and metrics object are required."
    });
  }

  const apiKey =
    process.env.GROQ_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      error:
        "AI report service is not configured."
    });
  }

  const verifiedMetrics =
    Object.fromEntries(
      Object.entries(metrics).filter(
        ([, value]) =>
          value === null ||
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
      )
    );

  const prompt = `
Create a cautious educational stock research summary.

Important rules:
- Never guarantee returns.
- Never invent market data.
- Use only the verified metrics supplied below.
- Clearly explain uncertainty.
- Do not present the response as personalized financial advice.

Stock:
${stock.trim()}

Verified metrics:
${JSON.stringify(
  verifiedMetrics
)}

Return valid JSON with exactly these keys:
summary,
positives,
risks,
timeframe,
whatToMonitor
`;

  try {
    const response =
      await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Authorization:
              `Bearer ${apiKey}`
          },

          body: JSON.stringify({
            model:
              process.env.GROQ_MODEL ||
              "llama-3.3-70b-versatile",

            temperature: 0.2,

            response_format: {
              type: "json_object"
            },

            messages: [
              {
                role: "system",

                content:
                  "You are a careful financial education assistant. Never invent facts or prices."
              },

              {
                role: "user",

                content: prompt
              }
            ]
          })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      return res.status(
        response.status
      ).json({
        error:
          "AI provider error.",

        details:
          data?.error?.message ||
          data?.error ||
          "Unknown Groq error."
      });
    }

    const content =
      data?.choices?.[0]?.message
        ?.content;

    if (!content) {
      return res.status(502).json({
        error:
          "AI provider returned an empty response."
      });
    }

    let report;

    try {
      report = JSON.parse(content);
    } catch {
      return res.status(502).json({
        error:
          "AI provider returned invalid JSON."
      });
    }

    return res.status(200).json(
      report
    );
  } catch (error) {
    return res.status(502).json({
      error:
        "Unable to generate report.",

      details:
        error instanceof Error
          ? error.message
          : "Unknown error."
    });
  }
}