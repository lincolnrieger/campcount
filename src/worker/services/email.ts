import type { Env } from '../env';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
}

/** Messages captured in development and tests instead of being sent. */
export const devOutbox: OutgoingEmail[] = [];

export async function sendEmail(env: Env, message: OutgoingEmail): Promise<void> {
  if (env.EMAIL) {
    await env.EMAIL.send({ from: env.EMAIL_FROM, to: message.to, subject: message.subject, text: message.text });
    return;
  }
  if (env.ENVIRONMENT === 'staging' || env.ENVIRONMENT === 'production') {
    throw new Error('EMAIL binding is not configured');
  }
  devOutbox.push(message);
  if (env.ENVIRONMENT === 'development') {
    // Local development only: print so the developer can sign in.
    console.log(`[dev email] to=${message.to} subject=${message.subject}\n${message.text}`);
  }
}
