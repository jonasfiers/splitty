const driver = require('./neo4j');

const today = () => new Date().toISOString().slice(0, 10);

async function getRateForDate(from, to, date = today()) {
  if (from === to) return 1;

  const { records } = await driver.executeQuery(
    `MATCH (r:DailyRate {date: $date, from: $from, to: $to}) RETURN r.rate AS rate`,
    { date, from, to }
  );
  if (records.length > 0) return Number(records[0].get('rate'));

  return fetchAndStore(from, to, date);
}

// Frankfurter: the ECB's reference rates, about 30 currencies. For the rest
// (TWD, VND, ARS, …) the daily rates of the open currency-api
// (github.com/fawazahmed0/exchange-api), the same day if it has it, else its
// latest. Whichever answers is kept, so a date is asked once.
async function fromFrankfurter(from, to, date) {
  const res = await fetch(`https://api.frankfurter.dev/v1/${date}?from=${from}&to=${to}`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null; // 404: a currency it doesn't have
  const rate = (await res.json()).rates?.[to];
  return rate == null ? null : Number(rate);
}

async function fromCurrencyApi(from, to, date) {
  const f = from.toLowerCase(), t = to.toLowerCase();
  const urls = [];
  for (const version of [date, 'latest']) {
    urls.push(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${version}/v1/currencies/${f}.json`);
    urls.push(`https://${version}.currency-api.pages.dev/v1/currencies/${f}.json`);
  }
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const rate = (await res.json())[f]?.[t];
      if (rate != null) return Number(rate);
    } catch { /* next source */ }
  }
  return null;
}

async function fetchAndStore(from, to, date) {
  let rate = null;
  try { rate = await fromFrankfurter(from, to, date); } catch { /* fall back */ }
  if (rate == null) rate = await fromCurrencyApi(from, to, date);
  if (rate == null) throw new Error(`No rate found for ${from}→${to}`);

  await driver.executeQuery(
    `MERGE (r:DailyRate {date: $date, from: $from, to: $to}) SET r.rate = $rate`,
    { date, from, to, rate }
  );

  return rate;
}

module.exports = { getRateForDate };