import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

// Use require for the JS package as it doesn't have types and exports a plain array
// eslint-disable-next-line @typescript-eslint/no-require-imports
const DISPOSABLE_DOMAINS = require('disposable-email-domains') as string[];
const PLACEHOLDER_DOMAINS = ['example.com', 'test.com'];
const BANNED_DOMAINS = [...DISPOSABLE_DOMAINS, ...PLACEHOLDER_DOMAINS];

@ValidatorConstraint({ name: 'isNotDisposableEmail', async: false })
export class IsNotDisposableEmailConstraint implements ValidatorConstraintInterface {
  validate(email: string) {
    if (!email || typeof email !== 'string') return false;
    const domain = email.split('@')[1]?.toLowerCase();
    return !BANNED_DOMAINS.includes(domain);
  }

  defaultMessage() {
    return 'This email domain is not allowed. Please use a valid, non-disposable email address.';
  }
}

export function IsNotDisposableEmail(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsNotDisposableEmailConstraint,
    });
  };
}
