import { BadRequestException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { FirebaseService } from '../../firebase/firebase.service';
import { UserEntity } from '../../user/entities/user.entity';
import { SmsAuthService } from './sms-auth.service';
import { TwilioVerifyClient, TwilioVerifyError } from './twilio-verify.client';

const GH = '+233241234567';

function setup(env: Record<string, unknown>, twilioConfigured = true) {
  const config = {
    get: (key: string, fallback?: unknown) => env[key] ?? fallback,
  } as unknown as ConfigService;
  const twilio = {
    configured: twilioConfigured,
    sendCode: jest.fn().mockResolvedValue(undefined),
    checkCode: jest.fn().mockResolvedValue(true),
  };
  const firebase = {
    customTokenForPhone: jest.fn().mockResolvedValue('custom-token'),
  };
  const userRepo = { findOne: jest.fn().mockResolvedValue(null) };
  const service = new SmsAuthService(
    config,
    twilio as unknown as TwilioVerifyClient,
    firebase as unknown as FirebaseService,
    userRepo as unknown as Repository<UserEntity>,
  );
  return { service, twilio, firebase, userRepo };
}

describe('SmsAuthService.getConfig', () => {
  it('defaults to Firebase with Twilio as the fallback', () => {
    expect(setup({}).service.getConfig()).toEqual({
      provider: 'firebase',
      fallback: 'twilio',
    });
  });

  it('switches to Twilio as the only sender', () => {
    expect(setup({ SMS_PROVIDER: 'twilio' }).service.getConfig()).toEqual({
      provider: 'twilio',
      fallback: null,
    });
  });

  it('turns the fallback off when asked', () => {
    expect(setup({ SMS_FALLBACK_ENABLED: false }).service.getConfig()).toEqual({
      provider: 'firebase',
      fallback: null,
    });
  });

  it("never points clients at Twilio when it isn't configured", () => {
    expect(
      setup({ SMS_PROVIDER: 'twilio' }, false).service.getConfig(),
    ).toEqual({ provider: 'firebase', fallback: null });
  });
});

describe('SmsAuthService.sendCode', () => {
  it('texts an allowed number through Twilio', async () => {
    const { service, twilio } = setup({});
    await service.sendCode(GH);
    expect(twilio.sendCode).toHaveBeenCalledWith(GH);
  });

  it('refuses numbers outside the allowed prefixes', async () => {
    const { service, twilio } = setup({});
    await expect(service.sendCode('+447700900123')).rejects.toThrow(
      BadRequestException,
    );
    expect(twilio.sendCode).not.toHaveBeenCalled();
  });

  it('refuses to text while no client should use the backend', async () => {
    const { service, twilio } = setup({ SMS_FALLBACK_ENABLED: false });
    await expect(service.sendCode(GH)).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
    expect(twilio.sendCode).not.toHaveBeenCalled();
  });

  it("passes Twilio's rate limit on as 429", async () => {
    const { service, twilio } = setup({});
    twilio.sendCode.mockRejectedValue(new TwilioVerifyError('rate-limited'));
    await expect(service.sendCode(GH)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });
});

describe('SmsAuthService.verifyCode', () => {
  it('trades a right code for a Firebase custom token', async () => {
    const { service, firebase } = setup({});
    await expect(service.verifyCode(GH, '123456')).resolves.toEqual({
      firebase_token: 'custom-token',
    });
    expect(firebase.customTokenForPhone).toHaveBeenCalledWith(GH, undefined);
  });

  it('signs in to the Firebase account of the backend account that has the number verified', async () => {
    const { service, firebase, userRepo } = setup({});
    userRepo.findOne.mockResolvedValue({ id: 'u1', firebase_uid: 'fb-owner' });
    await service.verifyCode(GH, '123456');
    const [{ where }] = userRepo.findOne.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(where).toMatchObject({ phone_number: GH, is_phone_verified: true });
    expect(firebase.customTokenForPhone).toHaveBeenCalledWith(GH, 'fb-owner');
  });

  it('gives no token for a wrong code', async () => {
    const { service, twilio, firebase } = setup({});
    twilio.checkCode.mockResolvedValue(false);
    await expect(service.verifyCode(GH, '000000')).rejects.toThrow(
      BadRequestException,
    );
    expect(firebase.customTokenForPhone).not.toHaveBeenCalled();
  });

  it('reports an expired or used-up code', async () => {
    const { service, twilio } = setup({});
    twilio.checkCode.mockRejectedValue(
      new TwilioVerifyError('no-pending-code'),
    );
    await expect(service.verifyCode(GH, '123456')).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      message: 'That code has expired. Send a new one.',
    });
  });
});
