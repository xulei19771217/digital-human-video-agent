export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly endpoint: string,
  ) {
    super(`HTTP ${status} from ${endpoint}`);
    this.name = "HttpError";
  }
}

export async function requireOk(
  response: Response,
  endpoint: string,
): Promise<Response> {
  if (!response.ok) {
    throw new HttpError(response.status, endpoint);
  }
  return response;
}
