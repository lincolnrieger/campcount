import type { Env } from '../env';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Messages captured in development and tests instead of being sent. */
export const devOutbox: OutgoingEmail[] = [];

/** Error from the email provider, carrying its code (e.g. E_SENDER_NOT_VERIFIED). */
export class EmailSendError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Parse EMAIL_FROM ("CampCount <no-reply@campcount.com>" or a bare address)
 * into what the Email Service binding documents for `from`: a bare address
 * or an { email, name } object, never a combined "Name <address>" string.
 */
export function parseSender(from: string): string | { email: string; name: string } {
  const match = /^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(from);
  if (match) return match[1] ? { name: match[1].replace(/^"|"$/g, ''), email: match[2]! } : match[2]!;
  return from.trim();
}

export async function sendEmail(env: Env, message: OutgoingEmail): Promise<void> {
  if (env.EMAIL) {
    try {
      await env.EMAIL.send({
        from: parseSender(env.EMAIL_FROM),
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      });
    } catch (err) {
      const e = err as { code?: unknown; message?: unknown };
      throw new EmailSendError(typeof e.code === 'string' ? e.code : 'UNKNOWN', String(e.message ?? err));
    }
    return;
  }
  if (env.ENVIRONMENT === 'production') {
    throw new EmailSendError('NO_BINDING', 'EMAIL binding is not configured');
  }
  devOutbox.push(message);
  if (env.ENVIRONMENT === 'development') {
    // Local development only: print so the developer can sign in.
    console.log(`[dev email] to=${message.to} subject=${message.subject}\n${message.text}`);
  }
}
