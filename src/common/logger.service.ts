import { Injectable, LoggerService, Scope } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  VERBOSE = 4,
}

@Injectable({ scope: Scope.TRANSIENT })
export class AppLogger implements LoggerService {
  private context?: string;
  private readonly logLevel: LogLevel;
  private readonly isProduction: boolean;

  constructor(private readonly configService: ConfigService) {
    this.isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    this.logLevel = this.getLogLevel();
  }

  setContext(context: string) {
    this.context = context;
  }

  private getLogLevel(): LogLevel {
    const env = this.configService.get<string>('LOG_LEVEL', 'info');
    switch (env.toLowerCase()) {
      case 'error':
        return LogLevel.ERROR;
      case 'warn':
        return LogLevel.WARN;
      case 'info':
        return LogLevel.INFO;
      case 'debug':
        return LogLevel.DEBUG;
      case 'verbose':
        return LogLevel.VERBOSE;
      default:
        return LogLevel.INFO;
    }
  }

  private sanitize(value: string): string {
    return value.replace(/[\r\n]/g, ' ');
  }

  private formatMessage(
    level: string,
    message: string,
    context?: string,
  ): string {
    const timestamp = Date.now();
    const ctx = this.sanitize(context || this.context || 'Application');

    if (this.isProduction) {
      return JSON.stringify({ timestamp, level, context: ctx, message });
    }

    return `[${timestamp}] [${level}] [${ctx}] ${message}`;
  }

  private toSanitizedString(message: any): string {
    let str: string;
    if (typeof message === 'object') {
      try {
        str = JSON.stringify(message);
      } catch {
        str = '[Unserializable Object]';
      }
    } else {
      str = String(message);
    }
    return this.sanitize(str);
  }

  log(message: any, context?: string) {
    if (this.logLevel >= LogLevel.INFO) {
      console.log(
        this.formatMessage('INFO', this.toSanitizedString(message), context),
      );
    }
  }

  error(message: any, trace?: string, context?: string) {
    if (this.logLevel >= LogLevel.ERROR) {
      console.error(
        this.formatMessage('ERROR', this.toSanitizedString(message), context),
      );
      if (trace && !this.isProduction) {
        console.error(trace);
      }
    }
  }

  warn(message: any, context?: string) {
    if (this.logLevel >= LogLevel.WARN) {
      console.warn(
        this.formatMessage('WARN', this.toSanitizedString(message), context),
      );
    }
  }

  debug(message: any, context?: string) {
    if (this.logLevel >= LogLevel.DEBUG) {
      console.debug(
        this.formatMessage('DEBUG', this.toSanitizedString(message), context),
      );
    }
  }

  verbose(message: any, context?: string) {
    if (this.logLevel >= LogLevel.VERBOSE) {
      console.debug(
        this.formatMessage('VERBOSE', this.toSanitizedString(message), context),
      );
    }
  }
}
