import test from 'node:test';
import assert from 'node:assert/strict';

test('registration, unique email, login/logout, and per-user history', async () => {
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/trao-prep-test';
  process.env.SESSION_SECRET = 'integration-test-secret-that-is-long-enough';
  process.env.GROQ_API_KEY = '';
  process.env.TAVILY_API_KEY = '';
  const [{ app, connectDatabase, sessionStore }, mongooseModule, models] = await Promise.all([import('./app.js'), import('mongoose'), import('./models.js')]);
  const mongoose = mongooseModule.default;
  await connectDatabase();
  await mongoose.connection.dropDatabase();
  await Promise.all([models.User.init(), models.Kit.init()]);
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const call = (path: string, options: RequestInit = {}) => fetch(`${base}${path}`, { ...options, headers: { 'content-type': 'application/json', ...options.headers } });
  const cookieFrom = (response: Response) => response.headers.get('set-cookie')?.split(';')[0] || '';
  try {
    const registered = await call('/api/auth/register', { method: 'POST', body: JSON.stringify({ fullName: 'Ada Lovelace', email: 'ADA@example.com', password: 'long-enough-password' }) });
    assert.equal(registered.status, 201);
    const userOneCookie = cookieFrom(registered);
    assert.ok(userOneCookie.startsWith('trao.sid='));
    assert.equal((await call('/api/auth/me', { headers: { cookie: userOneCookie } })).status, 200);

    const duplicate = await call('/api/auth/register', { method: 'POST', body: JSON.stringify({ fullName: 'Ada Again', email: 'ada@example.com', password: 'long-enough-password' }) });
    assert.equal(duplicate.status, 409);
    const badPassword = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'ada@example.com', password: 'wrong-password' }) });
    assert.equal(badPassword.status, 401);
    const login = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'ada@example.com', password: 'long-enough-password' }) });
    assert.equal(login.status, 200);
    const loginCookie = cookieFrom(login);

    const saved = await call('/api/kits', { method: 'POST', headers: { cookie: loginCookie }, body: JSON.stringify({ title: 'Backend Engineer', companyUrl: 'http://127.0.0.1:1', jobDescription: 'A detailed role description with more than twenty characters.', daysAvailable: 5 }) });
    assert.equal(saved.status, 202);
    const savedResult = await saved.json() as { kit: { id: string } };
    let generatedState: { kit: { status: string } } | undefined;
    for (let attempt = 0; attempt < 20; attempt++) {
      const status = await call(`/api/kits/${savedResult.kit.id}`, { headers: { cookie: loginCookie } });
      generatedState = await status.json() as { kit: { status: string } };
      if (generatedState.kit.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(generatedState?.kit.status, 'failed');
    const other = await call('/api/auth/register', { method: 'POST', body: JSON.stringify({ fullName: 'Grace Hopper', email: 'grace@example.com', password: 'long-enough-password' }) });
    const otherCookie = cookieFrom(other);
    const isolated = await call('/api/kits', { headers: { cookie: otherCookie } });
    assert.deepEqual((await isolated.json()).kits, []);

    assert.equal((await call('/api/auth/logout', { method: 'POST', headers: { cookie: loginCookie } })).status, 204);
    assert.equal((await call('/api/auth/me', { headers: { cookie: loginCookie } })).status, 401);
    assert.equal((await call('/api/kits')).status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await mongoose.connection.dropDatabase();
    await sessionStore.close();
    await mongoose.disconnect();
  }
});
