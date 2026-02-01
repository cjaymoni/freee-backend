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

  private formatMessage(level: string, message: any, context?: string): string {
    const timestamp = new Date().toISOString();
    const ctx = context || this.context || 'Application';

    if (this.isProduction) {
      // JSON format for production (easier to parse by log aggregators)
      return JSON.stringify({
        timestamp,
        level,
        context: ctx,
        message:
          typeof message === 'object'
            ? JSON.stringify(message)
            : String(message),
      });
    }

    // Human-readable format for development
    return `[${timestamp}] [${level}] [${ctx}] ${typeof message === 'object' ? JSON.stringify(message) : message}`;
  }

  log(message: any, context?: string) {
    if (this.logLevel >= LogLevel.INFO) {
      console.log(this.formatMessage('INFO', message, context));
    }
  }

  error(message: any, trace?: string, context?: string) {
    if (this.logLevel >= LogLevel.ERROR) {
      console.error(this.formatMessage('ERROR', message, context));
      if (trace && !this.isProduction) {
        console.error(trace);
      }
    }
  }

  warn(message: any, context?: string) {
    if (this.logLevel >= LogLevel.WARN) {
      console.warn(this.formatMessage('WARN', message, context));
    }
  }

  debug(message: any, context?: string) {
    if (this.logLevel >= LogLevel.DEBUG) {
      console.debug(this.formatMessage('DEBUG', message, context));
    }
  }

  verbose(message: any, context?: string) {
    if (this.logLevel >= LogLevel.VERBOSE) {
      console.log(this.formatMessage('VERBOSE', message, context));
    }
  }
}
