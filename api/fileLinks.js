// fileLinks.js
//
// Signed links to uploaded files (trip attachments, trip documents, expense
// receipts). A link, not the bearer token, because a file has to open with a
// plain <a>: the browser's own PDF and image viewers can not send an
// Authorization header. Anyone holding a link can open that one file until it
// expires, also after leaving the group, so links are short-lived and pages
// fetch fresh ones every few minutes.
//
// Signed with a key derived from JWT_SECRET, never with the secret itself: a
// link must not double as a login token, or the reverse. (The key keeps its
// first name, "trip-attachment", so links already handed out stay valid.)
const jwt = require('jsonwebtoken');

const FILE_LINK_TTL = '5m';
const fileLinkSecret = () => `${process.env.JWT_SECRET}:trip-attachment`;

// The download route lives in routes/trips.js: GET /trips/files/:id?sig=…
const signFileLink = id => `/trips/files/${id}?sig=${jwt.sign({ att: id }, fileLinkSecret(), { expiresIn: FILE_LINK_TTL })}`;

// The file id the link was signed for, or null when it is invalid or expired.
function verifyFileLink(sig) {
    try {
        return jwt.verify(String(sig || ''), fileLinkSecret()).att ?? null;
    } catch {
        return null;
    }
}

module.exports = { FILE_LINK_TTL, signFileLink, verifyFileLink };
