import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { WsHttpExceptionFilter } from './ws-http-exception.filter';

describe('WsHttpExceptionFilter', () => {
  const filter = new WsHttpExceptionFilter();
  const host = (data: unknown, ack?: jest.Mock) => {
    const client = { emit: jest.fn() };
    return {
      client,
      host: {
        getArgByIndex: (i: number) => [client, data, ack][i],
        switchToWs: () => ({
          getClient: () => client,
          getData: () => data,
          getPattern: () => 'message:send',
        }),
      } as unknown as ArgumentsHost,
    };
  };

  it('answers a validation failure through the ack, echoing client_message_id', () => {
    const ack = jest.fn();
    const { client, host: h } = host({ client_message_id: 'c-1' }, ack);

    filter.catch(new BadRequestException(['content is too long']), h);

    expect(ack).toHaveBeenCalledWith({
      state: false,
      statusCode: 400,
      message: ['content is too long'],
      error: 'Bad Request',
      client_message_id: 'c-1',
    });
    expect(client.emit).not.toHaveBeenCalled();
  });

  it('falls back to the default exception event without an ack', () => {
    const { client, host: h } = host({});
    filter.catch(new BadRequestException('bad'), h);
    expect(client.emit).toHaveBeenCalledWith('exception', expect.anything());
  });
});
