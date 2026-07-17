const nodemailer = require('nodemailer');
const twilio = require('twilio');

// Email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.sendgrid.net',
  port: parseInt(process.env.SMTP_PORT) || 587,
  auth: {
    user: process.env.SMTP_USER || 'apikey',
    pass: process.env.SMTP_PASS || process.env.SENDGRID_API_KEY
  }
});

// Twilio client
const twilioClient = process.env.TWILIO_SID ? twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN) : null;

const sendEmail = async ({ to, subject, html, from = 'noreply@sentinels-signin.com' }) => {
  try {
    if (!process.env.SMTP_PASS && !process.env.SENDGRID_API_KEY) {
      console.log('Email would be sent (no SMTP configured):', { to, subject });
      return { success: true, simulated: true };
    }

    await transporter.sendMail({ from, to, subject, html });
    return { success: true };
  } catch (err) {
    console.error('Email send failed:', err);
    return { success: false, error: err.message };
  }
};

const sendSMS = async ({ to, body, from = process.env.TWILIO_PHONE_NUMBER }) => {
  try {
    if (!twilioClient) {
      console.log('SMS would be sent (no Twilio configured):', { to, body });
      return { success: true, simulated: true };
    }

    const message = await twilioClient.messages.create({ body, from, to });
    return { success: true, sid: message.sid };
  } catch (err) {
    console.error('SMS send failed:', err);
    return { success: false, error: err.message };
  }
};

module.exports = { sendEmail, sendSMS };
