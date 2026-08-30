"""
Sends the "reset your password" email. Uses plain smtplib so it works
with any SMTP provider (SES, SendGrid SMTP relay, Postmark, a real
mail server, etc.) — just fill in SMTP_* in .env.

If SMTP_HOST isn't configured (e.g. local dev), the email is printed
to the console instead of failing the request, so the reset flow is
still testable end-to-end without real credentials.
"""
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from .config import settings

logger = logging.getLogger("yieldshield.email")


def _build_reset_email(to_email: str, reset_link: str) -> MIMEMultipart:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Reset your YieldShield password"
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to_email

    text = (
        "You requested a password reset for your YieldShield account.\n\n"
        f"Reset your password here (expires in {settings.RESET_TOKEN_EXPIRE_MINUTES} minutes):\n"
        f"{reset_link}\n\n"
        "If you did not request this, you can safely ignore this email — "
        "your password will not be changed."
    )
    html = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color:#059669;">YieldShield password reset</h2>
      <p>You requested a password reset for your YieldShield account.</p>
      <p>
        <a href="{reset_link}"
           style="display:inline-block;padding:10px 18px;background:#059669;
                  color:#fff;text-decoration:none;border-radius:6px;">
          Reset my password
        </a>
      </p>
      <p style="color:#64748b;font-size:13px;">
        This link expires in {settings.RESET_TOKEN_EXPIRE_MINUTES} minutes.
        If you did not request this, you can ignore this email.
      </p>
    </div>
    """
    msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html, "html"))
    return msg


def send_password_reset_email(to_email: str, raw_token: str) -> None:
    reset_link = f"{settings.APP_BASE_URL.rstrip('/')}/reset-password?token={raw_token}"

    if not settings.SMTP_HOST:
        # Dev fallback: no SMTP configured, log the link instead of sending.
        logger.warning("SMTP not configured — reset link for %s: %s", to_email, reset_link)
        return

    msg = _build_reset_email(to_email, reset_link)
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
        if settings.SMTP_USE_TLS:
            server.starttls()
        if settings.SMTP_USER:
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.sendmail(settings.SMTP_FROM, [to_email], msg.as_string())


def _build_registration_approved_email(to_email: str, full_name: str, continue_link: str) -> MIMEMultipart:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Your YieldShield registration was approved"
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to_email

    text = (
        f"Hi {full_name},\n\n"
        "Your YieldShield account registration has been approved. "
        f"Finish setting up your account here (expires in 14 days):\n{continue_link}\n\n"
        "If you did not request this, you can safely ignore this email."
    )
    html = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color:#059669;">Your registration was approved</h2>
      <p>Hi {full_name},</p>
      <p>Your YieldShield account registration has been approved. Finish setting up your account and choose a password:</p>
      <p>
        <a href="{continue_link}"
           style="display:inline-block;padding:10px 18px;background:#059669;
                  color:#fff;text-decoration:none;border-radius:6px;">
          Finish setting up my account
        </a>
      </p>
      <p style="color:#64748b;font-size:13px;">
        This link expires in 14 days. If you did not request this, you can ignore this email.
      </p>
    </div>
    """
    msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html, "html"))
    return msg


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

    if not settings.SMTP_HOST:
        logger.warning("SMTP not configured — registration approval link for %s: %s", to_email, continue_link)
        return

    msg = _build_registration_approved_email(to_email, full_name, continue_link)
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
        if settings.SMTP_USE_TLS:
            server.starttls()
        if settings.SMTP_USER:
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.sendmail(settings.SMTP_FROM, [to_email], msg.as_string())


def _build_credentials_email(
    to_email: str, full_name: str, username: str, password: str, is_new_account: bool
) -> MIMEMultipart:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Your YieldShield account is ready" if is_new_account else "Your YieldShield password was reset"
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to_email

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
    html = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color:#059669;">YieldShield</h2>
      <p>Hi {full_name},</p>
      <p>{intro}</p>
      <p><strong>Username:</strong> {username}<br/>
         <strong>Password:</strong> {password}</p>
      <p style="color:#64748b;font-size:13px;">
        Please sign in and change this password as soon as possible.
      </p>
    </div>
    """
    msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html, "html"))
    return msg


def send_credentials_email(
    to_email: str, full_name: str, username: str, password: str, is_new_account: bool = True
) -> None:
    if not settings.SMTP_HOST:
        # Dev fallback: no SMTP configured, log the credentials instead of sending.
        logger.warning(
            "SMTP not configured — credentials for %s (%s): username=%s password=%s",
            to_email,
            "new account" if is_new_account else "reset",
            username,
            password,
        )
        return

    msg = _build_credentials_email(to_email, full_name, username, password, is_new_account)
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
        if settings.SMTP_USE_TLS:
            server.starttls()
        if settings.SMTP_USER:
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.sendmail(settings.SMTP_FROM, [to_email], msg.as_string())
