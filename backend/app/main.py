from __future__ import annotations
import os
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
import time

from .schemas import DraftRequest, DraftResponse, NotionResult, Profile
from .normalization import clean_text, derive_field, pick_highest_degree
from .email import maybe_generate_draft, classify_field_with_llm, parse_linkedin_profile_with_llm
from .notion_client import NotionWrapper
from . import config
from .logging_config import setup_logging, get_logger

# Setup logging
setup_logging("DEBUG")
logger = get_logger(__name__)

app = FastAPI(title="Connoction Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add request logging middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.time()
    
    # Log incoming request
    logger.info(f"📨 {request.method} {request.url}")
    
    # For POST requests, log body size (don't log full body as it's huge HTML)
    if request.method == "POST":
        body = await request.body()
        logger.info(f"📦 Request body size: {len(body)} bytes")
        
        # Recreate request with body for downstream processing
        async def receive():
            return {"type": "http.request", "body": body}
        request._receive = receive
    
    response = await call_next(request)
    
    # Log response
    process_time = time.time() - start_time
    logger.info(f"📤 Response: {response.status_code} | Time: {process_time:.3f}s")
    
    return response


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


@app.post("/draft", response_model=DraftResponse)
async def create_draft(request: DraftRequest) -> DraftResponse:
    logger.info(f"🎯 Processing draft request for: {request.profile.linkedinUrl}")
    logger.info(f"📊 Request details: ask='{request.ask}', has_html={bool(request.profile.htmlContent)}")
    
    # Check if we have HTML content for LLM parsing
    if request.profile.htmlContent and request.profile.linkedinUrl:
        logger.info("🔄 Using LLM parsing for profile extraction")
        logger.debug(f"📄 HTML content length: {len(request.profile.htmlContent)} chars")
        
        # Use LLM to parse the profile from HTML
        profile = await parse_linkedin_profile_with_llm(
            request.profile.htmlContent, 
            str(request.profile.linkedinUrl)
        )
        
        if not profile:
            logger.error("❌ LLM parsing returned None - no profile data extracted")
            raise HTTPException(
                status_code=500, 
                detail="Failed to parse LinkedIn profile with LLM"
            )
        logger.info("✅ LLM parsing successful, profile data extracted")
    else:
        logger.info("🔄 Using manual extraction data (fallback)")
        # Fallback: use manually extracted data (shouldn't happen with new flow)
        profile = Profile(
            name=clean_text(request.profile.name),
            role=clean_text(request.profile.role),
            currentCompany=clean_text(request.profile.currentCompany),
            companies=[clean_text(c) for c in request.profile.companies if clean_text(c)],
            highestDegree=clean_text(request.profile.highestDegree),
            field=request.profile.field,
            schools=[clean_text(s) for s in request.profile.schools if clean_text(s)],
            location=clean_text(request.profile.location),
            linkedinUrl=request.profile.linkedinUrl,
        )
    
    # Apply normalization to LLM-extracted data
    profile.name = clean_text(profile.name)
    profile.role = clean_text(profile.role)
    profile.currentCompany = clean_text(profile.currentCompany)
    profile.companies = [clean_text(c) for c in profile.companies if clean_text(c)]
    profile.highestDegree = clean_text(profile.highestDegree)
    profile.schools = [clean_text(s) for s in profile.schools if clean_text(s)]
    profile.location = clean_text(profile.location)
    
    # Field is now classified directly during parsing, but fallback if needed
    if not profile.field:
        profile.field = await classify_field_with_llm(profile)

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
            
            # Check if we should update an existing Notion entry
            if config.NOTION_API_KEY and config.NOTION_DATABASE_ID and profile.linkedinUrl:
                try:
                    notion = NotionWrapper(config.NOTION_API_KEY, config.NOTION_DATABASE_ID)
                    existing_page_id = notion.find_profile_by_linkedin_url(str(profile.linkedinUrl))
                    
                    if existing_page_id:
                        # Update existing page with the generated message
                        message_content = draft.body
                        subject = draft.subject if hasattr(draft, 'subject') and draft.subject else None
                        
                        update_result = notion.update_profile_page_with_message(
                            existing_page_id,
                            message_type,
                            message_content,
                            subject
                        )
                        
                        response.notion = NotionResult(
                            pageId=update_result["pageId"],
                            url=update_result.get("url"),
                            savedFields={"updated_with_message": True}
                        )
                except Exception as e:
                    # Don't fail the whole request if Notion update fails
                    print(f"Failed to update Notion entry: {e}")

    return response 