// Netlify Functions are stateless between invocations (no shared server
// memory), so instead of express-session (which needs a memory/store),
// we sign the logged-in user's identity into a JWT and keep it in an
// httpOnly cookie. Every request verifies the cookie instead of looking
// up a server-side session.
const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'session';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('Липсва SESSION_SECRET в environment variables.');
  return s;
}

function issueSession(res, user) {
  const token = jwt.sign({ uid: user.id, username: user.username }, secret(), { expiresIn: '30d' });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_MS,
    path: '/',
  });
}

function clearSession(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

function currentUser(req) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, secret());
    return { id: payload.uid, username: payload.username };
  } catch (e) {
    return null;
  }
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.redirect('/login');
  req.user = user;
  next();
}

module.exports = { issueSession, clearSession, currentUser, requireAuth };
