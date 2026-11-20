// A mail catcher for the tests (2026-11-20): a minimal SMTP server the test
// API sends its mail to. Nothing is delivered anywhere; each message is kept
// in memory so a test can read it like a user would, e.g. follow the link in
// a verification or password reset email.
const net = require('node:net');

const PORT = Number(process.env.TEST_SMTP_PORT || 2599);
let server;
const messages = [];

// Quoted-printable (nodemailer's encoding for long lines): soft line breaks
// and =XX escapes, so links come out whole.
const decodeQP = s => s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

function start() {
    return new Promise(resolve => {
        server = net.createServer(sock => {
            let data = false, buf = '', raw = '', to = [];
            const say = l => sock.write(l + '\r\n');
            say('220 test-mailbox ESMTP');
            sock.on('data', chunk => {
                buf += chunk.toString('utf8');
                let i;
                while ((i = buf.indexOf('\r\n')) >= 0) {
                    const line = buf.slice(0, i); buf = buf.slice(i + 2);
                    if (data) {
                        if (line === '.') {
                            data = false;
                            const text = decodeQP(raw);
                            const subject = (/^Subject: (.*)$/mi.exec(raw) || [])[1] || '';
                            messages.push({ to, subject, text });
                            raw = ''; to = [];
                            say('250 queued');
                        } else raw += line.replace(/^\.\./, '.') + '\n';
                        continue;
                    }
                    const cmd = line.slice(0, 4).toUpperCase();
                    if (cmd === 'EHLO') sock.write('250-test-mailbox\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
                    else if (cmd === 'AUTH') say('235 ok');
                    else if (cmd === 'RCPT') { to.push((/<([^>]+)>/.exec(line) || [])[1]?.toLowerCase()); say('250 ok'); }
                    else if (cmd === 'DATA') { data = true; say('354 go'); }
                    else if (cmd === 'QUIT') { say('221 bye'); sock.end(); }
                    else say('250 ok');
                }
            });
            sock.on('error', () => {});
        }).listen(PORT, '127.0.0.1', resolve);
    });
}

function stop() {
    return new Promise(resolve => (server ? server.close(() => resolve()) : resolve()));
}

// Mail sent to `address` so far (newest last).
const to = address => messages.filter(m => m.to.includes(address.toLowerCase()));

// Waits for a mail to `address` whose subject matches, sent after `since`
// (the count of mails to that address before the action).
async function waitFor(address, subject, since = 0, ms = 5000) {
    for (let t = 0; t < ms; t += 50) {
        const found = to(address).slice(since).find(m => subject.test(m.subject));
        if (found) return found;
        await new Promise(r => setTimeout(r, 50));
    }
    throw new Error(`No mail to ${address} matching ${subject} (got: ${to(address).map(m => m.subject).join(' | ') || 'none'})`);
}

// The token in a link like http://localhost/reset-password?token=… in a mail.
const tokenIn = (mail, path) => {
    const m = new RegExp(`${path}\\?token=([0-9a-f]+)`).exec(mail.text);
    if (!m) throw new Error(`No ${path} link in "${mail.subject}"`);
    return m[1];
};

module.exports = { PORT, start, stop, to, waitFor, tokenIn };
