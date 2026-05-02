const db = require('./db');
require('dotenv').config();

const OWNER_EMAIL = process.env.OWNER_EMAIL || 'immshaani11@gmail.com';

async function sendMagicLink(email, token) {
  const link = `${process.env.APP_BASE_URL || 'http://localhost:3000'}/auth/verify?token=${token}`;
  
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const fetch = require('node-fetch');
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM_EMAIL || 'Zbeta <onboarding@resend.dev>',
          to: email,
          subject: 'Zbeta — your sign-in link',
          html: `<p>Open Zbeta: <a href="${link}">${link}</a></p>`
        })
      });
      if (!response.ok) {
        console.error('Failed to send email via Resend:', await response.text());
      } else {
        console.log(`Magic link emailed to ${email}`);
      }
    } catch (err) {
      console.error('Error sending email:', err);
    }
  } else {
    // Fallback for local dev
    console.log('\n=========================================');
    console.log(`MAGIC LINK FOR ${email}:`);
    console.log(link);
    console.log('=========================================\n');
  }
}

function requireAuth(req, res, next) {
  const token = req.cookies.session;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const session = db.getSession(token);
  if (!session) {
    res.clearCookie('session');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  req.user = { email: session.email };
  next();
}

module.exports = {
  OWNER_EMAIL,
  sendMagicLink,
  requireAuth
};
