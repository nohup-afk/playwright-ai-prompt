import 'dotenv/config';

/**
 * Test environment configuration, sourced from .env (see .env.example).
 * Keeps the target URL and credentials out of the committed specs.
 */
export const BASE_URL = process.env.BASE_URL || 'https://www.saucedemo.com';

/** Default test credentials. Override per spec by passing your own params. */
export const CREDENTIALS = {
  username: process.env.TEST_USERNAME || 'standard_user',
  password: process.env.TEST_PASSWORD || 'secret_sauce',
};
