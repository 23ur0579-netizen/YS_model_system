"""
Connection pool for the yieldshield_app role, plus a context manager
that sets the two RLS session variables (app.current_user_id,
app.role) that 02_security.sql's row-level-security policies key off
of. Every request that touches user_account / farm_profile /
farm_input_log / password_reset_token must go through
`get_conn(user_id, role)` so Postgres enforces the same per-row
restrictions the DB team already designed, not just app-layer checks.
"""
import contextlib

import psycopg2
import psycopg2.extras
import psycopg2.pool

from .config import settings

_pool: psycopg2.pool.ThreadedConnectionPool | None = None


def init_pool(minconn: int = 1, maxconn: int = 10):
    global _pool
    if _pool is not None:
        return
    _pool = psycopg2.pool.ThreadedConnectionPool(
        minconn,
        maxconn,
        host=settings.PGHOST,
        port=settings.PGPORT,
        dbname=settings.PGDATABASE,
        user=settings.PGUSER,
        password=settings.PGPASSWORD,
        sslmode=settings.PGSSLMODE,
        sslrootcert=settings.PGSSLROOTCERT,
        connect_timeout=10,
        options="-c search_path=yieldshield,public",
        cursor_factory=psycopg2.extras.RealDictCursor,
    )


def close_pool():
    global _pool
    if _pool is not None:
        _pool.closeall()
        _pool = None


@contextlib.contextmanager
def get_conn(user_id: int | None = None, role: str | None = None):
    """
    Yields a connection with app.current_user_id / app.role set for
    the duration of the transaction (RLS reads these via
    yieldshield.current_app_user_id() / current_app_role()).

    Use user_id=None, role=None for pre-auth operations (login lookup,
    registration, forgot/reset password). Those go through the
    SECURITY DEFINER functions added in migrations/03_auth_reset.sql
    (auth_find_user_by_identifier, auth_register_farmer, etc.) instead
    of querying user_account directly — RLS would otherwise hide every
    row from a connection that hasn't set app.current_user_id yet,
    which is exactly right for ordinary queries but wrong for the
    handful of operations that have to run before we know who the
    caller is.
    """
    if _pool is None:
        init_pool()
    conn = _pool.getconn()
    try:
        with conn:
            with conn.cursor() as cur:
                # SET LOCAL only lasts for the current transaction, which is
                # exactly the lifetime we want (one request = one transaction).
                if user_id is not None:
                    cur.execute("SET LOCAL app.current_user_id = %s", (str(user_id),))
                if role is not None:
                    cur.execute("SET LOCAL app.role = %s", (role,))
            yield conn
    finally:
        _pool.putconn(conn)
