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

    # --- Outbound email (Brevo transactional email REST API) ---
    # Switched from raw SMTP: SMTP ports (25/465/587) are very commonly
    # blocked by campus/venue wifi and mobile hotspots (this is what
    # broke email during the live presentation), while this HTTPS API
    # call goes out on port 443 like any normal web request. Free tier:
    # 300 emails/day, no credit card, no expiry — https://app.brevo.com
    # (Settings -> SMTP & API -> API Keys). The sender email/name must
    # be a verified sender in that same Brevo account.
    BREVO_API_KEY = os.environ.get("BREVO_API_KEY", "")
    EMAIL_FROM = os.environ.get("EMAIL_FROM", "yield.shield1@gmail.com")
    EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "YieldShield")

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

    # --- ML retraining (POST /admin/model/retrain, master/verification
    # admins only — see app/ml_retrain.py) ---
    # Path to the YieldShield_ML project (the R pipeline), relative to
    # this backend's own working directory by default — override if
    # it's deployed somewhere else on the same machine. Retraining
    # shells out to Rscript here, so this only works when R and the
    # pipeline's R packages are installed on the same host as this API.
    ML_DIR = os.environ.get("YIELDSHIELD_ML_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "..", "YieldShield_ML"))
    RSCRIPT_BIN = os.environ.get("RSCRIPT_BIN", "Rscript")
    # Generous ceiling per Rscript call (data extraction, then the full
    # 01-10 pipeline) — training on a small municipal dataset shouldn't
    # come close to this, but a genuinely stuck R process shouldn't be
    # able to tie up the retrain slot forever either.
    ML_RETRAIN_TIMEOUT_SECONDS = int(os.environ.get("YIELDSHIELD_ML_RETRAIN_TIMEOUT_SECONDS", str(30 * 60)))

    def validate(self):
        _required_at_startup = ["JWT_SECRET", "PGPASSWORD"]
        missing = [v for v in _required_at_startup if not getattr(self, v)]
        if missing:
            raise RuntimeError(
                f"Missing required environment variables: {', '.join(missing)}. "
                "Copy .env.example to .env and fill in real values."
            )


settings = Settings()
