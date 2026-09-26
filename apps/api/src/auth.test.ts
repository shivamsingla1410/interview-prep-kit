import test from 'node:test';
import assert from 'node:assert/strict';
import { loginSchema, registerSchema } from './auth.js';

test('registration requires full name, valid email, and a sufficiently long password', () => {
  assert.equal(registerSchema.safeParse({ fullName: 'A', email: 'nope', password: 'short' }).success, false);
  const result = registerSchema.parse({ fullName: 'Ada Lovelace', email: ' ADA@EXAMPLE.COM ', password: 'a-long-password' });
  assert.equal(result.email, 'ada@example.com');
});

test('login requires valid email and password and normalizes email', () => {
  assert.equal(loginSchema.safeParse({ email: 'ada', password: '' }).success, false);
  assert.deepEqual(loginSchema.parse({ email: ' ADA@example.com ', password: 'secret' }), { email: 'ada@example.com', password: 'secret' });
});
