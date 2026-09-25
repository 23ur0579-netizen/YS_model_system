import logging

# Must run before importing .config, so Settings() picks up values
# from .env instead of requiring them to be exported by hand every
# time. In production, prefer real environment variables / a secrets
# manager over a .env file — python-dotenv silently no-ops if there's
# no .env present, so this is safe either way.
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import close_pool, init_pool
from .routers import announcements, audit, auth, crop_varieties, farm_input, farms, fields, model_admin, notifications, push, registrations, reports, seed_distribution, tasks, users, weather

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="YieldShield API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(farm_input.router)
app.include_router(farms.router)
app.include_router(users.router)
app.include_router(fields.router)
app.include_router(tasks.router)
app.include_router(announcements.router)
app.include_router(registrations.router)
app.include_router(audit.router)
app.include_router(weather.router)
app.include_router(notifications.router)
app.include_router(push.router)
app.include_router(reports.router)
app.include_router(seed_distribution.router)
app.include_router(crop_varieties.router)
app.include_router(model_admin.router)


@app.on_event("startup")
def on_startup():
    settings.validate()
    init_pool()


@app.on_event("shutdown")
def on_shutdown():
    close_pool()


@app.get("/health")
def health():
    return {"status": "ok"}
