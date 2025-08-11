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
async def create_draft(request: DraftRequest) -> DraftResponse:
    # Normalize profile
    profile = Profile(
        name=clean_text(request.profile.name),
        role=clean_text(request.profile.role),
        currentCompany=clean_text(request.profile.currentCompany),
        highestDegree=clean_text(request.profile.highestDegree),
        field=derive_field(request.profile.role),
        schools=[clean_text(s) for s in request.profile.schools if clean_text(s)],
        location=clean_text(request.profile.location),
        linkedinUrl=request.profile.linkedinUrl,
    )

    response = DraftResponse()

    # Handle Notion saving
    if request.options and request.options.saveDraftToNotion:
        if not config.NOTION_API_KEY or not config.NOTION_DATABASE_ID:
            raise HTTPException(status_code=500, detail="Notion is not configured")

        try:
            notion = NotionWrapper(config.NOTION_API_KEY, config.NOTION_DATABASE_ID)
            
            # Get messages from options
            linkedin_message = request.options.linkedinMessage
            email_message = request.options.emailMessage
            
            result = notion.create_profile_page(
                profile, 
                request.ask, 
                linkedin_message=linkedin_message,
                email_message=email_message
            )
            
            response.notion = NotionResult(
                pageId=result["pageId"],
                url=result.get("url"),
                savedFields=result.get("savedFields", {})
            )
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Notion error: {e}")

    # Handle message generation
    if request.options and request.options.messageType:
        message_type = request.options.messageType
        draft, provider, error = await maybe_generate_draft(profile, request.ask, message_type)
        
        if error:
            response.message = error
        elif draft:
            response.draft = draft
            response.provider = provider

    return response 