export interface LogContext {
  readonly requestId?: string;
  readonly eventId?: string;
  readonly conversationId?: string;
  readonly sessionId?: string;
  readonly traceId?: string;
  readonly [key: string]: unknown;
}

export interface LoggerPort {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error: Error, context?: LogContext): void;
}
