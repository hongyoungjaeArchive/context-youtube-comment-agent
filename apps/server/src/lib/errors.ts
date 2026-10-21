export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what}을(를) 찾을 수 없습니다.`, 404);
export const policyBlocked = (code: string, message: string) => new AppError(code, message, 409);
