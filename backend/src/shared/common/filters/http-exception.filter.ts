import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    const statusCode = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = exception instanceof HttpException
      ? exception.getResponse()
      : null;

    const message = this.resolveMessage(exceptionResponse, exception);
    const error = this.resolveError(exceptionResponse, exception);
    const requestId = (request.headers['x-request-id'] as string) || `req_${Date.now()}`;

    response.status(statusCode).json({
      code: statusCode,
      message,
      error,
      timestamp: new Date().toISOString(),
      requestId,
      path: request.url,
    });
  }

  private resolveMessage(exceptionResponse: unknown, exception: unknown): string {
    if (typeof exceptionResponse === 'string') {
      return exceptionResponse;
    }

    if (exceptionResponse && typeof exceptionResponse === 'object') {
      const maybeMessage = (exceptionResponse as Record<string, unknown>).message;
      if (Array.isArray(maybeMessage)) {
        return maybeMessage.join(', ');
      }
      if (typeof maybeMessage === 'string') {
        return maybeMessage;
      }
    }

    if (exception instanceof Error) {
      return exception.message;
    }

    return 'Internal server error';
  }

  private resolveError(exceptionResponse: unknown, exception: unknown): unknown {
    if (exceptionResponse && typeof exceptionResponse === 'object') {
      return exceptionResponse;
    }

    if (typeof exceptionResponse === 'string') {
      return { message: exceptionResponse };
    }

    if (exception instanceof Error) {
      return { name: exception.name, message: exception.message };
    }

    return { message: 'Unknown error' };
  }
}
