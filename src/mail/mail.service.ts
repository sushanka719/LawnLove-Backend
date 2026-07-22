import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.MAIL_FROM ?? 'LawnLove <onboarding@resend.dev>';

async function send(to: string, subject: string, html: string) {
  const { error } = await resend.emails.send({ from: FROM, to, subject, html });
  if (error) {
    throw new Error(`Failed to send email via Resend: ${error.message}`);
  }
}

export async function sendMagicLinkEmail(to: string, url: string) {
  await send(
    to,
    'Your sign-in link',
    `<p>Click the link below to continue:</p><p><a href="${url}">${url}</a></p><p>If you didn't request this, you can ignore this email.</p>`,
  );
}

export async function sendResetPasswordEmail(to: string, url: string) {
  await send(
    to,
    'Reset your password',
    `<p>Click the link below to reset your password:</p><p><a href="${url}">${url}</a></p><p>If you didn't request this, you can ignore this email.</p>`,
  );
}

// Business name is admin-supplied free text that gets interpolated into the
// email HTML below, so escape it before it lands in the markup.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Shared branded shell for simple "heading + copy + one CTA button" emails,
// styled to match sendInvoiceEmail (LawnLove green header, inline styles only —
// email clients strip <style>/class-based CSS). `bodyHtml` is trusted markup
// assembled by the caller; interpolate user input through escapeHtml first.
function renderActionEmail(opts: {
  eyebrow: string;
  heading: string;
  bodyHtml: string;
  buttonLabel: string;
  buttonUrl: string;
  footerNote: string;
}): string {
  return `
  <div style="margin:0;padding:24px;background-color:#f4f2ea;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background-color:#fffcf5;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(74,74,74,0.14);">
      <tr>
        <td style="background-color:#195134;padding:24px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px;">LawnLove</td>
              <td style="color:#a7d7bf;font-size:13px;font-weight:600;text-align:right;text-transform:uppercase;letter-spacing:0.5px;">${opts.eyebrow}</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:32px;">
          <h1 style="margin:0 0 12px;color:#195134;font-size:22px;font-weight:700;letter-spacing:-0.4px;">${opts.heading}</h1>
          ${opts.bodyHtml}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 4px;">
            <tr>
              <td align="center">
                <a href="${opts.buttonUrl}" style="display:inline-block;background-color:#195134;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 28px;border-radius:12px;">
                  ${opts.buttonLabel}
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 32px;background-color:#f4f2ea;color:#8a8a8a;font-size:12px;line-height:18px;">
          ${opts.footerNote}
        </td>
      </tr>
    </table>
  </div>`;
}

const PARAGRAPH_STYLE =
  'margin:0 0 12px;color:#4a4a4a;font-size:15px;line-height:22px;';

// New-agent invite: the magic link (`url`) signs them in and lands them on the
// set-password page. Sent from the sendMagicLink callback when a pending
// agent-invite verification row exists for the email (see auth.ts).
export async function sendAgentInviteEmail(
  to: string,
  url: string,
  businessName?: string,
) {
  const intro = businessName
    ? `You've been invited to bring <strong>${escapeHtml(businessName)}</strong> onto LawnLove as a lawn care agent.`
    : `You've been invited to become a lawn care agent on LawnLove.`;
  const html = renderActionEmail({
    eyebrow: 'Agent invitation',
    heading: 'Set up your agent account',
    bodyHtml:
      `<p style="${PARAGRAPH_STYLE}">${intro}</p>` +
      `<p style="${PARAGRAPH_STYLE}">Click below to finish setting up your account, choose a password, and open your agent dashboard.</p>`,
    buttonLabel: 'Set up your account',
    buttonUrl: url,
    footerNote: `This invitation was sent to ${to}. If you weren't expecting it, you can safely ignore this email.`,
  });
  await send(to, "You're invited to join LawnLove as an agent", html);
}

// Existing user promoted to agent: they already have login credentials (or
// Google), so there's no magic link or set-password step — just a nudge to sign
// in. `loginUrl` points at the app's /login page.
export async function sendAgentPromotedEmail(to: string, loginUrl: string) {
  const html = renderActionEmail({
    eyebrow: 'Agent access',
    heading: "You're now a LawnLove agent",
    bodyHtml: `<p style="${PARAGRAPH_STYLE}">Your account has been upgraded to a lawn care agent. Sign in to open your agent dashboard and start taking jobs.</p>`,
    buttonLabel: 'Sign in',
    buttonUrl: loginUrl,
    footerNote: `This notification was sent to ${to}.`,
  });
  await send(to, "You're now a LawnLove agent", html);
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export type InvoiceEmailData = {
  invoiceNumber: string;
  reference: string; // booking reference, e.g. "LL-A1B2C3"
  serviceLabel: string; // e.g. "Weekly Lawn Mowing"
  address: string;
  servicedOn: Date;
  areaSqFt: number;
  amountCents: number;
  dashboardUrl: string;
};

// Paid receipt sent when the customer's card is charged at job completion.
// Doubles as the "your lawn has been serviced" notification. All styling is
// inline — email clients strip <style>/class-based CSS.
export async function sendInvoiceEmail(to: string, invoice: InvoiceEmailData) {
  const amount = formatMoney(invoice.amountCents);
  const servicedOn = invoice.servicedOn.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const metaRow = (label: string, value: string) =>
    `<tr>
       <td style="padding:6px 0;color:#6b6b6b;font-size:14px;">${label}</td>
       <td style="padding:6px 0;color:#333333;font-size:14px;font-weight:600;text-align:right;">${value}</td>
     </tr>`;

  const html = `
  <div style="margin:0;padding:24px;background-color:#f4f2ea;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background-color:#fffcf5;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(74,74,74,0.14);">
      <tr>
        <td style="background-color:#195134;padding:24px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px;">LawnLove</td>
              <td style="color:#a7d7bf;font-size:13px;font-weight:600;text-align:right;text-transform:uppercase;letter-spacing:0.5px;">Payment receipt</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:32px;">
          <h1 style="margin:0 0 8px;color:#195134;font-size:22px;font-weight:700;letter-spacing:-0.4px;">Your lawn has been serviced</h1>
          <p style="margin:0 0 24px;color:#4a4a4a;font-size:15px;line-height:22px;">
            Thanks! The service below is complete and <strong>${amount}</strong> has been charged to the card on file.
          </p>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e6e2d6;border-bottom:1px solid #e6e2d6;margin-bottom:20px;">
            ${metaRow('Invoice', invoice.invoiceNumber)}
            ${metaRow('Booking', invoice.reference)}
            ${metaRow('Service', invoice.serviceLabel)}
            ${metaRow('Property', invoice.address)}
            ${metaRow('Serviced on', servicedOn)}
            ${metaRow('Lawn area', `${invoice.areaSqFt.toLocaleString('en-US')} sq ft`)}
          </table>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr>
              <td style="padding:8px 0;color:#333333;font-size:15px;">${invoice.serviceLabel} — one visit</td>
              <td style="padding:8px 0;color:#333333;font-size:15px;font-weight:600;text-align:right;">${amount}</td>
            </tr>
            <tr>
              <td style="padding:12px 0 0;border-top:2px solid #195134;color:#195134;font-size:17px;font-weight:700;">Total charged</td>
              <td style="padding:12px 0 0;border-top:2px solid #195134;color:#195134;font-size:17px;font-weight:700;text-align:right;">${amount}</td>
            </tr>
          </table>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr>
              <td align="center">
                <a href="${invoice.dashboardUrl}" style="display:inline-block;background-color:#195134;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 28px;border-radius:12px;">
                  View service &amp; photos
                </a>
              </td>
            </tr>
          </table>

          <p style="margin:0;color:#8a8a8a;font-size:13px;line-height:19px;">
            You have 24 hours to review the work. If everything looks good you can approve it now — otherwise it is approved automatically.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 32px;background-color:#f4f2ea;color:#8a8a8a;font-size:12px;line-height:18px;">
          This receipt was sent to ${to}. Charged to your card on file.
        </td>
      </tr>
    </table>
  </div>`;

  await send(to, `Your LawnLove receipt · ${invoice.invoiceNumber}`, html);
}

export async function sendPayoutReleasedEmail(to: string, amountLabel: string) {
  await send(
    to,
    'You got paid',
    `<p>Nice work! A payout of <strong>${amountLabel}</strong> has been released to your ` +
      `connected account for a completed job.</p>` +
      `<p>It should arrive per your bank's standard Stripe payout schedule.</p>`,
  );
}
