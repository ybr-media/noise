export async function sendEmail(message: {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}): Promise<void> {
  const key = process.env.AUTH_RESEND_KEY?.trim();
  const from = process.env.AUTH_EMAIL_FROM?.trim();
  if (!key || !from) throw new Error("Resend email configuration is missing.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(message.headers ? { headers: message.headers } : {}),
    }),
  });
  if (!response.ok) throw new Error(`Unable to send email: ${await response.text()}`);
}
