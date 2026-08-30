#!/usr/bin/env python3
"""
YieldShield — generate a VAPID keypair for Web Push (device notifications).

This is a one-time, free, local operation — no account, no API key,
no third party involved. VAPID (RFC 8292) is how a server proves to
the browser's own push service (Google's for Chrome, Mozilla's for
Firefox, etc.) that it's allowed to send a given user's browser a
push message. You generate the keypair once, keep the private key
file secret on the backend, and the public key gets embedded in the
frontend so the browser can create a subscription tied to it.

Uses the `cryptography` package directly (already installed as a
dependency of pywebpush) rather than py_vapid's own helpers, so this
doesn't depend on exactly which py_vapid version you have.

Usage:
    pip install pywebpush --break-system-packages   # if not already installed
    python3 scripts/04_generate_vapid_keys.py
"""
import base64
import os

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

KEY_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "vapid_private_key.pem"
)


def main():
    if os.path.exists(KEY_FILE):
        print(f"{KEY_FILE} already exists — refusing to overwrite an existing key.")
        print("Delete it first if you really want to generate a new one (this will")
        print("invalidate every device that already subscribed).")
        return

    private_key = ec.generate_private_key(ec.SECP256R1())

    pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    with open(KEY_FILE, "wb") as f:
        f.write(pem)

    # Uncompressed EC point, base64url with no padding — this is the
    # exact format both PushManager.subscribe()'s applicationServerKey
    # and pywebpush expect for the public key.
    raw_public = private_key.public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    public_key_b64 = base64.urlsafe_b64encode(raw_public).decode("utf-8").rstrip("=")

    print(f"\nPrivate key written to: {KEY_FILE}")
    print("Keep that file secret and never commit it — anyone with it could send")
    print("push notifications to your users' devices claiming to be your backend.\n")
    print("=== Add these to backend/.env ===\n")
    print(f"VAPID_PUBLIC_KEY={public_key_b64}")
    print(f"VAPID_PRIVATE_KEY_FILE={KEY_FILE}")
    print("\n=== Add this to YieldShield_ui's frontend env (see YieldShield_ui/.env.example) ===\n")
    print(f"VITE_VAPID_PUBLIC_KEY={public_key_b64}")


if __name__ == "__main__":
    main()
