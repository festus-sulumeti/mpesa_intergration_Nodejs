export class DarajaError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "DarajaError";
    this.code = code;
    this.status = status;
  }
}

export function publicHttpError(err: unknown): string {
  if (typeof err === "object" && err !== null && "isAxiosError" in err) {
    const axiosError = err as {
      message?: string;
      response?: { data?: unknown };
    };
    const data = axiosError.response?.data;
    if (data && typeof data === "object" && "errorMessage" in data) {
      return String((data as { errorMessage: unknown }).errorMessage);
    }
    if (typeof axiosError.message === "string" && axiosError.message) {
      return axiosError.message;
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return "Request failed";
}
