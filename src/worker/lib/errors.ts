import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * An error whose message is safe to show to the client. Anything else that is
 * thrown becomes a generic 500 so internal details never leak.
 */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const unauthenticated = () => new ApiError(401, 'unauthenticated', 'Please sign in.');
export const forbidden = () =>
  new ApiError(403, 'forbidden', 'You do not have permission to do that.');
/** Used for anything the caller may not see, so existence is not disclosed. */
export const notFound = () => new ApiError(404, 'not_found', 'Not found.');
export const conflict = (message: string) => new ApiError(409, 'conflict', message);
export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'bad_request', message, details);
