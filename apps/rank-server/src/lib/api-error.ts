export class ApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}
