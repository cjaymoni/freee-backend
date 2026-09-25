import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseWsExceptionFilter } from '@nestjs/websockets';

/**
 * Answer an HttpException thrown before a handler runs - in practice the
 * gateway's ValidationPipe rejecting a payload - through the event's ack, in
 * the same envelope the handlers use for their own errors.
 *
 * Without this, Nest's default filter treats it as an unknown error: the
 * client gets a generic `exception` event ("Internal server error") and the
 * ack is never called, so an optimistic message bubble stays pending forever.
 * `client_message_id` is echoed back so the client can match the failure.
 * Anything that isn't an HttpException keeps the default handling.
 */
@Catch()
export class WsHttpExceptionFilter extends BaseWsExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    // socket.io handlers are called as (client, data, ack).
    const ack: unknown = host.getArgByIndex(2);

    if (!(exception instanceof HttpException) || typeof ack !== 'function') {
      super.catch(exception, host);
      return;
    }

    const data = host.switchToWs().getData<unknown>();
    const clientMessageId =
      data && typeof data === 'object' && 'client_message_id' in data
        ? (data as { client_message_id?: unknown }).client_message_id
        : undefined;
    const response = exception.getResponse();

    (ack as (payload: unknown) => void)({
      state: false,
      statusCode: exception.getStatus(),
      ...(typeof response === 'object' ? response : { message: response }),
      client_message_id: clientMessageId,
    });
  }
}
