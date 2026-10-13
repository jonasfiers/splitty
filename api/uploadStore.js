// uploadStore.js
//
// Where trip attachments live on disk. The directory must sit OUTSIDE the API's
// own directory: a deploy replaces that directory wholesale, and anything
// stored inside it would be gone with the previous release.
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'));
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PER_ITEM = 10;

// Only types a browser renders inertly. No HTML, no SVG: an attachment is
// served from the app's own origin, so anything scriptable would run as it.
const SIGNATURES = {
    'application/pdf': buf => buf.subarray(0, 5).toString('latin1') === '%PDF-',
    'image/jpeg':      buf => buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
    'image/png':       buf => buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/webp':      buf => buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP',
};

// The declared type is the client's claim; the leading bytes are the file's.
const isAllowed = (mimeType, buffer) => Boolean(SIGNATURES[mimeType]?.(buffer));

// Stored names are generated here and never derived from user input, so a
// stored name can not point outside UPLOAD_DIR.
const filePath = storedName => {
    if (!/^[0-9a-f-]{36}$/.test(storedName)) throw new Error('Invalid stored name');
    return path.join(UPLOAD_DIR, storedName);
};

async function save(buffer) {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const storedName = crypto.randomUUID();
    await fs.writeFile(filePath(storedName), buffer, { mode: 0o600, flag: 'wx' });
    return storedName;
}

// Best effort: by the time this runs the graph no longer references the file,
// so a failure leaves an unreachable file behind rather than a broken link.
async function remove(storedNames = []) {
    await Promise.all(storedNames.filter(Boolean).map(async storedName => {
        try {
            await fs.unlink(filePath(storedName));
        } catch (err) {
            if (err.code !== 'ENOENT') console.error(`Failed to remove upload ${storedName}:`, err.message);
        }
    }));
}

module.exports = { UPLOAD_DIR, MAX_BYTES, MAX_PER_ITEM, ALLOWED_TYPES: Object.keys(SIGNATURES), isAllowed, filePath, save, remove };
