"""
Small shared helper for resolving the UI's human-readable barangay
label (e.g. "San Felipe Central") to/from yieldshield.barangay's
surrogate key. Used by both the farm-input and user-management
routers so the lookup logic (and its error message) only lives once.
"""
from fastapi import HTTPException, status


def barangay_id_from_name(cur, barangay_name: str) -> int:
    cur.execute(
        "SELECT barangay_id FROM yieldshield.barangay WHERE barangay_name = %s",
        (barangay_name,),
    )
    row = cur.fetchone()
    if row is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown barangay: {barangay_name}")
    return row["barangay_id"]
