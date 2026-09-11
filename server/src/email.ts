/** Sending the login code, by whichever provider the deployment names. */

/* Deliberately pluggable and deliberately boring. Both providers are a single
   REST call, and 'console' exists so local development never sends mail.

   Volume is tiny: a device token lasts, so a person needs a code when adding a
   device, not when opening the app. Resend's free 100 a day is therefore room
   for a hundred new devices a day, which this will not reach. */
import type { Env } from './env';

/* The same for every provider, so a person searching their mail for it finds
   the code whichever path sent it. */
/** The subject line on every login code. */
const SUBJECT = 'Your Learness sign-in code';

/* Both are sent: a client that refuses HTML still shows the code, and the
   wording is kept identical between them so the two cannot drift apart. */
/** The two renderings of one code, plain text and HTML. */
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
 *  Resend's own explanation when it was not. */
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
  /* Resend explains itself in the body. Passing that through turns "422" into
     "the domain is not verified", which is the difference between a fixable
     problem and a mystery. */
  const detail = await res.json<ResendError>().catch(() => null);
  const reason = detail?.message || detail?.error || `HTTP ${res.status}`;
  throw new Error(`Resend refused the message: ${reason}`);
}

/** Sends through Brevo. Resolves when the message was accepted; throws with the
 *  status code when it was not. */
async function sendBrevo(env: Env, to: string, code: string): Promise<void> {
  /* Brevo works, but not from here: its API requires listing authorized IP
     addresses, and a Worker egresses from Cloudflare's whole edge network, so
     there is no stable address to authorize. Kept for anyone running this
     somewhere with a fixed IP. */
  const { text, html } = body(code);
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    /* Reached only once `sendLoginCode()` has checked for the key. Coerced
       rather than defaulted, so that the unreachable case still sends exactly
       the header the untyped version sent. */
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
 *  saying what is unconfigured, or what the provider said. */
export async function sendLoginCode(env: Env, to: string, code: string): Promise<void> {
  /* The caller turns a throw into a 503 rather than telling the person to go
     and look in their inbox for something that was never sent. */
  const provider = (env.EMAIL_PROVIDER || '').trim().toLowerCase();

  /* Unset is an error, not a default. Silently succeeding would be worse than
     failing: the caller is told a code was sent, waits for an email that never
     arrives, and has no way in. With observability logs off, the code is not
     recoverable from the log either. */
  if (!provider) {
    throw new Error(
      'email sending is not configured on this deployment, so no code can be ' +
        'delivered. Set EMAIL_PROVIDER to brevo or resend and store an ' +
        'EMAIL_API_KEY secret.',
    );
  }

  /* Printing the code is a deliberate choice for local development, switched on
     in .dev.vars. It is never a fallback. */
  if (provider === 'console') {
    // oxlint-disable-next-line no-console -- see above: this is the local path
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
