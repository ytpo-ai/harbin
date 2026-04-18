import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

interface SuccessResponse<T> {
  code: number;
  message: string;
  data: T;
  timestamp: string;
  requestId: string;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, SuccessResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<SuccessResponse<T>> {
    const request = context.switchToHttp().getRequest();
    const requestId = request?.headers?.['x-request-id'] || `req_${Date.now()}`;

    return next.handle().pipe(
      map((data) => {
        if (this.isWrappedResponse(data)) {
          return {
            ...data,
            requestId: data.requestId || requestId,
            timestamp: data.timestamp || new Date().toISOString(),
          } as SuccessResponse<T>;
        }

        return {
          code: 0,
          message: 'success',
          data,
          timestamp: new Date().toISOString(),
          requestId,
        };
      }),
    );
  }

  private isWrappedResponse(payload: unknown): payload is SuccessResponse<T> {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    const body = payload as Record<string, unknown>;
    return 'code' in body && 'message' in body && 'data' in body;
  }
}
