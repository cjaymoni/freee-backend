import * as Joi from 'joi';

const twilioSetting = () =>
  Joi.when('SMS_PROVIDER', {
    is: 'twilio',
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').optional(),
  });

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test', 'provision')
    .default('development'),
  PORT: Joi.number().default(3000),

  // Database
  DATABASE_URL: Joi.string().optional(),
  DB_HOST: Joi.string().optional(),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().optional(),
  DB_PASSWORD: Joi.string().optional(),
  DB_DATABASE: Joi.string().optional(),
  DB_POOL_MAX: Joi.number().default(20),
  DB_POOL_MIN: Joi.number().default(2),
  DB_IDLE_TIMEOUT: Joi.number().default(30000),
  DB_CONNECTION_TIMEOUT: Joi.number().default(2000),

  // Redis
  REDIS_HOST: Joi.string().optional(),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  UPSTASH_REDIS_REST_URL: Joi.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: Joi.string().optional(),

  // OpenStreetMap places merged into the cities list
  OVERPASS_URL: Joi.string().uri().optional(),
  // Names item locations posted as bare coordinates
  NOMINATIM_URL: Joi.string().uri().optional(),

  // JWT
  JWT_SECRET: Joi.string().required(),

  // Cloudinary
  CLOUDINARY_CLOUD_NAME: Joi.string().required(),
  CLOUDINARY_API_KEY: Joi.string().required(),
  CLOUDINARY_API_SECRET: Joi.string().required(),

  // SMTP (Brevo / Other)
  SMTP_HOST: Joi.string().required(),
  SMTP_PORT: Joi.number().default(587),
  SMTP_USER: Joi.string().required(),
  SMTP_PASS: Joi.string().required(),

  // Security
  MAX_LOGIN_ATTEMPTS: Joi.number().default(5),
  LOCKOUT_DURATION_MINUTES: Joi.number().default(30),
  PASSWORD_MIN_LENGTH: Joi.number().default(8),

  // Phone sign-in SMS. `firebase`: clients send codes with the Firebase SDK
  // and fall back to the backend (Twilio) only when Firebase refuses to send.
  // `twilio`: clients always ask the backend. See docs/SMS_PROVIDERS.md.
  SMS_PROVIDER: Joi.string().valid('firebase', 'twilio').default('firebase'),
  SMS_FALLBACK_ENABLED: Joi.boolean().default(true),
  // Comma-separated E.164 prefixes the backend will text; mirrors the
  // Firebase SMS region policy.
  SMS_ALLOWED_PREFIXES: Joi.string().default('+233'),
  // Required once Twilio is the provider, so a missing one stops the app
  // instead of quietly leaving Firebase as the only sender.
  TWILIO_ACCOUNT_SID: twilioSetting(),
  TWILIO_AUTH_TOKEN: twilioSetting(),
  TWILIO_VERIFY_SERVICE_SID: twilioSetting(),

  // Email sign-in. `firebase`: clients send Firebase email links and fall
  // back to a code from the backend when Firebase refuses. `server`: clients
  // always use backend codes (sent over SMTP). See docs/EMAIL_SIGN_IN.md.
  EMAIL_PROVIDER: Joi.string().valid('firebase', 'server').default('firebase'),
  EMAIL_FALLBACK_ENABLED: Joi.boolean().default(true),

  // Pre-launch Founding Freers sign-up; close it at launch.
  FOUNDING_FREERS_OPEN: Joi.boolean().default(false),

  // Logging
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug', 'verbose')
    .default('info'),
});
