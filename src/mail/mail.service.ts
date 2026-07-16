import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.MAIL_FROM ?? 'LawnHate <onboarding@resend.dev>';

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
              <td style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px;">LawnHate</td>
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

  await send(to, `Your LawnHate receipt · ${invoice.invoiceNumber}`, html);
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
