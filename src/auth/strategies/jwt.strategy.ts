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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      jwtFromRequest: (ExtractJwt as any).fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'defaultSecret',
    });
  }

  async validate(payload: {
    sub: string;
    email: string;
    role: string;
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
      role: payload.role,
      sessionToken: session_token,
    };
  }
}
