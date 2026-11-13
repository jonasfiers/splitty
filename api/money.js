// Currencies whose official minor unit (ISO 4217, 2 decimals) is not used in
// everyday money: CLDR's cash digits are 0 for them (checked 2026-11-13). A
// whole amount is shown without ".00" (NT$1,000, but NT$1,000.50). Display
// only: amounts stay stored in the official minor unit. Same list as the web
// app's utils/currency.js; keep the two in step.
const WHOLE_IN_PRACTICE = new Set(['AMD', 'CRC', 'CZK', 'GYD', 'MNT', 'MUR', 'NOK', 'PKR', 'RSD', 'SEK', 'TWD', 'TZS', 'UZS']);

// Intl.NumberFormat options for an amount in `iso`.
const currencyOptions = iso => ({
    style: 'currency',
    currency: iso,
    ...(WHOLE_IN_PRACTICE.has(iso) ? { trailingZeroDisplay: 'stripIfInteger' } : {}),
});

module.exports = { WHOLE_IN_PRACTICE, currencyOptions };
