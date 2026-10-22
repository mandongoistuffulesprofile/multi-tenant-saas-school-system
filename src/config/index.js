import { config } from 'dotenv';
import { z } from 'zod';

config();

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string(),
  SMTP_HOST: z.string(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string(),
  SMTP_PASS: z.string(),
  EMAIL_FROM: z.string().email(),
  EMAIL_FROM_NAME: z.string().default('Support'),
  RESET_EMAIL_SUBJECT: z.string().default('Reset your password'),
  PASSWORD_CHANGED_SUBJECT: z.string().default('Your password was changed'),
  APP_NAME: z.string().default('YourApp'),
  APP_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PEPPER: z.string().optional(),
  HIBP_API_URL: z.string().url().default('https://haveibeenpwned.com/api/v3/breached/'),
  JWT_SECRET: z.string().min(32),
  SESSION_COOKIE_NAME: z.string().default('sid'),
  SESSION_COOKIE_MAX_AGE: z.coerce.number().default(86400000),
  MAX_RESET_REQUESTS_PER_EMAIL_PER_MIN: z.coerce.number().default(3),
  MAX_RESET_REQUESTS_PER_IP_PER_MIN: z.coerce.number().default(10),
  GLOBAL_RESET_VELOCITY_PER_MIN: z.coerce.number().default(100),
  MAX_LOGIN_ATTEMPTS_PER_ACCOUNT: z.coerce.number().default(10),
  MAX_LOGIN_ATTEMPTS_PER_IP_PER_MIN: z.coerce.number().default(20),
  LOGIN_LOCKOUT_MS: z.coerce.number().default(900000),
  RESET_TOKEN_TTL_MIN: z.coerce.number().default(30),
  ARGON2_MEMORY: z.coerce.number().default(65536),
  ARGON2_TIME: z.coerce.number().default(3),
  ARGON2_PARALLELISM: z.coerce.number().default(4),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;