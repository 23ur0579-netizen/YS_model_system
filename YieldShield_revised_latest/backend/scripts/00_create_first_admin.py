#!/usr/bin/env python3
"""
YieldShield — generate the SQL to create your first master admin.

POST /auth/register only ever creates Farmer accounts, so there's no
API path to your very first Admin — this prints an INSERT you run
once, directly against the database, to seed it.

Usage:
    pip install passlib bcrypt --break-system-packages   # if not already installed
    python3 scripts/00_create_first_admin.py

Then follow the prompts and paste the printed SQL into psql:
    psql "dbname=yieldshield" -U yieldshield_owner -h localhost
"""
import getpass
import re

from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def main():
    print("YieldShield — first master admin account\n")
    full_name = input("Full name: ").strip()
    email = input("Email: ").strip()
    username_default = re.sub(r"[^a-zA-Z0-9._-]", "", email.split("@")[0]) or "admin"
    username = input(f"Username [{username_default}]: ").strip() or username_default
    phone = input("Phone (optional, press Enter to skip): ").strip()

    while True:
        password = getpass.getpass("Password (min 8 chars, 1 uppercase, 1 number): ")
        if len(password) < 8 or not re.search(r"[A-Z]", password) or not re.search(r"[0-9]", password):
            print("  Doesn't meet the password rule — try again.")
            continue
        confirm = getpass.getpass("Confirm password: ")
        if password != confirm:
            print("  Passwords don't match — try again.")
            continue
        break

    password_hash = pwd_context.hash(password)
    phone_sql = f"'{phone}'" if phone else "NULL"

    sql = f"""
-- Run this once against your database as yieldshield_owner.
SET search_path TO yieldshield, pg_catalog;

INSERT INTO yieldshield.user_account
    (full_name, role, username, email, password_hash, contact_info, admin_role)
VALUES (
    '{full_name.replace("'", "''")}',
    'Admin',
    '{username.replace("'", "''")}',
    '{email.replace("'", "''")}',
    '{password_hash}',
    {phone_sql},
    'master'
);
""".strip()

    print("\n" + "=" * 70)
    print(sql)
    print("=" * 70)
    print("\nPaste the SQL above into psql, then sign in at the app with the")
    print(f"email/username '{email}' and the password you just entered.")


if __name__ == "__main__":
    main()
