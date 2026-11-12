export type ProviderErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'too_large'
  | 'network'
  | 'bad_response'
  | 'aborted';

export class ProviderError extends Error {
  kind: ProviderErrorKind;
  status?: number;
  constructor(kind: ProviderErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = status;
  }
}
