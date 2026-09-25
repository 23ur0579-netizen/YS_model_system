"""
Shared return type for every advisory/tip module (season_advisory,
price_advisory, variety_advisory, personalized_tips, and
notifications.py's own weather advisory) — lets each one hand back a
translation key + the raw values to fill it in, instead of a
pre-rendered English sentence, so the frontend's existing i18n.tsx can
render it in whatever language the person actually has selected
(matches the {placeholder} substitution translate() already does for
every other piece of UI text).

title_en/body_en are kept as a plain-English fallback — for any client
that hasn't picked up the key-based rendering yet, and so a failure to
find a key still shows readable text instead of a raw key string.
"""
from dataclasses import dataclass, field


@dataclass
class AdvisoryText:
    title_key: str
    body_key: str
    title_en: str
    body_en: str
    params: dict = field(default_factory=dict)
