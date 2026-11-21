// fileUpload.js
//
// One way in for uploaded files (2026-11-21): trip item files, trip documents
// and expense receipts. Each upload is a multipart form with
//
//   file        the file (PDF, JPEG, PNG or WebP; checked by its bytes)
//   thumbnail   optional: a small JPEG preview the app draws on the phone
//               (a photo scaled down, a PDF's first page), shown as the
//               file's tile so a page need not download every whole file
//
// and both are saved through uploadStore.js. The preview is served at
// /trips/files/:id/thumb under the file's own signed link (fileLinks.js).
const multer = require('multer');
const uploadStore = require('./uploadStore');

// A preview is a few tens of KB; anything far bigger is not one.
const MAX_THUMB_BYTES = 256 * 1024;

const parser = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: uploadStore.MAX_BYTES, files: 2 },
}).fields([{ name: 'file', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]);

const isPreview = buf => !!buf && buf.length <= MAX_THUMB_BYTES && uploadStore.isAllowed('image/jpeg', buf);

// Reads the form. Resolves { file, thumb } (thumb may be undefined), or
// answers the request itself (too big, no file, a type Splitty does not take,
// a preview that is not one) and resolves null.
function receive(req, res, { fileRequired = true } = {}) {
    return new Promise(resolve => parser(req, res, err => {
        const fail = (status, error) => { res.status(status).json({ error }); resolve(null); };
        if (err) {
            const tooBig = err.code === 'LIMIT_FILE_SIZE';
            return fail(tooBig ? 413 : 400, tooBig ? `The file is larger than ${uploadStore.MAX_BYTES / 1024 / 1024} MB.` : 'Upload failed.');
        }
        const file = req.files?.file?.[0];
        const thumb = req.files?.thumbnail?.[0];
        if (fileRequired) {
            if (!file) return fail(400, 'No file was sent.');
            if (!uploadStore.isAllowed(file.mimetype, file.buffer)) return fail(415, 'Only PDF, JPEG, PNG and WebP files can be added.');
        }
        if (thumb && !isPreview(thumb.buffer)) return fail(415, 'The preview must be a small JPEG.');
        resolve({ file, thumb });
    }));
}

// Saves the file and its preview; on any failure nothing stays behind.
async function save(file, thumb) {
    const storedName = await uploadStore.save(file.buffer);
    try {
        const thumbStoredName = thumb ? await uploadStore.save(thumb.buffer) : null;
        return { storedName, thumbStoredName };
    } catch (err) {
        await uploadStore.remove([storedName]);
        throw err;
    }
}

// The answer to an upload that failed after receive(): storage full, or else.
function failed(res, error) {
    if (error?.code === 'STORAGE_FULL') {
        console.error(`Upload refused: less than ${uploadStore.MIN_FREE_BYTES / 1024 / 1024} MB would be left free in ${uploadStore.UPLOAD_DIR}`);
        return res.status(507).json({ error: 'Splitty’s storage is full, so files cannot be uploaded right now. Please tell the admin.' });
    }
    console.error(error);
    // Not error.message: it can carry server paths.
    return res.status(500).json({ error: 'Upload failed.' });
}

module.exports = { MAX_THUMB_BYTES, isPreview, receive, save, failed };
