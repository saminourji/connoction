from __future__ import annotations
import os
from typing import Optional, Dict
import hashlib
import datetime as dt

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

# Simple in-memory cache for extracted profiles
profile_cache: Dict[str, Profile] = {}

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


def get_cache_key(linkedin_url: str, html_content: str) -> str:
    """Generate a cache key based on LinkedIn URL and content hash."""
    content_hash = hashlib.md5(html_content.encode()).hexdigest()[:12]
    return f"{linkedin_url}_{content_hash}"


def get_cached_profile(cache_key: str) -> Optional[Profile]:
    """Get cached profile if available."""
    return profile_cache.get(cache_key)


def cache_profile(cache_key: str, profile: Profile) -> None:
    """Cache a profile with size limit."""
    # Simple LRU: keep only last 50 profiles
    if len(profile_cache) >= 50:
        oldest_key = next(iter(profile_cache))
        del profile_cache[oldest_key]
    profile_cache[cache_key] = profile


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


@app.post("/draft", response_model=DraftResponse)
async def create_draft(request: DraftRequest) -> DraftResponse:
    logger.info(f"🎯 Processing draft request for: {request.profile.linkedinUrl}")
    logger.info(f"📊 Request details: ask='{request.ask}', has_html={bool(request.profile.htmlContent)}")
    
    # Check if we have HTML content for LLM parsing
    if request.profile.htmlContent and request.profile.linkedinUrl:
        # Generate cache key and check if profile is already cached
        cache_key = get_cache_key(str(request.profile.linkedinUrl), request.profile.htmlContent)
        profile = get_cached_profile(cache_key)
        
        if profile:
            logger.info("🎯 Using cached profile - no re-extraction needed")
            logger.info(f"📋 Cache key: {cache_key}")
        else:
            logger.info("🔄 Profile not cached, performing LLM parsing")
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
            
            # Cache the extracted profile
            cache_profile(cache_key, profile)
            logger.info("✅ LLM parsing successful, profile cached for future use")
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

    # Handle Notion operations (both saving and message updates)
    if config.NOTION_API_KEY and config.NOTION_DATABASE_ID and profile.linkedinUrl:
        try:
            notion = NotionWrapper(config.NOTION_API_KEY, config.NOTION_DATABASE_ID)
            
            # Check if profile already exists in Notion
            existing_page_id = notion.find_profile_by_linkedin_url(str(profile.linkedinUrl))
            
            # Handle Notion saving (create new or update existing)
            if request.options and request.options.saveDraftToNotion:
                linkedin_message = request.options.linkedinMessage
                email_message = request.options.emailMessage
                
                if existing_page_id:
                    logger.info(f"📝 Updating existing Notion entry: {existing_page_id}")
                    # Update existing entry with any new messages
                    props_to_update = {"Last Interaction Date": {"date": {"start": dt.date.today().isoformat()}}}
                    
                    if linkedin_message:
                        props_to_update["LinkedIn Message"] = {"rich_text": [{"text": {"content": linkedin_message}}]}
                        props_to_update["LinkedIn Reached Out"] = {"checkbox": True}
                    if email_message:
                        props_to_update["Email Message"] = {"rich_text": [{"text": {"content": email_message}}]}
                        props_to_update["Email Reached Out"] = {"checkbox": True}
                    
                    if linkedin_message or email_message:
                        props_to_update["Status"] = {"status": {"name": "Contacted"}}
                    
                    notion.client.pages.update(page_id=existing_page_id, properties=props_to_update)
                    
                    response.notion = NotionResult(
                        pageId=existing_page_id,
                        url=f"https://notion.so/{existing_page_id.replace('-', '')}",
                        savedFields={"updated": True}
                    )
                else:
                    logger.info("📝 Creating new Notion entry")
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
                    existing_page_id = result["pageId"]  # Update for potential message generation below
            
            # Handle message generation and Notion updates
            if request.options and request.options.messageType:
                message_type = request.options.messageType
                draft, provider, error = await maybe_generate_draft(profile, request.ask, message_type)
                
                if error:
                    response.message = error
                elif draft:
                    response.draft = draft
                    response.provider = provider
                    
                    # Update Notion with generated message (whether entry was just created or already existed)
                    if existing_page_id:
                        logger.info(f"📝 Updating Notion entry with generated {message_type} message")
                        message_content = draft.body
                        subject = draft.subject if hasattr(draft, 'subject') and draft.subject else None
                        
                        update_result = notion.update_profile_page_with_message(
                            existing_page_id,
                            message_type,
                            message_content,
                            subject
                        )
                        
                        # If we haven't set response.notion yet (message-only operation), set it now
                        if not response.notion:
                            response.notion = NotionResult(
                                pageId=update_result["pageId"],
                                url=update_result.get("url"),
                                savedFields={"updated_with_message": True}
                            )
            
        except Exception as e:
            # Don't fail the whole request if Notion operations fail
            logger.error(f"❌ Notion operation failed: {e}")
            if request.options and request.options.saveDraftToNotion:
                raise HTTPException(status_code=502, detail=f"Notion error: {e}")
    
    # Handle message generation without Notion (if Notion not configured)
    elif request.options and request.options.messageType:
        message_type = request.options.messageType
        draft, provider, error = await maybe_generate_draft(profile, request.ask, message_type)
        
        if error:
            response.message = error
        elif draft:
            response.draft = draft
            response.provider = provider

    return response 