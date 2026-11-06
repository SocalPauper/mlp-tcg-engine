import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER || 'equestriaclash@gmail.com',
    pass: process.env.GMAIL_APP_PASSWORD || ''
  }
});

export async function sendVerificationEmail(toEmail: string, userId: number | string) {
  const backendUrl = process.env.BACKEND_URL || 'https://mlp-tcg-engine.onrender.com';
  const verificationUrl = `${backendUrl}/api/auth/confirm-email?userId=${userId}`;

  const mailOptions = {
    from: '"Equestria Clash TCG" <equestriaclash@gmail.com>',
    to: toEmail,
    subject: 'Verify Your Email - Equestria Clash TCG',
    html: `
      <div style="font-family: Arial, sans-serif; background: #fdf4f8; padding: 30px; color: #1c1917; border-radius: 8px;">
        <h2 style="color: #db2777;">Welcome to Equestria Clash TCG! ✨</h2>
        <p>Please click the button below to verify your email address. Verifying your email lifts Safe Mode restrictions for users aged 13 and older (unlocking chat, community posting, and public deck publishing).</p>
        <div style="margin: 30px 0;">
          <a href="${verificationUrl}" style="background-color: #db2777; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Verify Email Address</a>
        </div>
        <p style="font-size: 12px; color: #78716c;">If you did not request this, please ignore this email.</p>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[MAILER] Verification email successfully sent to ${toEmail}`);
  } catch (err: any) {
    console.error('[MAILER ERROR] Failed to send email via Gmail:', err.message);
  }
}