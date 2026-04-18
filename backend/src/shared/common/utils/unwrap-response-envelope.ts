export function unwrapResponseEnvelope<T>(payload: unknown): T {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload as T;
  }

  const body = payload as Record<string, unknown>;
  if (
    typeof body.code === 'number' &&
    'message' in body &&
    Object.prototype.hasOwnProperty.call(body, 'data')
  ) {
    return body.data as T;
  }

  return payload as T;
}
