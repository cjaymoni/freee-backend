import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { AuditService } from '../audit.service';

/**
 * Interceptor to automatically log API requests to audit logs
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, user, ip, headers } = request;

    const startTime = Date.now();

    return next.handle().pipe(
      tap(async (response) => {
        // Only audit specific endpoints (not GET requests typically)
        if (this.shouldAudit(method, url)) {
          await this.logAudit({
            request,
            response,
            success: true,
            duration: Date.now() - startTime,
          });
        }
      }),
      catchError((error) => {
        // Log failed requests
        if (this.shouldAudit(method, url)) {
          this.logAudit({
            request,
            response: null,
            success: false,
            error,
            duration: Date.now() - startTime,
          }).catch(console.error);
        }
        return throwError(() => error);
      }),
    );
  }

  private shouldAudit(method: string, url: string): boolean {
    // Skip GET requests and health checks
    if (method === 'GET' || url.includes('/health')) {
      return false;
    }

    // Audit all POST, PUT, PATCH, DELETE requests
    return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  }

  private async logAudit(data: {
    request: any;
    response: any;
    success: boolean;
    error?: any;
    duration: number;
  }): Promise<void> {
    const { request, response, success, error, duration } = data;

    // Extract entity info from URL and body
    const entityInfo = this.extractEntityInfo(request);

    if (entityInfo) {
      let entityId = entityInfo.entityId;
      if (!entityId && response) {
        entityId = response.data?.id || response.id || response.data?.uuid || response.uuid;
      }

      await this.auditService.log({
        userId: request.user?.userId,
        entityType: entityInfo.entityType,
        entityId: entityId || null,
        action: this.mapMethodToAction(request.method),
        newValues: request.body,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        apiEndpoint: request.url,
        requestMethod: request.method,
        success,
        errorMessage: error?.message,
        metadata: {
          duration,
          statusCode: error?.status || 200,
        },
      });
    }
  }

  private extractEntityInfo(request: any): {
    entityType: string;
    entityId?: string;
  } | null {
    const url = request.url;

    // Extract entity type from URL
    if (url.includes('/items')) {
      return {
        entityType: 'items',
        entityId: request.params?.id || request.body?.id,
      };
    }

    if (url.includes('/categories')) {
      return {
        entityType: 'categories',
        entityId: request.params?.id || request.body?.id,
      };
    }

    if (url.includes('/user')) {
      return {
        entityType: 'users',
        entityId: request.params?.id || request.user?.userId,
      };
    }

    return null;
  }

  private mapMethodToAction(method: string): string {
    const actionMap: Record<string, string> = {
      POST: 'created',
      PUT: 'updated',
      PATCH: 'updated',
      DELETE: 'deleted',
    };
    return actionMap[method] || 'unknown';
  }
}
