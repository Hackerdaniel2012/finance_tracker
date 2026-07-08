export class ValidationError extends Error {
	readonly status = 400;

	constructor(message: string) {
		super(message);
		this.name = 'ValidationError';
	}
}

export class NotFoundError extends Error {
	readonly status = 404;

	constructor(message: string) {
		super(message);
		this.name = 'NotFoundError';
	}
}

export class ConflictError extends Error {
	readonly status = 409;

	constructor(message: string) {
		super(message);
		this.name = 'ConflictError';
	}
}

export type ApiDomainError = ValidationError | NotFoundError | ConflictError;

export function isApiDomainError(error: unknown): error is ApiDomainError {
	return (
		error instanceof ValidationError ||
		error instanceof NotFoundError ||
		error instanceof ConflictError
	);
}
