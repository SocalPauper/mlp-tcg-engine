import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, // Use SSL/TLS
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    // Do not fail on invalid certs in cloud environments
    rejectUnauthorized: false
  }
});

export const sendVerificationEmail = async (toEmail: string, verificationToken: string): Promise<void> => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const verificationLink = `${frontendUrl}/verify?token=${verificationToken}`;

  const mailOptions = {
    from: `"MLP TCG Engine" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: 'Confirm Your MLP TCG Engine Account',
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2 style="color: #6b46c1;">Welcome to MLP TCG Engine!</h2>
        <p>Thank you for registering. Please click the button below to verify your email address and activate your account:</p>
        <a href="${verificationLink}" style="display: inline-block; padding: 10px 20px; background-color: #805ad5; color: #ffffff; text-decoration: none; border-radius: 5px; margin-top: 15px;">Verify Email</a>
        <p style="margin-top: 20px; font-size: 12px; color: #718096;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};