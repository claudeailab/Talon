export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: {
      "X-Requested-With": "talon",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !url.endsWith("/auth/login")) onUnauthorized();
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text };
  }
  if (!res.ok) {
    let msg = data?.detail ?? res.statusText;
    if (Array.isArray(msg)) msg = msg.map((m: any) => m.msg).join(", ");
    throw new ApiError(res.status, String(msg));
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", "/api" + url),
  post: <T>(url: string, body: unknown = {}) => request<T>("POST", "/api" + url, body),
  put: <T>(url: string, body: unknown = {}) => request<T>("PUT", "/api" + url, body),
  del: <T>(url: string) => request<T>("DELETE", "/api" + url),
};
