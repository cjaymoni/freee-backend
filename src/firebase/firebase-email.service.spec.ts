import { ConfigService } from '@nestjs/config';
import {
  EmailHeldByOtherFirebaseUser,
  FirebaseService,
} from './firebase.service';

const auth = {
  getUser: jest.fn(),
  getUserByEmail: jest.fn(),
  getUserByPhoneNumber: jest.fn(),
  createUser: jest.fn(),
  updateUser: jest.fn(),
  deleteUser: jest.fn(),
  revokeRefreshTokens: jest.fn(),
  createCustomToken: jest.fn((uid: string) => Promise.resolve(`token:${uid}`)),
};
jest.mock('firebase-admin', () => ({ auth: () => auth }));

const EMAIL = 'ama@example.com';
const PHONE = '+233241234567';

function service() {
  const s = new FirebaseService({} as ConfigService);
  // Stands in for onModuleInit with real credentials.
  Object.assign(s, { firebaseApp: {} });
  return s;
}

const fbError = (code: string) => Object.assign(new Error(code), { code });

beforeEach(() => {
  jest.clearAllMocks();
  auth.updateUser.mockResolvedValue(undefined);
  auth.deleteUser.mockResolvedValue(undefined);
  auth.revokeRefreshTokens.mockResolvedValue(undefined);
});

describe('FirebaseService lookups', () => {
  it('returns null for a user that does not exist', async () => {
    auth.getUser.mockRejectedValue(fbError('auth/user-not-found'));
    auth.getUserByEmail.mockRejectedValue(fbError('auth/user-not-found'));
    await expect(service().findUser('x')).resolves.toBeNull();
    await expect(service().findUserByEmail(EMAIL)).resolves.toBeNull();
  });

  it('passes on any other failure', async () => {
    auth.getUser.mockRejectedValue(fbError('auth/internal-error'));
    await expect(service().findUser('x')).rejects.toThrow(
      'auth/internal-error',
    );
  });
});

describe('FirebaseService.createProvenEmailUser', () => {
  it('creates the user with the email verified', async () => {
    auth.createUser.mockResolvedValue({ uid: 'new' });
    await expect(service().createProvenEmailUser(EMAIL)).resolves.toEqual({
      uid: 'new',
    });
    expect(auth.createUser).toHaveBeenCalledWith({
      email: EMAIL,
      emailVerified: true,
    });
  });

  it("adopts a concurrent request's verified user", async () => {
    auth.createUser.mockRejectedValue(fbError('auth/email-already-exists'));
    auth.getUserByEmail.mockResolvedValue({
      uid: 'other',
      emailVerified: true,
    });
    await expect(service().createProvenEmailUser(EMAIL)).resolves.toEqual({
      uid: 'other',
      emailVerified: true,
    });
  });

  it('refuses if the concurrent user is unverified', async () => {
    auth.createUser.mockRejectedValue(fbError('auth/email-already-exists'));
    auth.getUserByEmail.mockResolvedValue({
      uid: 'other',
      emailVerified: false,
    });
    await expect(service().createProvenEmailUser(EMAIL)).rejects.toThrow(
      'auth/email-already-exists',
    );
  });
});

describe('FirebaseService.lockOutForAdoption', () => {
  it('replaces the password, removes every other way in and revokes sessions', async () => {
    auth.getUser.mockResolvedValue({
      uid: 'u1',
      phoneNumber: '+233200000000',
      providerData: [
        { providerId: 'password' },
        { providerId: 'phone' },
        { providerId: 'google.com' },
      ],
    });
    await service().lockOutForAdoption('u1');
    const [uid, changes] = auth.updateUser.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(uid).toBe('u1');
    expect((changes.password as string).length).toBeGreaterThanOrEqual(32);
    expect(changes.phoneNumber).toBeNull();
    expect(changes.providersToUnlink).toEqual(['google.com']);
    // Not yet verified: that is the last step, so a retry redoes this.
    expect(changes).not.toHaveProperty('emailVerified');
    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith('u1');
    expect(auth.updateUser.mock.invocationCallOrder[0]).toBeLessThan(
      auth.revokeRefreshTokens.mock.invocationCallOrder[0],
    );
  });

  it('reads the account afresh, and adds no password where there was none', async () => {
    auth.getUser.mockResolvedValue({ uid: 'u2', providerData: [] });
    await service().lockOutForAdoption('u2');
    expect(auth.getUser).toHaveBeenCalledWith('u2');
    expect(auth.updateUser).toHaveBeenCalledWith('u2', {});
    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith('u2');
  });
});

describe('FirebaseService.markEmailVerified', () => {
  it('marks only the email verified', async () => {
    await service().markEmailVerified('u1');
    expect(auth.updateUser).toHaveBeenCalledWith('u1', {
      emailVerified: true,
    });
  });
});

describe('FirebaseService.deleteUser', () => {
  it('treats an already-deleted user as done (concurrent delete)', async () => {
    auth.deleteUser.mockRejectedValue(fbError('auth/user-not-found'));
    await expect(service().deleteUser('gone')).resolves.toBeUndefined();
  });

  it('passes on any other failure', async () => {
    auth.deleteUser.mockRejectedValue(fbError('auth/internal-error'));
    await expect(service().deleteUser('u1')).rejects.toThrow(
      'auth/internal-error',
    );
  });
});

describe('FirebaseService.setProvenEmail', () => {
  it('sets the email verified on the own account', async () => {
    await service().setProvenEmail('me', EMAIL);
    expect(auth.updateUser).toHaveBeenCalledWith('me', {
      email: EMAIL,
      emailVerified: true,
    });
  });

  it('reports another account holding the email', async () => {
    auth.updateUser.mockRejectedValue(fbError('auth/email-already-exists'));
    await expect(service().setProvenEmail('me', EMAIL)).rejects.toThrow(
      EmailHeldByOtherFirebaseUser,
    );
  });
});

describe('FirebaseService.customTokenForPhone', () => {
  it("signs in to the number's Firebase account", async () => {
    auth.getUserByPhoneNumber.mockResolvedValue({ uid: 'p1' });
    await expect(service().customTokenForPhone(PHONE)).resolves.toBe(
      'token:p1',
    );
    expect(auth.createUser).not.toHaveBeenCalled();
  });

  it('creates it on first sign-in', async () => {
    auth.getUserByPhoneNumber.mockRejectedValue(fbError('auth/user-not-found'));
    auth.createUser.mockResolvedValue({ uid: 'p2' });
    await expect(service().customTokenForPhone(PHONE)).resolves.toBe(
      'token:p2',
    );
    expect(auth.createUser).toHaveBeenCalledWith({ phoneNumber: PHONE });
  });

  it("adopts a concurrent sign-in's account", async () => {
    auth.getUserByPhoneNumber
      .mockRejectedValueOnce(fbError('auth/user-not-found'))
      .mockResolvedValueOnce({ uid: 'p3' });
    auth.createUser.mockRejectedValue(
      fbError('auth/phone-number-already-exists'),
    );
    await expect(service().customTokenForPhone(PHONE)).resolves.toBe(
      'token:p3',
    );
  });

  it("prefers the backend owner's Firebase account and gives it the number", async () => {
    auth.getUser.mockResolvedValue({ uid: 'owner' });
    await expect(service().customTokenForPhone(PHONE, 'owner')).resolves.toBe(
      'token:owner',
    );
    expect(auth.updateUser).toHaveBeenCalledWith('owner', {
      phoneNumber: PHONE,
    });
    expect(auth.getUserByPhoneNumber).not.toHaveBeenCalled();
  });

  it("still signs the owner in when Firebase won't move the number", async () => {
    auth.getUser.mockResolvedValue({ uid: 'owner' });
    auth.updateUser.mockRejectedValue(
      fbError('auth/phone-number-already-exists'),
    );
    await expect(service().customTokenForPhone(PHONE, 'owner')).resolves.toBe(
      'token:owner',
    );
  });

  it("falls back to the number when the owner's Firebase account is gone", async () => {
    auth.getUser.mockRejectedValue(fbError('auth/user-not-found'));
    auth.getUserByPhoneNumber.mockResolvedValue({ uid: 'p1' });
    await expect(service().customTokenForPhone(PHONE, 'gone')).resolves.toBe(
      'token:p1',
    );
  });
});
