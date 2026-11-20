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

// A share of an expense in the group's currency (minor units), as Cypher for
// OWED_BY relationship `o` of expense `e` (2026-11-20). Each share is
// converted with the expense's rate and rounded ONCE, and that one amount is
// used on both sides: what the person owes and what the payer is owed. So
// balances are whole minor units and a group always adds up to exactly zero.
// (Unrounded, three people on a foreign-currency expense could end a cent
// apart after settling up, and the one left with it could never leave.) The
// payer's own share, never stored, absorbs the rounding. Every balance query
// uses this; same-currency expenses (rate 1) are whole amounts already.
const shareInGroupCurrency = (o, e) => `round(${o}.amount * coalesce(${e}.rateSnapshot, 1))`;

module.exports = { WHOLE_IN_PRACTICE, currencyOptions, shareInGroupCurrency };
