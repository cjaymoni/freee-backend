import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'defaultSecret',
    });
  }

  async validate(payload: {
    sub: string;
    email: string;
    session_token: string;
  }) {
    const { session_token } = payload;

    if (!session_token) {
      throw new UnauthorizedException('Invalid token payload');
    }

    const isSessionActive =
      await this.authService.validateSession(session_token);

    if (!isSessionActive) {
      throw new UnauthorizedException('Session expired or invalidated');
    }

    return {
      userId: payload.sub,
      email: payload.email,
      sessionToken: session_token,
    };
  }
}
