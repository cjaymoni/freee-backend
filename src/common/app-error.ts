import { HttpException, HttpStatus } from '@nestjs/common';
import { ServiceResponseDto } from './service-response.dto';

export class AppError extends HttpException {
  constructor(
    error: any,
    statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR,
  ) {
    let message = 'An unexpected error occurred';
    let responseError: string | undefined = 'Internal Server Error';
    let status = statusCode;

    if (error instanceof HttpException) {
      status = error.getStatus();
      const response = error.getResponse();

      if (
        typeof response === 'object' &&
        response !== null &&
        'message' in response
      ) {
        const res = response as {
          message: string;
          error?: string;
          name?: string;
        };
        message = res.message;
        responseError = res.error || res.name;
      } else {
        message = error.message;
        responseError = error.name;
      }
    } else if (error instanceof Error) {
      message = error.message;
      responseError = error.name;
    } else if (typeof error === 'string') {
      message = error;
    }

    const serviceResponse: ServiceResponseDto<null> = {
      state: false,
      data: null,
      message: message,
      error: responseError,
      statusCode: status,
    };

    super(serviceResponse, status);
  }
}
