import "dotenv/config";
import express from "express";
import cors from "cors";
import nodemailer from "nodemailer";

const app = express();
app.use(express.json({ limit: "2mb" }));

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

function mustGet(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function logMailError(err) {
  const details = {
    name: err?.name,
    message: err?.message,
    code: err?.code, // EAUTH, ETIMEDOUT, ECONNECTION, etc.
    command: err?.command,
    response: err?.response,
    responseCode: err?.responseCode, // e.g. 535
    errno: err?.errno,
    syscall: err?.syscall,
    host: err?.host,
    port: err?.port,
  };
  console.error("[mail] ERROR:", details);
}

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
}

const GMAIL_USER = mustGet("GMAIL_USER");
const GMAIL_APP_PASSWORD = mustGet("GMAIL_APP_PASSWORD").replace(/\s+/g, "");
const FROM_NAME = process.env.FROM_NAME || "BCVS";

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true, // REQUIRED for 465
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_APP_PASSWORD,
  },

  // prevent hangs from looking like "silent failures"
  connectionTimeout: 20_000,
  greetingTimeout: 20_000,
  socketTimeout: 30_000,

  // diagnostics (disable later if too noisy)
  logger: true,
  debug: true,
});

// Fail-fast on boot: if this fails, your SMTP auth is broken.
(async () => {
  try {
    const ok = await transporter.verify();
    console.log("[mail] transporter.verify() OK:", ok);
  } catch (err) {
    console.error(
      "[mail] transporter.verify() FAILED. Fix auth/SMTP before testing send."
    );
    logMailError(err);
  }
})();

// Healthcheck
app.get("/health", (_req, res) => res.json({ ok: true }));

// Simple test email
app.post("/api/mail/test", async (req, res) => {
  const { to } = req.body || {};
  if (!isValidEmail(to)) {
    return res.status(400).json({ ok: false, error: "Invalid 'to' email" });
  }

  try {
    const info = await transporter.sendMail({
      from: `"${FROM_NAME}" <${GMAIL_USER}>`,
      to: String(to).trim(),
      subject: "BCVS mailer test",
      text: "If you received this, Nodemailer+Gmail App Password is working.",
      headers: { "X-BCVS-Test": "true" },
    });

    console.log("[mail] test result:", {
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      pending: info.pending,
      response: info.response,
    });

    if (!info.accepted || info.accepted.length === 0) {
      return res.status(502).json({
        ok: false,
        error: "SMTP did not accept any recipients",
        rejected: info.rejected,
        pending: info.pending,
        response: info.response,
      });
    }

    return res.json({
      ok: true,
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      response: info.response,
    });
  } catch (err) {
    logMailError(err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "sendMail failed",
      code: err?.code,
      responseCode: err?.responseCode,
      response: err?.response,
      command: err?.command,
    });
  }
});

/**
 * Send verifier share package email with JSON attachment.
 * Expected body:
 * {
 *   to: "verifier@example.com",
 *   subject?: "BCVS Verifier Package",
 *   shareJson: "{...}",       // stringified JSON
 *   filename?: "bcvs-share.json"
 * }
 */
app.post("/api/mail/send-share", async (req, res) => {
  const { to, subject, shareJson, filename } = req.body || {};

  if (!isValidEmail(to)) {
    return res.status(400).json({ ok: false, error: "Invalid 'to' email" });
  }
  if (typeof shareJson !== "string" || shareJson.trim().length === 0) {
    return res.status(400).json({ ok: false, error: "Missing 'shareJson' string" });
  }

  // Ensure shareJson is valid JSON
  let parsed;
  try {
    parsed = JSON.parse(shareJson);
  } catch {
    return res.status(400).json({ ok: false, error: "'shareJson' is not valid JSON" });
  }

  // Optional sanity checks
  if (!parsed?.credentialId || !parsed?.cid || !parsed?.merkleRoot) {
    return res.status(400).json({
      ok: false,
      error: "Share JSON missing required fields (credentialId/cid/merkleRoot)",
    });
  }

  const safeFilename =
    typeof filename === "string" && filename.trim()
      ? filename.trim().replace(/[^\w.\-]/g, "_")
      : `bcvs-share-${String(parsed.credentialId).slice(0, 10)}.json`;

  const mailSubject =
    typeof subject === "string" && subject.trim()
      ? subject.trim()
      : "BCVS Verifier Package";

  const bodyText =
    `BCVS verifier package attached.\n\n` +
    `credentialId: ${parsed.credentialId}\n` +
    `cid: ${parsed.cid}\n` +
    `issuer: ${parsed.issuerAddress || "n/a"}\n` +
    `subject: ${parsed.subjectAddress || "n/a"}\n` +
    `createdAt: ${parsed.createdAt || "n/a"}\n`;

  try {
    const info = await transporter.sendMail({
      from: `"${FROM_NAME}" <${GMAIL_USER}>`,
      to: String(to).trim(),
      subject: mailSubject,
      text: bodyText,
      attachments: [
        {
          filename: safeFilename,
          content: shareJson,
          contentType: "application/json; charset=utf-8",
        },
      ],
      headers: {
        "X-BCVS-Package": "share",
        "X-BCVS-CredentialId": String(parsed.credentialId).slice(0, 120),
      },
    });

    console.log("[mail] send-share result:", {
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      pending: info.pending,
      response: info.response,
    });

    if (!info.accepted || info.accepted.length === 0) {
      return res.status(502).json({
        ok: false,
        error: "SMTP did not accept any recipients",
        rejected: info.rejected,
        pending: info.pending,
        response: info.response,
      });
    }

    return res.json({
      ok: true,
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      response: info.response,
    });
  } catch (err) {
    logMailError(err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "send-share failed",
      code: err?.code,
      responseCode: err?.responseCode,
      response: err?.response,
      command: err?.command,
    });
  }
});

const PORT = Number(process.env.PORT || 5050);
app.listen(PORT, () => console.log(`[api] listening on http://localhost:${PORT}`));




