'use strict';

const _CAT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="24" fill="#F5EDE0"/><polygon points="10,18 14,8 20,18" fill="#F5A623"/><polygon points="28,18 34,8 38,18" fill="#F5A623"/><polygon points="12,17 14,10 18,17" fill="#F07167"/><polygon points="30,17 34,10 36,17" fill="#F07167"/><circle cx="24" cy="28" r="16" fill="#F5A623"/><ellipse cx="19" cy="27" rx="2.5" ry="3" fill="#2C1A0E"/><ellipse cx="29" cy="27" rx="2.5" ry="3" fill="#2C1A0E"/><circle cx="20" cy="26" r=".9" fill="white"/><circle cx="30" cy="26" r=".9" fill="white"/><ellipse cx="24" cy="32" rx="1.5" ry="1.1" fill="#F07167"/><line x1="8" y1="30" x2="19" y2="32" stroke="#2C1A0E" stroke-width=".7" opacity=".4"/><line x1="8" y1="33" x2="19" y2="33" stroke="#2C1A0E" stroke-width=".7" opacity=".4"/><line x1="29" y1="32" x2="40" y2="30" stroke="#2C1A0E" stroke-width=".7" opacity=".4"/><line x1="29" y1="33" x2="40" y2="33" stroke="#2C1A0E" stroke-width=".7" opacity=".4"/></svg>`;
const _CAT_URI = `data:image/svg+xml;base64,${Buffer.from(_CAT_SVG).toString('base64')}`;

function e(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatAmount(amount, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount);
  } catch {
    return `${currency.toUpperCase()} ${Number(amount).toFixed(2)}`;
  }
}

function previewFiller() {
  return '&zwnj;&nbsp;'.repeat(50);
}

function baseTemplate({ title, previewText, body }) {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
  <title>${e(title)}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    /* No web fonts: loading them from Google would tell Google who opened the email.
       Plus Jakarta Sans and DM Serif Display show where installed; else Arial and Georgia. */
    body,html{margin:0;padding:0;background-color:#F5F1EB;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
    table{border-collapse:collapse;}
    @media only screen and (max-width:600px){
      .ew{padding:0 !important}
      .hd{border-radius:0 !important}
      .hd .lc{padding:22px 24px !important}
      .cd{border-radius:0 0 12px 12px !important;padding:32px 24px !important}
      .ab{font-size:44px !important}
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#F5F1EB;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${e(previewText)}&nbsp;${previewFiller()}</div>

  <table class="ew" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F1EB;padding:48px 20px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">

        <!-- HEADER -->
        <tr><td>
          <table class="hd" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#4A2C0E;border-radius:16px 16px 0 0;">
            <tr><td style="height:4px;background-color:#E8603A;line-height:4px;font-size:4px;mso-line-height-rule:exactly;">&nbsp;</td></tr>
            <tr><td class="lc" style="padding:28px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:12px;">
                    <img src="${_CAT_URI}" width="40" height="40" alt="Splitty" style="display:block;border:0;">
                  </td>
                  <td style="vertical-align:middle;">
                    <span style="font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:24px;color:#FEFCFA;font-weight:400;letter-spacing:-0.3px;">Split<span style="color:#E8603A;">ty</span></span>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </td></tr>

        <!-- CARD -->
        <tr><td>
          <table class="cd" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FEFCFA;border-radius:0 0 16px 16px;padding:48px 40px;">
            <tr><td>${body}</td></tr>
          </table>
        </td></tr>

        <!-- FOOTER -->
        <tr><td style="padding:32px 0 0;text-align:center;">
          <p style="margin:0 0 6px;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:12px;color:#A8998E;line-height:1.7;">You're receiving this because you have a Splitty account.</p>
          <p style="margin:0;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:12px;color:#C9BEB4;line-height:1.7;">&copy; ${year} Splitty &mdash; Shared expenses, simplified.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Password Reset ───────────────────────────────────────────────────────────

function passwordResetTemplate(resetUrl) {
  const body = `
    <p style="margin:0 0 14px;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:11px;font-weight:600;color:#E8603A;letter-spacing:0.12em;text-transform:uppercase;">Account Security</p>
    <h1 style="margin:0 0 16px;font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:36px;font-weight:400;color:#1C1917;line-height:1.15;letter-spacing:-0.5px;">Reset your password</h1>
    <p style="margin:0;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:15px;color:#78716C;line-height:1.75;">We received a request to reset the password for your Splitty account. Click the button below to choose a new one.</p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 0;">
      <tr><td style="border-radius:100px;background-color:#E8603A;">
        <a href="${e(resetUrl)}" target="_blank" style="display:inline-block;padding:15px 36px;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:15px;font-weight:600;color:#FEFCFA;text-decoration:none;border-radius:100px;">Reset Password</a>
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 0;">
      <tr><td style="height:1px;background-color:#E8E0D4;line-height:1px;font-size:1px;mso-line-height-rule:exactly;">&nbsp;</td></tr>
    </table>
    <p style="margin:24px 0 0;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:13px;color:#A8998E;line-height:1.7;">This link expires in <strong style="color:#78716C;font-weight:600;">1 hour</strong>. If you didn't request a password reset, no action is needed &mdash; your account remains secure.</p>
    <p style="margin:12px 0 0;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:12px;color:#C9BEB4;line-height:1.6;word-break:break-all;">Or paste this link: ${e(resetUrl)}</p>
  `;
  return baseTemplate({
    title: 'Reset your Splitty password',
    previewText: 'Reset your Splitty password — this link expires in 1 hour.',
    body,
  });
}

// ── Email Verification ───────────────────────────────────────────────────────

function emailVerificationTemplate(verifyUrl) {
  const body = `
    <p style="margin:0 0 14px;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:11px;font-weight:600;color:#E8603A;letter-spacing:0.12em;text-transform:uppercase;">Welcome to Splitty</p>
    <h1 style="margin:0 0 16px;font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:36px;font-weight:400;color:#1C1917;line-height:1.15;letter-spacing:-0.5px;">Verify your email</h1>
    <p style="margin:0;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:15px;color:#78716C;line-height:1.75;">Thanks for signing up. Click the button below to confirm your email address and activate your account.</p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 0;">
      <tr><td style="border-radius:100px;background-color:#E8603A;">
        <a href="${e(verifyUrl)}" target="_blank" style="display:inline-block;padding:15px 36px;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:15px;font-weight:600;color:#FEFCFA;text-decoration:none;border-radius:100px;">Verify Email Address</a>
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 0;">
      <tr><td style="height:1px;background-color:#E8E0D4;line-height:1px;font-size:1px;mso-line-height-rule:exactly;">&nbsp;</td></tr>
    </table>
    <p style="margin:24px 0 0;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:13px;color:#A8998E;line-height:1.7;">This link expires in <strong style="color:#78716C;font-weight:600;">24 hours</strong>. If you didn't create a Splitty account, you can safely ignore this email.</p>
    <p style="margin:12px 0 0;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:12px;color:#C9BEB4;line-height:1.6;word-break:break-all;">Or paste this link: ${e(verifyUrl)}</p>
  `;
  return baseTemplate({
    title: 'Verify your Splitty email',
    previewText: 'Confirm your email address to activate your Splitty account.',
    body,
  });
}

// ── Group Invite ─────────────────────────────────────────────────────────────

function groupInviteTemplate(inviterName, groupName, inviteUrl) {
  const body = `
    <p style="margin:0 0 14px;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:11px;font-weight:600;color:#E8603A;letter-spacing:0.12em;text-transform:uppercase;">Invitation from ${e(inviterName)}</p>
    <h1 style="margin:0 0 24px;font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:36px;font-weight:400;color:#1C1917;line-height:1.15;letter-spacing:-0.5px;">You're invited to join</h1>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
      <tr><td style="background-color:#FEF0EB;border-radius:10px;padding:14px 22px;border:1px solid #FDE2D8;">
        <span style="font-family:'DM Serif Display',Georgia,serif;font-size:22px;color:#E8603A;font-weight:400;">${e(groupName)}</span>
      </td></tr>
    </table>

    <p style="margin:0;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:15px;color:#78716C;line-height:1.75;"><strong style="color:#1C1917;font-weight:600;">${e(inviterName)}</strong> has invited you to a shared expense group on Splitty. Once you join, you can track, split, and settle costs together in real time.</p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 0;">
      <tr><td style="border-radius:100px;background-color:#E8603A;">
        <a href="${e(inviteUrl)}" target="_blank" style="display:inline-block;padding:15px 36px;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:15px;font-weight:600;color:#FEFCFA;text-decoration:none;border-radius:100px;">Accept Invite</a>
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 0;">
      <tr><td style="height:1px;background-color:#E8E0D4;line-height:1px;font-size:1px;mso-line-height-rule:exactly;">&nbsp;</td></tr>
    </table>
    <p style="margin:24px 0 0;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:13px;color:#A8998E;line-height:1.7;">This invite expires in <strong style="color:#78716C;font-weight:600;">7 days</strong>. If you don't have a Splitty account yet, you'll be able to create one when you accept.</p>
  `;
  return baseTemplate({
    title: `${inviterName} invited you to ${groupName} on Splitty`,
    previewText: `${inviterName} invited you to join "${groupName}" on Splitty.`,
    body,
  });
}

// ── Settlement Notification ──────────────────────────────────────────────────
// type: 'owe'  — recipient owes money to someone
// type: 'owed' — someone owes the recipient money

function settlementTemplate({ type, fromName, toName, amount, currency = 'USD', groupName, settlementUrl }) {
  const isOwe = type === 'owe';
  const formatted = formatAmount(amount, currency);
  const accent      = isOwe ? '#E8603A' : '#059669';
  const accentLight = isOwe ? '#FEF0EB' : '#D1FAE5';
  const accentBorder = isOwe ? '#FDE2D8' : '#A7F3D0';
  const groupColor  = isOwe ? '#A8998E' : '#047857';

  const body = `
    <p style="margin:0 0 14px;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:11px;font-weight:600;color:${accent};letter-spacing:0.12em;text-transform:uppercase;">${isOwe ? 'Balance Due' : 'Balance Incoming'}</p>
    <h1 style="margin:0 0 28px;font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:34px;font-weight:400;color:#1C1917;line-height:1.15;letter-spacing:-0.5px;">${isOwe ? `You owe ${e(toName)}` : `${e(fromName)} owes you`}</h1>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;">
      <tr><td style="background-color:${accentLight};border-radius:12px;padding:24px 28px;border:1px solid ${accentBorder};">
        <p style="margin:0 0 6px;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:11px;font-weight:600;color:${accent};text-transform:uppercase;letter-spacing:0.1em;">Amount</p>
        <p class="ab" style="margin:0 0 8px;font-family:'Courier New',Courier,monospace;font-size:54px;font-weight:700;color:${accent};line-height:1;letter-spacing:-1px;">${e(formatted)}</p>
        <p style="margin:0;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:13px;color:${groupColor};line-height:1.5;">in <strong style="font-weight:600;">${e(groupName)}</strong></p>
      </td></tr>
    </table>

    <p style="margin:0;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:15px;color:#78716C;line-height:1.75;">${isOwe
      ? `This is a reminder that you have an outstanding balance with <strong style="color:#1C1917;font-weight:600;">${e(toName)}</strong> in <strong style="color:#1C1917;font-weight:600;">${e(groupName)}</strong>. Head over to Splitty to settle up.`
      : `<strong style="color:#1C1917;font-weight:600;">${e(fromName)}</strong> has a pending balance with you in <strong style="color:#1C1917;font-weight:600;">${e(groupName)}</strong>. View the details and mark it settled once you've been paid.`
    }</p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 0;">
      <tr><td style="border-radius:100px;background-color:${accent};">
        <a href="${e(settlementUrl)}" target="_blank" style="display:inline-block;padding:15px 36px;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:15px;font-weight:600;color:#FEFCFA;text-decoration:none;border-radius:100px;">${isOwe ? 'Settle Up' : 'View Details'}</a>
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 0;">
      <tr><td style="height:1px;background-color:#E8E0D4;line-height:1px;font-size:1px;mso-line-height-rule:exactly;">&nbsp;</td></tr>
    </table>
    <p style="margin:24px 0 0;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:13px;color:#A8998E;line-height:1.7;">Balances are calculated across all expenses in the group. If you believe this is incorrect, check the expense history in Splitty.</p>
  `;

  return baseTemplate({
    title: isOwe ? `You owe ${toName} ${formatted}` : `${fromName} owes you ${formatted}`,
    previewText: isOwe
      ? `Reminder: you owe ${toName} ${formatted} in ${groupName}.`
      : `${fromName} owes you ${formatted} in ${groupName}.`,
    body,
  });
}

// ── Email Change Verification ────────────────────────────────────────────────

function emailChangeTemplate(verifyUrl) {
  const body = `
    <p style="margin:0 0 14px;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:11px;font-weight:600;color:#E8603A;letter-spacing:0.12em;text-transform:uppercase;">Account Settings</p>
    <h1 style="margin:0 0 16px;font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-size:36px;font-weight:400;color:#1C1917;line-height:1.15;letter-spacing:-0.5px;">Confirm your new email</h1>
    <p style="margin:0;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:15px;color:#78716C;line-height:1.75;">You requested to update the email address on your Splitty account. Click the button below to confirm your new address and complete the change.</p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 0;">
      <tr><td style="border-radius:100px;background-color:#E8603A;">
        <a href="${e(verifyUrl)}" target="_blank" style="display:inline-block;padding:15px 36px;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:15px;font-weight:600;color:#FEFCFA;text-decoration:none;border-radius:100px;">Confirm New Email</a>
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 0;">
      <tr><td style="height:1px;background-color:#E8E0D4;line-height:1px;font-size:1px;mso-line-height-rule:exactly;">&nbsp;</td></tr>
    </table>
    <p style="margin:24px 0 0;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:13px;color:#A8998E;line-height:1.7;">This link expires in <strong style="color:#78716C;font-weight:600;">24 hours</strong>. Your current email remains active until you confirm the new one. If you didn't request this change, you can safely ignore this email.</p>
    <p style="margin:12px 0 0;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:12px;color:#C9BEB4;line-height:1.6;word-break:break-all;">Or paste this link: ${e(verifyUrl)}</p>
  `;
  return baseTemplate({
    title: 'Confirm your new Splitty email address',
    previewText: 'Confirm your new email address to complete the change.',
    body,
  });
}

module.exports = { passwordResetTemplate, emailVerificationTemplate, emailChangeTemplate, groupInviteTemplate, settlementTemplate };