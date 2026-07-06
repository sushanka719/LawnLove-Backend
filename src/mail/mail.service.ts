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
