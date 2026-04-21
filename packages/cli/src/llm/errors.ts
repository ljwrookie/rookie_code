export class LLMError extends Error {
  constructor(
    message: string,
    public code: 'AUTH' | 'RATE_LIMIT' | 'NETWORK' | 'INVALID_REQUEST' | 'UNKNOWN',
    public retryable: boolean,
    public cause?: Error,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}
