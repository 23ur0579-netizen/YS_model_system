"""
Sends transactional emails (password reset, registration approval,
account credentials) via Brevo's REST API over HTTPS.

This replaced a raw-smtplib implementation that failed during a live
presentation — SMTP ports (25/465/587) are very commonly blocked by
venue/campus wifi and mobile hotspots, while this is a plain HTTPS POST
on port 443 like any other web request, so it isn't subject to the
same port-blocking.

If BREVO_API_KEY isn't configured (e.g. local dev), the email is
printed to the console instead of failing the request, so every flow
that sends an email is still testable end-to-end without real
credentials — same fallback behaviour as before.

Setup: create a free account at https://app.brevo.com (300 emails/day,
no credit card, no expiry), verify a sender email/domain under
Senders, Domains & Dedicated IPs, then create an API key under
SMTP & API -> API Keys and put it in .env as BREVO_API_KEY. EMAIL_FROM
must be that verified sender address.
"""
import logging

import httpx

from .config import settings

logger = logging.getLogger("yieldshield.email")

_BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email"


class EmailSendError(Exception):
    """Raised when Brevo rejects or fails to deliver a send request."""


def _send(to_email: str, to_name: str, subject: str, text: str, html: str) -> None:
    if not settings.BREVO_API_KEY:
        # Dev fallback: no API key configured, log instead of sending.
        logger.warning("BREVO_API_KEY not configured — email to %s not sent:\nSubject: %s\n%s", to_email, subject, text)
        return

    payload = {
        "sender": {"name": settings.EMAIL_FROM_NAME, "email": settings.EMAIL_FROM},
        "to": [{"email": to_email, "name": to_name}],
        "subject": subject,
        "htmlContent": html,
        "textContent": text,
    }
    try:
        resp = httpx.post(
            _BREVO_ENDPOINT,
            json=payload,
            headers={
                "api-key": settings.BREVO_API_KEY,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            timeout=10.0,
        )
    except httpx.HTTPError as exc:
        raise EmailSendError(f"Could not reach Brevo's API: {exc}") from exc

    if resp.status_code >= 300:
        # Brevo's error body is {"code": "...", "message": "..."} — surface
        # both since "invalid_parameter: sender not verified" is a lot
        # more actionable in the logs than a bare 400.
        try:
            detail = resp.json()
        except ValueError:
            detail = resp.text
        raise EmailSendError(f"Brevo rejected the email (HTTP {resp.status_code}): {detail}")


def _card(inner_html: str) -> str:
    return f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      {inner_html}
    </div>
    """


def _button(href: str, label: str) -> str:
    return (
        f'<a href="{href}" style="display:inline-block;padding:10px 18px;background:#059669;'
        f'color:#fff;text-decoration:none;border-radius:6px;">{label}</a>'
    )


def send_password_reset_email(to_email: str, raw_token: str) -> None:
    reset_link = f"{settings.APP_BASE_URL.rstrip('/')}/reset-password?token={raw_token}"

    text = (
        "You requested a password reset for your YieldShield account.\n\n"
        f"Reset your password here (expires in {settings.RESET_TOKEN_EXPIRE_MINUTES} minutes):\n"
        f"{reset_link}\n\n"
        "If you did not request this, you can safely ignore this email — "
        "your password will not be changed."
    )
    html = _card(f"""
      <h2 style="color:#059669;">YieldShield password reset</h2>
      <p>You requested a password reset for your YieldShield account.</p>
      <p>{_button(reset_link, "Reset my password")}</p>
      <p style="color:#64748b;font-size:13px;">
        This link expires in {settings.RESET_TOKEN_EXPIRE_MINUTES} minutes.
        If you did not request this, you can ignore this email.
      </p>
    """)
    _send(to_email, "", "Reset your YieldShield password", text, html)


def send_registration_approved_email(to_email: str, full_name: str, raw_token: str) -> None:
    # Distinct from send_password_reset_email's /reset-password link: this
    # applicant has no user_account row yet (only a registration_request
    # row) — /auth/reset-password would 400 for them. Login.tsx tells the
    # two flows apart by whether `email` is present in the query string,
    # so it must be included here (URL-encoded — emails can contain
    # characters like '+' that are meaningful in a query string).
    from urllib.parse import quote

    continue_link = (
        f"{settings.APP_BASE_URL.rstrip('/')}/complete-registration"
        f"?email={quote(to_email)}&token={quote(raw_token)}"
    )

    text = (
        f"Hi {full_name},\n\n"
        "Your YieldShield account registration has been approved. "
        f"Finish setting up your account here (expires in 14 days):\n{continue_link}\n\n"
        "If you did not request this, you can safely ignore this email."
    )
    html = _card(f"""
      <h2 style="color:#059669;">Your registration was approved</h2>
      <p>Hi {full_name},</p>
      <p>Your YieldShield account registration has been approved. Finish setting up your account and choose a password:</p>
      <p>{_button(continue_link, "Finish setting up my account")}</p>
      <p style="color:#64748b;font-size:13px;">
        This link expires in 14 days. If you did not request this, you can ignore this email.
      </p>
    """)
    _send(to_email, full_name, "Your YieldShield registration was approved", text, html)


def send_credentials_email(
    to_email: str, full_name: str, username: str, password: str, is_new_account: bool = True
) -> None:
    subject = "Your YieldShield account is ready" if is_new_account else "Your YieldShield password was reset"
    intro = (
        "An account has been created for you on YieldShield."
        if is_new_account
        else "Your YieldShield password has been reset by an administrator."
    )
    text = (
        f"Hi {full_name},\n\n"
        f"{intro}\n\n"
        f"Username: {username}\n"
        f"Password: {password}\n\n"
        "Please sign in and change this password as soon as possible."
    )
    html = _card(f"""
      <h2 style="color:#059669;">YieldShield</h2>
      <p>Hi {full_name},</p>
      <p>{intro}</p>
      <p><strong>Username:</strong> {username}<br/>
         <strong>Password:</strong> {password}</p>
      <p style="color:#64748b;font-size:13px;">
        Please sign in and change this password as soon as possible.
      </p>
    """)
    _send(to_email, full_name, subject, text, html)
