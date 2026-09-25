import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { AuditService } from '../audit.service';
import { AuditHelperService } from '../audit-helper.service';

type Params = Record<string, string | undefined>;

/** Audited path prefixes, most specific first. */
const AUDITED_ROUTES: {
  prefix: string;
  entityType: string;
  entityId: (params: Params, request: any) => string | undefined;
}[] = [
  {
    prefix: '/moderation/items/report',
    entityType: 'reported_items',
    entityId: (p) => p.id,
  },
  {
    prefix: '/moderation/users/report',
    entityType: 'reported_users',
    entityId: (p) => p.id,
  },
  {
    // DELETE carries the blocked user's id, not the block's; the block's id
    // comes back in the response.
    prefix: '/moderation/users/block',
    entityType: 'blocked_users',
    entityId: () => undefined,
  },
  {
    prefix: '/moderation/complaints',
    entityType: 'moderation_complaints',
    entityId: (p) => p.id,
  },
  {
    prefix: '/item-requests',
    entityType: 'item_requests',
    entityId: (p) => p.requestId,
  },
  {
    prefix: '/items/[^/]+/images',
    entityType: 'item_images',
    entityId: (p) => p.imageId ?? p.id,
  },
  {
    prefix: '/items',
    entityType: 'items',
    entityId: (p, r) => p.id || r.body?.id,
  },
  {
    prefix: '/categories',
    entityType: 'categories',
    entityId: (p, r) => p.id || r.body?.id,
  },
  {
    prefix: '/user',
    entityType: 'users',
    entityId: (p, r) => p.id || r.user?.userId,
  },
];

/**
 * Interceptor to automatically log API requests to audit logs
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly auditService: AuditService,
    private readonly auditHelper: AuditHelperService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, user, ip, headers } = request;

    const startTime = Date.now();

    return next.handle().pipe(
      tap((response) => {
        if (this.shouldAudit(method, url)) {
          this.logAudit({
            request,
            response,
            success: true,
            duration: Date.now() - startTime,
          }).catch(console.error);
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

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const validEntityId = entityId && uuidRegex.test(entityId) ? entityId : null;

      await this.auditService.log({
        userId: request.user?.userId,
        entityType: entityInfo.entityType,
        entityId: validEntityId,
        action: this.mapMethodToAction(request.method),
        // Bodies for POST /user and PATCH /user/:id carry a plaintext
        // password, so nothing goes into audit_logs unredacted.
        newValues: this.auditHelper.sanitizeData(request.body),
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

  /**
   * Which entity a mutation touches, from the request path. Matched on whole
   * path segments, most specific first: substring matching logged a
   * moderation report's id as an item or user id, and skipped item requests
   * and complaints entirely (neither path contains "/items" or "/user").
   * Where the id isn't in the path it comes from the response (see logAudit).
   */
  private extractEntityInfo(request: any): {
    entityType: string;
    entityId?: string;
  } | null {
    const path = String(request.path ?? request.url ?? '').split('?')[0];
    const params = request.params ?? {};
    const route = AUDITED_ROUTES.find(({ prefix }) =>
      new RegExp(`^${prefix}(/|$)`).test(path),
    );
    if (!route) return null;

    return {
      entityType: route.entityType,
      entityId: route.entityId(params, request),
    };
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
