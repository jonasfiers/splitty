// Expense change records: how an edit's changes are stored on its
// UPDATED_BY relationship, and how they are turned back into something the
// app can show.
//
// Stored (UPDATED_BY.changes, a JSON string; only what changed):
//   { currency: 'EUR',                       // currency of the "after" amounts
//     changes: [
//       { field: 'description', from, to },
//       { field: 'currency', from: 'EUR', to: 'USD' },   // only if it changed
//       { field: 'amount', from: 4000, to: 4500 },       // minor units
//       { field: 'date' | 'category' | 'group', from, to },
//       { field: 'paidBy', from: userId, to: userId },
//       { field: 'share', userId, from: 2000, to: 2500 }, // 0 = not sharing
//     ] }
// People are stored by id, never by name: a renamed or deleted account then
// shows its current name ("Deleted user") wherever the history is read.
// "Before" amounts are in the old currency when a currency entry is present.

const driver = require('./neo4j');

// Differences between two expense states (see readExpenseState in
// crudService.js). null when nothing changed.
function expenseChanges(b, a) {
    const out = [];
    if (b.description !== a.description) out.push({ field: 'description', from: b.description, to: a.description });
    if (b.currencyIso !== a.currencyIso) out.push({ field: 'currency', from: b.currencyIso, to: a.currencyIso });
    if (b.amount !== a.amount) out.push({ field: 'amount', from: b.amount, to: a.amount });
    if (b.date !== a.date) out.push({ field: 'date', from: b.date, to: a.date });
    if (b.categoryId !== a.categoryId) out.push({ field: 'category', from: b.category, to: a.category });
    if (b.groupId !== a.groupId) out.push({ field: 'group', from: b.groupTitle, to: a.groupTitle });
    if (b.payerId !== a.payerId) out.push({ field: 'paidBy', from: b.payerId, to: a.payerId });
    // Everyone's full share, the payer's being the remainder.
    const full = s => {
        const m = new Map(s.others.map(o => [o.userId, o.amount]));
        if (s.payerId) m.set(s.payerId, s.amount - s.others.reduce((t, o) => t + o.amount, 0));
        return m;
    };
    const fb = full(b), fa = full(a);
    for (const userId of new Set([...fb.keys(), ...fa.keys()])) {
        const from = fb.get(userId) ?? 0, to = fa.get(userId) ?? 0;
        if (Math.abs(from - to) > 1e-9) out.push({ field: 'share', userId, from, to });
    }
    return out.length ? { currency: a.currencyIso, changes: out } : null;
}

// Stored JSON strings (or null) -> lists of display-ready entries, names
// looked up now: share/paidBy get `name`/`from`/`to` as names, amount and
// share entries get fromCurrency/toCurrency. null stays null (no details).
async function resolveChanges(stored) {
    const parsed = stored.map(s => (s ? JSON.parse(s) : null));
    const ids = new Set();
    for (const p of parsed) {
        for (const c of p?.changes || []) {
            if (c.field === 'share') ids.add(c.userId);
            if (c.field === 'paidBy') { ids.add(c.from); ids.add(c.to); }
        }
    }
    const names = new Map();
    if (ids.size) {
        const { records } = await driver.executeQuery(
            'MATCH (u:User) WHERE u.id IN $ids RETURN u.id AS id, u.name AS name',
            { ids: [...ids].filter(Boolean) }
        );
        for (const r of records) names.set(r.get('id'), r.get('name'));
    }
    const nameOf = id => (id ? names.get(id) ?? 'Deleted user' : null);
    return parsed.map(p => {
        if (!p || !Array.isArray(p.changes)) return null; // none, or not in this format
        const toCurrency = p.currency;
        const fromCurrency = p.changes.find(c => c.field === 'currency')?.from ?? toCurrency;
        return p.changes.map(c => {
            if (c.field === 'share') return { field: 'share', name: nameOf(c.userId), from: c.from, to: c.to, fromCurrency, toCurrency };
            if (c.field === 'paidBy') return { field: 'paidBy', from: nameOf(c.from), to: nameOf(c.to) };
            if (c.field === 'amount') return { ...c, fromCurrency, toCurrency };
            return c;
        });
    });
}

module.exports = { expenseChanges, resolveChanges };
