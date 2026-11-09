import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;

export const sendVerificationEmail = async (toEmail: string, verificationToken: string): Promise<void> => {
  if (!resend) {
    console.warn('RESEND_API_KEY is not configured. Skipping email dispatch.');
    return;
  }

  // Ensure it reads FRONTEND_URL from environment variables correctly, defaulting to Cloudflare Pages
  const frontendUrl = process.env.FRONTEND_URL || 'https://equestria-clash.pages.dev';
  const verificationLink = `${frontendUrl}/verify?token=${verificationToken}`;

  try {
    const { data, error } = await resend.emails.send({
      from: 'MLP TCG Engine <equestriaclash@verify.socalpauper.com>', 
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
    });

    if (error) {
      console.error('Resend API Error:', error);
    } else {
      console.log('Verification email dispatched via Resend:', data);
    }
  } catch (err) {
    console.error('Unexpected error sending email with Resend:', err);
  }
};