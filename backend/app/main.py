from __future__ import annotations
import os
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .schemas import DraftRequest, DraftResponse, NotionResult, Profile
from .normalization import clean_text, derive_field, pick_highest_degree
from .email import maybe_generate_draft
from .notion_client import NotionWrapper
from . import config

app = FastAPI(title="Connoction Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


@app.post("/draft", response_model=DraftResponse)
async def create_draft(payload: DraftRequest) -> DraftResponse:
    if not (config.NOTION_API_KEY and config.NOTION_DATABASE_ID):
        raise HTTPException(status_code=500, detail="Notion is not configured")

    # Normalize profile
    profile = _normalize_profile(payload.profile)

    # Always create Notion page first
    notion = NotionWrapper(config.NOTION_API_KEY, config.NOTION_DATABASE_ID)

    draft_text: Optional[str] = None
    provider: Optional[str] = None
    message: Optional[str] = None

    # Generate draft if OpenAI configured
    draft, provider, message = await maybe_generate_draft(profile, payload.ask)
    if draft:
        draft_text = f"Subject: {draft.subject}\n\n{draft.body}".strip()

    # Save to Notion (including optional draft)
    try:
        page = notion.create_profile_page(
            profile=profile,
            ask=payload.ask,
            draft_text=draft_text if (payload.options and payload.options.saveDraftToNotion) else None,
            draft_destination=(payload.options.draftDestination if payload.options else None),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Notion error: {exc}") from exc

    notion_result = NotionResult(
        pageId=page.get("id"),
        url=page.get("url"),
        savedFields=profile,
    )

    return DraftResponse(
        notion=notion_result,
        draft=draft,
        provider=provider,  # "openai" or None
        message=message,
    )


def _normalize_profile(p: Profile) -> Profile:
    name = clean_text(p.name)
    role = clean_text(p.role)
    current_company = clean_text(p.currentCompany)
    highest_degree = clean_text(p.highestDegree)
    field = p.field or derive_field(role)
    schools = [s for s in (p.schools or []) if s]
    location = clean_text(p.location)

    # If highestDegree not provided but schools contain degree info, try to pick
    if not highest_degree and schools:
        hd = pick_highest_degree([p.highestDegree] + schools if p.highestDegree else schools)
        highest_degree = hd

    return Profile(
        name=name,
        role=role,
        currentCompany=current_company,
        highestDegree=highest_degree,
        field=field,
        schools=schools,
        location=location,
        linkedinUrl=p.linkedinUrl,
    ) 