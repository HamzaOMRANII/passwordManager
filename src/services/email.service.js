const nodemailer = require("nodemailer");

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

function createEmailService(config) {
  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.from, pass: config.smtp.password },
    tls: { minVersion: "TLSv1.2" },
  });

  return {
    verify: () => transporter.verify(),
    sendLoginCode: ({ to, code, expiresInMinutes }) => transporter.sendMail({
      from: `SEC VAULT <${config.smtp.from}>`,
      to,
      subject: "Your SEC VAULT verification code",
      text: `Your SEC VAULT verification code is ${code}. It expires in ${expiresInMinutes} minutes. If you did not request this code, contact your administrator.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h2>SEC VAULT</h2><p>Use this one-time code to complete your sign-in:</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px">${code}</p><p>This code expires in ${expiresInMinutes} minutes and can be used only once.</p><p>If you did not request this code, contact your administrator.</p></div>`,
    }),
    // Security notice to the account's (previous) address after a profile change.
    sendSecurityNotice: ({ to, change }) => transporter.sendMail({
      from: `SEC VAULT <${config.smtp.from}>`,
      to,
      subject: "SEC VAULT security notice",
      text: `${change} on ${new Date().toUTCString()}. If this was not you, contact your administrator immediately.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h2>SEC VAULT</h2><p>${escapeHtml(change)} on ${new Date().toUTCString()}.</p><p>If this was not you, contact your administrator immediately.</p></div>`,
    }),
  };
}

module.exports = { createEmailService };
