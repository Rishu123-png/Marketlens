async function load() {
  setLoading(true);
  setError('');

  try {
    const results = await Promise.allSettled(
      symbols.map(async (symbol) => {
        const response = await fetch(
          `/api/market?symbol=${encodeURIComponent(symbol)}`
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || 'Market data unavailable'
          );
        }

        return data;
      })
    );

    const successful = results
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);

    const failed = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason?.message)
      .filter(Boolean);

    setStocks(successful);

    if (!successful.length) {
      setError(
        failed[0] ||
        'No market-data provider returned usable quotes.'
      );
    } else if (failed.length) {
      setError(
        `${successful.length} of ${symbols.length} quotes loaded. Some symbols are temporarily unavailable.`
      );
    }
  } catch (error) {
    setStocks([]);

    setError(
      error instanceof Error
        ? error.message
        : 'Market data unavailable'
    );
  } finally {
    setLoading(false);
  }
}