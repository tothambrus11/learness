/** Sending the login code.
 *
 *  Deliberately pluggable and deliberately boring. Both providers are a single
 *  REST call, and 'console' exists so local development never sends mail.
 *
 *  Volume is tiny: a device token lasts, so a person needs a code when adding a
 *  device, not when opening the app. Brevo's free 300 a day is therefore room
 *  for roughly a hundred new devices a day, indefinitely.
 */

const SUBJECT = 'Your Learness sign-in code';

const body = (code) => ({
  text: `Your sign-in code is ${code}\n\n`
    + `It is good for 10 minutes and can be used once.\n`
    + `If you did not ask for it, you can ignore this email.`,
  html: `<p>Your sign-in code is</p>`
    + `<p style="font-size:30px;font-weight:700;letter-spacing:.18em;margin:12px 0">${code}</p>`
    + `<p style="color:#666">Good for 10 minutes, single use. `
    + `If you did not ask for it, ignore this email.</p>`,
});

async function sendResend(env, to, code) {
  const { text, html } = body(code);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.EMAIL_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject: SUBJECT, text, html }),
  });
  if (!res.ok) throw new Error(`Resend refused the message (${res.status})`);
}

async function sendBrevo(env, to, code) {
  const { text, html } = body(code);
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.EMAIL_API_KEY, 'content-type': 'application/json' },
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

export async function sendLoginCode(env, to, code) {
  const provider = (env.EMAIL_PROVIDER || '').trim().toLowerCase();

  /* Unset is an error, not a default. Silently succeeding would be worse than
     failing: the caller is told a code was sent, waits for an email that never
     arrives, and has no way in. With observability logs off, the code is not
     recoverable from the log either. */
  if (!provider) {
    throw new Error(
      'email sending is not configured on this deployment, so no code can be '
      + 'delivered. Set EMAIL_PROVIDER to brevo or resend and store an '
      + 'EMAIL_API_KEY secret.');
  }

  /* Printing the code is a deliberate choice for local development, switched on
     in .dev.vars. It is never a fallback. */
  if (provider === 'console') {
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
