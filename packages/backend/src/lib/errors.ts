export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string = "error",
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
  }

  toResponse(): Response {
    return Response.json(
      {
        error: { code: this.code, message: this.message, ...(this.details ?? {}) },
      },
      { status: this.status },
    );
  }
}

export function unauthorized(msg = "unauthorized", code = "unauthorized"): HttpError {
  return new HttpError(401, msg, code);
}

export function forbidden(msg = "forbidden", code = "forbidden"): HttpError {
  return new HttpError(403, msg, code);
}

export function badRequest(msg: string, details?: Record<string, unknown>): HttpError {
  return new HttpError(400, msg, "bad_request", details);
}

export function paymentRequired(msg: string, details?: Record<string, unknown>): HttpError {
  return new HttpError(402, msg, "quota_exceeded", details);
}

export function tooMany(msg = "rate limit exceeded"): HttpError {
  return new HttpError(429, msg, "rate_limited");
}

export function notFound(msg = "not found"): HttpError {
  return new HttpError(404, msg, "not_found");
}

export function serverError(msg = "internal error"): HttpError {
  return new HttpError(500, msg, "internal");
}
