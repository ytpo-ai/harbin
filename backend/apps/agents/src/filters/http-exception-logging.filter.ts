import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionLoggingFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionLoggingFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const requestIdHeader = request.headers['x-request-id'];
    const requestId = Array.isArray(requestIdHeader)
      ? String(requestIdHeader[0] || '').trim()
      : String(requestIdHeader || '').trim();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const detail = this.extractDetail(payload);
      const baseMessage =
        `[http_exception] method=${request.method} path=${request.originalUrl || request.url} ` +
        `status=${status} requestId=${requestId || 'none'} detail="${detail}"`;
      if (status >= 500) {
        this.logger.error(baseMessage);
      } else {
        this.logger.warn(baseMessage);
      }
      response.status(status).json(payload);
      return;
    }

    const message = exception instanceof Error ? exception.message : String(exception || 'Unknown error');
    this.logger.error(
      `[unhandled_exception] method=${request.method} path=${request.originalUrl || request.url} requestId=${requestId || 'none'} error=${message}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }

  private extractDetail(payload: unknown): string {
    if (!payload) return 'none';
    if (typeof payload === 'string') return this.compact(payload, 300);
    if (typeof payload === 'object') {
      const source = payload as Record<string, unknown>;
      const message = source.message;
      const error = source.error;
      const statusCode = source.statusCode;
      const parts = [
        statusCode ? `statusCode=${this.compact(statusCode, 20)}` : '',
        message
          ? `message=${Array.isArray(message)
            ? this.compact(message.join('; '), 300)
            : this.compact(message, 300)}`
          : '',
        error ? `error=${this.compact(error, 120)}` : '',
      ].filter(Boolean);
      if (parts.length > 0) return parts.join(' ');
      return this.compact(JSON.stringify(source), 300);
    }
    return this.compact(payload, 300);
  }

  private compact(value: unknown, maxLength = 120): string {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
  }
}
