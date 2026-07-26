export class HttpError extends Error {
    status;
    endpoint;
    constructor(status, endpoint) {
        super(`HTTP ${status} from ${endpoint}`);
        this.status = status;
        this.endpoint = endpoint;
        this.name = "HttpError";
    }
}
export async function requireOk(response, endpoint) {
    if (!response.ok) {
        throw new HttpError(response.status, endpoint);
    }
    return response;
}
