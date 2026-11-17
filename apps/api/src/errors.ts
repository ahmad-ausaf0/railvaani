import type { Response } from 'express';

/** The one error vocabulary for the whole API. Bodies always look like
 *  { "error": { "code": "...", "message": "..." } } with plain-language
 *  messages; stack traces stay on the server. */
export type ApiErrorCode =
  | 'bad_request'
  | 'rate_limited'
  | 'upstream_down'
  | 'not_configured'
  | 'not_found';

/** Send the standard error body. One path so the shape can never drift. */
export function sendError(
  res: Response,
  status: number,
  code: ApiErrorCode,
  message: string,
): void {
  res.status(status).json({ error: { code, message } });
}

/** Plain-language messages for the codes a caller can hit. */
export const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  bad_request: 'The request is missing or misstates something. Check the fields and try again.',
  rate_limited: 'Too many requests. Wait a minute and try again.',
  upstream_down: 'Train data could not be reached right now. Please try again in a bit.',
  not_configured: 'This part of the service is not set up yet. Check back soon.',
  not_found: 'The page you asked for does not exist.',
};
