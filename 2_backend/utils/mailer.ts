import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'equestriaclash@gmail.com',
    pass: process.env.GMAIL_APP_PASSWORD, 
  },
});

export async function sendVerificationEmail(toEmail: string, userId: number) {
  const verificationLink = `https://mlp-tcg-engine.onrender.com/api/auth/confirm-email?userId=${userId}`;

  try {
    const info = await transporter.sendMail({
      from: '"Equestria Clash TCG" <equestriaclash@gmail.com>',
      to: toEmail,
      subject: 'Verify Your Email — Equestria Clash TCG',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 24px; background: #fdf4f8; color: #1c1917; border-radius: 12px; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #db2777; margin-top: 0;">Welcome to Equestria Clash TCG! ✨</h2>
          <p>Please click the button below to verify your email address. Verifying your email lifts Safe Mode restrictions for users aged 13 and older (unlocking chat, community posting, and public deck publishing).</p>
          <a href="${verificationLink}" style="display: inline-block; background: #db2777; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 16px 0;">Verify My Email</a>
          <p style="font-size: 0.85rem; color: #78716c; margin-top: 24px;">If you didn't create an account, you can safely ignore this email.</p>
        </div>
      `,
    });
    console.log('✅ Verification email sent successfully: %s', info.messageId);
    return true;
  } catch (error) {
    console.error('❌ Error sending verification email:', error);
    return false;
  }
}