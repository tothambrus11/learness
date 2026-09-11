/** Sending the login code, by whichever provider the deployment names. */

import type { Env } from './env';

/** The subject line on every login code, the same whichever provider sent it,
 *  so searching a mailbox for it finds the code either way. */
const SUBJECT = 'Your Learness sign-in code';

/** The two renderings of one code, plain text and HTML. Both are sent on every
 *  message, so a client that refuses HTML still shows the code; they are worded
 *  alike so the two cannot drift apart. */
const body = (code: string): { text: string; html: string } => ({
  text:
    `Your sign-in code is ${code}\n\n` +
    `It is good for 10 minutes and can be used once.\n` +
    `If you did not ask for it, you can ignore this email.`,
  html:
    `<p>Your sign-in code is</p>` +
    `<p style="font-size:30px;font-weight:700;letter-spacing:.18em;margin:12px 0">${code}</p>` +
    `<p style="color:#666">Good for 10 minutes, single use. ` +
    `If you did not ask for it, ignore this email.</p>`,
});

/** What Resend puts in the body of a refusal. Both fields are optional and only
 *  one is ever set, which one depending on the kind of failure. */
interface ResendError {
  /** The human explanation, e.g. "The learness.org domain is not verified". */
  message?: string;
  /** The error name on the responses that use that field instead. */
  error?: string;
}

/** Sends through Resend. Resolves when the message was accepted; throws with
 *  Resend's own explanation when it was not, which is the difference between
 *  "422" and "the domain is not verified". */
async function sendResend(env: Env, to: string, code: string): Promise<void> {
  const { text, html } = body(code);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.EMAIL_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject: SUBJECT, text, html }),
  });
  if (res.ok) return;
  const detail = await res.json<ResendError>().catch(() => null);
  const reason = detail?.message || detail?.error || `HTTP ${res.status}`;
  throw new Error(`Resend refused the message: ${reason}`);
}

/** Sends through Brevo. Resolves when the message was accepted; throws with the
 *  status code when it was not. Brevo's API requires listing authorized IP
 *  addresses, which a Worker cannot offer, so this path is only for a
 *  deployment with a fixed egress address. */
async function sendBrevo(env: Env, to: string, code: string): Promise<void> {
  const { text, html } = body(code);
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': String(env.EMAIL_API_KEY), 'content-type': 'application/json' },
    body: JSON.stringify({
      sender: { email: env.EMAIL_FROM, name: 'Learness' },
      to: [{ email: to }],
      subject: SUBJECT,
      textContent: text,
      htmlContent: html,
    }),
  });
  if (!res.ok) throw new Error(`Brevo refused the message (${res.status})`);
}

/** Sends one login code by whichever path this deployment is configured for.
 *  Resolves only when the code is genuinely on its way; throws with a sentence
 *  saying what is unconfigured, or what the provider said. An unset provider is
 *  one of those failures, never a silent success. */
export async function sendLoginCode(env: Env, to: string, code: string): Promise<void> {
  const provider = (env.EMAIL_PROVIDER || '').trim().toLowerCase();
  if (!provider) {
    throw new Error(
      'email sending is not configured on this deployment, so no code can be ' +
        'delivered. Set EMAIL_PROVIDER to brevo or resend and store an ' +
        'EMAIL_API_KEY secret.',
    );
  }

  if (provider === 'console') {
    // oxlint-disable-next-line no-console -- printing the code is this provider
    console.log(`[login] code for ${to}: ${code}`);
    return;
  }
  if (!env.EMAIL_API_KEY || !env.EMAIL_FROM) {
    throw new Error(`${provider} is selected but EMAIL_API_KEY or EMAIL_FROM is missing`);
  }
  if (provider === 'resend') return sendResend(env, to, code);
  if (provider === 'brevo') return sendBrevo(env, to, code);
  throw new Error(`unknown email provider: ${provider}`);
}
