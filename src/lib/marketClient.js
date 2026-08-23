export async function getMarketQuote(
  symbol
) {
  const response = await fetch(
    `/api/market?symbol=${encodeURIComponent(
      symbol
    )}`
  );

  const data =
    await response.json();

  if (!response.ok) {
    const details =
      Array.isArray(data.details)
        ? data.details
            .map((item) => {
              if (
                typeof item === "string"
              ) {
                return item;
              }

              return `${item.provider}: ${item.message}`;
            })
            .join(" | ")
        : "";

    throw new Error(
      details ||
        data.error ||
        "Market data unavailable"
    );
  }

  return data;
}

export async function generateReport(
  stock,
  metrics
) {
  const response =
    await fetch(
      "/api/report",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          stock,
          metrics
        })
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data.error ||
      "Report unavailable"
    );
  }

  return data;
}