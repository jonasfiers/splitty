const nodemailer = require('nodemailer');
const { passwordResetTemplate, emailVerificationTemplate, emailChangeTemplate, groupInviteTemplate, settlementTemplate } = require('./emailTemplates');

const SMTP_PORT = parseInt(process.env.SMTP_PORT) || 587;

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.migadu.com',
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

const FROM = () => process.env.EMAIL_FROM || process.env.SMTP_USER;

async function sendVerificationEmail(to, verifyUrl) {
    await transporter.sendMail({
        from: FROM(),
        to,
        subject: 'Verify your Splitty email address',
        text: `Thanks for signing up for Splitty. Click the link below to verify your email — it expires in 24 hours.\n\n${verifyUrl}\n\nIf you didn't create an account, you can ignore this email.`,
        html: emailVerificationTemplate(verifyUrl),
    });
}

async function sendPasswordResetEmail(to, resetUrl) {
    await transporter.sendMail({
        from: FROM(),
        to,
        subject: 'Reset your Splitty password',
        text: `You requested a password reset. Click the link below — it expires in 1 hour.\n\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
        html: passwordResetTemplate(resetUrl),
    });
}

async function sendGroupInviteEmail(to, inviterName, groupName, inviteUrl) {
    await transporter.sendMail({
        from: FROM(),
        to,
        subject: `${inviterName} invited you to ${groupName} on Splitty`,
        text: `${inviterName} has invited you to join "${groupName}" on Splitty.\n\nAccept here (expires in 7 days):\n${inviteUrl}`,
        html: groupInviteTemplate(inviterName, groupName, inviteUrl),
    });
}

async function sendSettlementEmail(to, params) {
    const { type, fromName, toName, amount, currency, groupName } = params;
    const isOwe = type === 'owe';
    const subject = isOwe
        ? `Reminder: you owe ${toName} in ${groupName}`
        : `${fromName} owes you in ${groupName}`;
    await transporter.sendMail({
        from: FROM(),
        to,
        subject,
        text: isOwe
            ? `You have an outstanding balance with ${toName} in ${groupName}. Open Splitty to settle up.`
            : `${fromName} has a pending balance with you in ${groupName}. Open Splitty to view details.`,
        html: settlementTemplate(params),
    });
}

async function sendEmailChangeVerification(to, verifyUrl) {
    await transporter.sendMail({
        from: FROM(),
        to,
        subject: 'Confirm your new Splitty email address',
        text: `You requested to update the email address on your Splitty account. Click the link below to confirm — it expires in 24 hours.\n\n${verifyUrl}\n\nIf you didn't request this change, you can safely ignore this email.`,
        html: emailChangeTemplate(verifyUrl),
    });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, sendEmailChangeVerification, sendGroupInviteEmail, sendSettlementEmail };