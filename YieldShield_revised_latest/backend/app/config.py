"""
All configuration comes from environment variables (.env in dev).
Nothing here should ever hold a real secret — see .env.example.
"""
import os


def _required(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return val


class Settings:
    # --- Database (yieldshield_app role — least-privilege, see 02_security.sql) ---
    PGHOST = os.environ.get("PGHOST", "localhost")
    PGPORT = os.environ.get("PGPORT", "5432")
    PGDATABASE = os.environ.get("PGDATABASE", "yieldshield")
    PGUSER = os.environ.get("PGUSER", "yieldshield_app")
    PGPASSWORD = os.environ.get("PGPASSWORD", "")
    PGSSLMODE = os.environ.get("PGSSLMODE", "verify-full")
    PGSSLROOTCERT = os.environ.get("PGSSLROOTCERT") or None

    # --- Auth ---
    JWT_SECRET = os.environ.get("JWT_SECRET", "")
    JWT_ALGORITHM = "HS256"
    JWT_EXPIRE_MINUTES = int(os.environ.get("JWT_EXPIRE_MINUTES", "480"))
    RESET_TOKEN_EXPIRE_MINUTES = int(os.environ.get("RESET_TOKEN_EXPIRE_MINUTES", "30"))

    # --- Outbound email (SMTP) ---
    SMTP_HOST = os.environ.get("SMTP_HOST", "")
    SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
    SMTP_USER = os.environ.get("SMTP_USER", "")
    SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
    SMTP_FROM = os.environ.get("SMTP_FROM", "yield.shield1@gmail.com")
    SMTP_USE_TLS = os.environ.get("SMTP_USE_TLS", "true").lower() != "false"

    # Base URL of the deployed frontend, used to build the reset link,
    # e.g. https://app.yieldsh.ph -> https://app.yieldsh.ph/reset-password?token=...
    APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:5173")

    # --- Web Push (device notifications) ---
    # Free — this is the browser-native Web Push standard, not a paid
    # service. Generate with scripts/04_generate_vapid_keys.py, which
    # writes the private key to VAPID_PRIVATE_KEY_FILE and prints the
    # public key to put here.
    VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
    VAPID_PRIVATE_KEY_FILE = os.environ.get("VAPID_PRIVATE_KEY_FILE", "")
    # Required by the VAPID spec as a contact point push services may
    # use if something's wrong with your traffic — any mailto: works.
    VAPID_CLAIM_EMAIL = os.environ.get("VAPID_CLAIM_EMAIL", "mailto:yield.shield1@gmail.com")

    # --- CORS ---
    CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]

    def validate(self):
        _required_at_startup = ["JWT_SECRET", "PGPASSWORD"]
        missing = [v for v in _required_at_startup if not getattr(self, v)]
        if missing:
            raise RuntimeError(
                f"Missing required environment variables: {', '.join(missing)}. "
                "Copy .env.example to .env and fill in real values."
            )


settings = Settings()
