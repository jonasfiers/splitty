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

// Uploads share the container's disk with Neo4j, its logs and its own
// backups. Keep this much free for them: a full disk stops the database, not
// just the upload. UPLOAD_MIN_FREE_MB overrides it (e.g. to test the refusal).
const MIN_FREE_BYTES = (Number(process.env.UPLOAD_MIN_FREE_MB) || 2048) * 1024 * 1024;

// The upload would not fit, or the disk ran out while writing.
class StorageFullError extends Error {
    constructor() {
        super('Storage is full');
        this.code = 'STORAGE_FULL';
    }
}
const isDiskFull = err => err?.code === 'ENOSPC' || err?.code === 'EDQUOT';

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

// Free bytes on the upload disk for an unprivileged writer.
async function freeBytes() {
    const s = await fs.statfs(UPLOAD_DIR);
    return s.bavail * s.bsize;
}

async function save(buffer) {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    if (await freeBytes() - buffer.length < MIN_FREE_BYTES) throw new StorageFullError();
    const storedName = crypto.randomUUID();
    try {
        await fs.writeFile(filePath(storedName), buffer, { mode: 0o600, flag: 'wx' });
    } catch (err) {
        // writeFile creates the file before writing: never leave a partial one.
        await fs.unlink(filePath(storedName)).catch(() => {});
        throw isDiskFull(err) ? new StorageFullError() : err;
    }
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

module.exports = { UPLOAD_DIR, MAX_BYTES, MAX_PER_ITEM, MIN_FREE_BYTES, ALLOWED_TYPES: Object.keys(SIGNATURES), StorageFullError, isAllowed, filePath, freeBytes, save, remove };
