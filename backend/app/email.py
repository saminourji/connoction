from __future__ import annotations
import asyncio
import os
from typing import Optional, Tuple, List

import httpx
from openai import OpenAI

from .schemas import Draft, Profile, ExperienceDetail
from . import config
import json


async def parse_linkedin_profile_with_llm(html_content: str, linkedin_url: str) -> Optional[Profile]:
    """Use LLM to parse LinkedIn profile HTML and extract structured data."""
    import logging
    logger = logging.getLogger(__name__)
    
    logger.info(f"🔍 Starting LLM profile parsing for URL: {linkedin_url}")
    logger.debug(f"📄 Original HTML content length: {len(html_content)} characters")
    
    api_key = config.OPENAI_API_KEY
    if not api_key:
        logger.error("❌ OPENAI_API_KEY not found in environment")
        return None
    
    client = OpenAI(api_key=api_key)
    
    # Strip HTML tags and clean content
    import re
    from html import unescape
    
    # Remove script and style tags completely
    text_content = re.sub(r'<script[^>]*>.*?</script>', '', html_content, flags=re.DOTALL | re.IGNORECASE)
    text_content = re.sub(r'<style[^>]*>.*?</style>', '', text_content, flags=re.DOTALL | re.IGNORECASE)
    
    # Strip all HTML tags
    text_content = re.sub(r'<[^>]+>', ' ', text_content)
    
    # Clean up whitespace and decode HTML entities
    text_content = unescape(text_content)
    text_content = re.sub(r'\s+', ' ', text_content).strip()
    
    logger.debug(f"🧹 Cleaned text content length: {len(text_content)} characters")
    logger.debug(f"📝 First 500 chars of cleaned content: {text_content[:500]}...")
    
    # Truncate if too long (keep within reasonable token limits)
    if len(text_content) > 25000:
        text_content = text_content[:25000] + "..."
        logger.info(f"✂️ Truncated content to 25000 characters")
    
    system_prompt = """Extract LinkedIn profile data as JSON:

{
  "name": "Full name",
  "role": "Current job title", 
  "currentCompany": "Current company",
  "companies": ["All work companies (exclude schools)"],
  "highestDegree": "PhD/Master's/Bachelor's",
  "schools": ["Educational institutions"],
  "location": "Location",
  "field": "Field classification",
  "bio": "About section text",
  "headline": "Tagline under name",
  "experience_details": [{"company": "X", "title": "Y", "description": "Z"}]
}

Field options:
- "industry - SWE" (software engineering)
- "industry - PM" (product management) 
- "industry - AI/ML" (AI/ML engineering)
- "industry - Other" (other industry)
- "research - [field]" (researchers, PhD students)

Rules: Extract all companies from work history. Use current role for field classification. Return JSON only."""

    user_prompt = f"""Parse this LinkedIn profile content and extract the structured information:

LinkedIn URL: {linkedin_url}

Profile Content:
{text_content}

Return the extracted profile data as JSON."""

    try:
        logger.info("🤖 Sending request to GPT-4o-mini...")
        logger.debug(f"📤 System prompt: {system_prompt[:200]}...")
        logger.debug(f"📤 User prompt length: {len(user_prompt)} characters")
        
        response = await asyncio.to_thread(
            client.chat.completions.create,
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.1,
            max_tokens=800
        )
        
        content = response.choices[0].message.content or ""
        logger.info(f"📥 GPT-4o-mini raw response: {content}")
        
        try:
            result = json.loads(content)
            logger.info(f"✅ Successfully parsed JSON response: {result}")
        except json.JSONDecodeError as json_err:
            logger.error(f"❌ Failed to parse JSON response: {json_err}")
            logger.error(f"Raw content: {content}")
            return None
        
        # Create Profile object with extracted data
        experience_details = []
        for exp in result.get("experience_details", []):
            if isinstance(exp, dict) and exp.get("company") and exp.get("title"):
                experience_details.append(ExperienceDetail(
                    company=exp["company"],
                    title=exp["title"],
                    description=exp.get("description")
                ))
        
        profile = Profile(
            name=result.get("name"),
            role=result.get("role"),
            currentCompany=result.get("currentCompany"),
            companies=result.get("companies", []),
            highestDegree=result.get("highestDegree"),
            field=result.get("field"),  # Now extracted directly by LLM
            schools=result.get("schools", []),
            location=result.get("location"),
            linkedinUrl=linkedin_url,
            bio=result.get("bio"),
            headline=result.get("headline"),
            experience_details=experience_details
        )
        
        logger.info(f"🎯 Created Profile object:")
        logger.info(f"   Name: {profile.name}")
        logger.info(f"   Role: {profile.role}")
        logger.info(f"   Current Company: {profile.currentCompany}")
        logger.info(f"   Companies: {profile.companies}")
        logger.info(f"   Location: {profile.location}")
        logger.info(f"   Schools: {profile.schools}")
        logger.info(f"   Highest Degree: {profile.highestDegree}")
        logger.info(f"   Field: {profile.field}")
        logger.info(f"   Bio: {profile.bio[:100] + '...' if profile.bio and len(profile.bio) > 100 else profile.bio}")
        logger.info(f"   Headline: {profile.headline}")
        logger.info(f"   Experience Details: {len(profile.experience_details)} entries")
        for i, exp in enumerate(profile.experience_details[:3]):  # Log first 3 experiences
            logger.info(f"     [{i+1}] {exp.title} at {exp.company}")
            if exp.description:
                logger.info(f"         Description: {exp.description[:100] + '...' if len(exp.description) > 100 else exp.description}")
        
        return profile
        
    except Exception as e:
        logger.error(f"❌ LLM profile parsing error: {e}")
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
        return None


async def classify_field_with_llm(profile: Profile) -> Optional[str]:
    """Use LLM to classify the person's field based on their profile information."""
    api_key = config.OPENAI_API_KEY
    if not api_key:
        return None
    
    client = OpenAI(api_key=api_key)
    
    # Build profile context for classification
    profile_info = []
    if profile.role:
        profile_info.append(f"Current Role: {profile.role}")
    if profile.companies:
        profile_info.append(f"Companies: {', '.join(profile.companies)}")
    if profile.schools:
        profile_info.append(f"Education: {', '.join(profile.schools)}")
    if profile.highestDegree:
        profile_info.append(f"Degree: {profile.highestDegree}")
    
    if not profile_info:
        return None
    
    profile_context = "\n".join(profile_info)
    
    system_prompt = """You are a career field classifier. Based on the profile information provided, classify the person into the MOST APPROPRIATE category using the new field format:

INDUSTRY ROLES (use format "industry - {category}"):
- "industry - SWE" for Software Engineers/Developers (general software engineering)
- "industry - PM" for Product Managers
- "industry - AI/ML" for AI/ML Engineers, Data Scientists, ML Engineers
- "industry - Other" for other industry roles not covered above

RESEARCH ROLES (use format "research - {specific field}"):
- "research - Computer Science" for CS researchers, PhD students in CS
- "research - Machine Learning" for ML/AI researchers
- "research - Physics" for physics researchers
- "research - Biology" for biology/biotech researchers
- "research - [specific field]" for other research areas (be specific about the field)

IMPORTANT: 
- Choose the MOST SPECIFIC category based on their current role and background
- If someone works in industry but has research background, classify by their current role
- If someone could fit multiple categories, choose the most specific or current one

Respond with valid JSON in this exact format:
{"field": "category"}"""

    user_prompt = f"""Classify this person's field based on their profile:

{profile_context}

Respond with JSON only."""

    try:
        response = await asyncio.to_thread(
            client.chat.completions.create,
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.1,
            max_tokens=50
        )
        
        content = response.choices[0].message.content or ""
        result = json.loads(content)
        field = result.get("field")
        
        # Validate that the field follows the new format
        if field and (field.startswith("industry - ") or field.startswith("research - ")):
            return field
        
        return None
        
    except Exception as e:
        print(f"Field classification error: {e}")
        return None


async def maybe_generate_draft(profile: Profile, ask: str, message_type: str = "email") -> tuple[Optional[Draft], Optional[str], Optional[str]]:
    provider_env = config.EMAIL_PROVIDER
    api_key = config.OPENAI_API_KEY
    
    print(f"DEBUG: EMAIL_PROVIDER = '{provider_env}'")
    print(f"DEBUG: OPENAI_API_KEY exists = {bool(api_key)}")
    print(f"DEBUG: OPENAI_API_KEY length = {len(api_key) if api_key else 0}")

    if provider_env != "openai" or not api_key:
        if provider_env != "openai":
            return None, None, f"EMAIL_PROVIDER must be set to 'openai', currently: '{provider_env}'"
        if not api_key:
            return None, None, "OPENAI_API_KEY is missing or empty"
        return None, None, "OpenAI not configured"

    try:
        draft = await _generate_with_openai(profile, ask, api_key, message_type)
        return draft, "openai", None
    except Exception as exc:  # noqa: BLE001
        return None, None, f"OpenAI error: {exc.__class__.__name__}"


async def _generate_with_openai(profile: Profile, ask: str, api_key: str, message_type: str) -> Draft:
    client = OpenAI(api_key=api_key)
    
    # Build enriched profile context
    profile_context = f"Name: {profile.name or 'Unknown'}"
    if profile.role:
        profile_context += f"\nRole: {profile.role}"
    if profile.headline:
        profile_context += f"\nHeadline: {profile.headline}"
    if profile.currentCompany:
        profile_context += f"\nCompany: {profile.currentCompany}"
    if profile.schools:
        profile_context += f"\nEducation: {', '.join(profile.schools)}"
    if profile.highestDegree:
        profile_context += f"\nDegree: {profile.highestDegree}"
    if profile.field:
        profile_context += f"\nField: {profile.field}"
    if profile.location:
        profile_context += f"\nLocation: {profile.location}"
    
    # Add bio if available
    if profile.bio:
        bio_excerpt = profile.bio[:200] + "..." if len(profile.bio) > 200 else profile.bio
        profile_context += f"\nBio: {bio_excerpt}"
    
    # Add detailed experience for more targeted messaging
    if profile.experience_details:
        profile_context += f"\n\nExperience:"
        for i, exp in enumerate(profile.experience_details[:3]):  # Include top 3 experiences
            profile_context += f"\n- {exp.title} at {exp.company}"
            if exp.description:
                desc_excerpt = exp.description[:150] + "..." if len(exp.description) > 150 else exp.description
                profile_context += f": {desc_excerpt}"
    
    if message_type == "linkedin":
        system_prompt = """You are writing a LinkedIn outreach message. Keep it UNDER 300 characters total.

Be direct, warm, and specific. Reference specific aspects of their background (experience, bio, current role) to show genuine interest.

Use these examples as templates for tone and style:

Example 1: "Hey Hans, Really cool background in NLP/Computational Social Science! I'm currently exploring MecInterp and AI Safety, and your work is super interesting. Would love to hear about your thoughts on industry research vs academia + learn more about why you're pursuing PhD. I'm exploring post-grad plans after getting a taste of big tech SWE, so your insights would be super"

Example 2: "Hey Aaquib, Really cool background in ML Research and SWE — would love to hear about your experience in industry research, how that compares to academia + your take on PhDs. I'm exploring different paths for post-grad after getting a taste of big tech SWE, so your insights would be super helpful."

IMPORTANT: Use their detailed experience and bio to craft specific, personalized messages. Mention particular companies they've worked at, specific roles they've held, or interesting aspects from their bio when relevant to the request."""

        user_prompt = f"""Write a LinkedIn message for this person:

{profile_context}

Request: {ask}

Remember: Keep it UNDER 300 characters total. Be direct, warm, and specific about why you're reaching out to them specifically."""

    else:  # email
        system_prompt = """You are writing a professional outreach email. Be direct, warm, and respectful of their time.

Use their detailed profile information (bio, experience, specific roles) to craft a personalized message that shows genuine interest in their career path.

Use this example as a template for tone and structure:

Subject: "Brown student curious about PMing + your work industry research!"
Body: "Hi Dana,

I know you're incredibly busy, so I'll keep this email under 60 seconds.

I'm a rising senior interested in using tech/AI for good, currently working on research (NLP + AI Safety) and Agentic AI @ Amazon. While I've gotten a taste of swe in big tech, I've been thinking a lot about other roles that could combine my interests in design and research, and product management in industry research sounds super interesting!

I'd love to hear about your work as a PM at DeepMind, why you decided to work in industry research (vs. e.g., working on another product at Google), and what it takes to succeed as a PM in big tech.
I'm exploring whether product management would be a right fit for me post-grad, so your perspective would be invaluable!

I completely understand if you're too busy to respond; even a short reply (or a quick 15–20 minute chat anytime, e.g., during a break or walk home) would make my day.

All the best,"

IMPORTANT: Reference specific aspects of their experience, companies they've worked at, or interesting points from their bio to show you've done your research and are genuinely interested in their specific journey."""

        user_prompt = f"""Write a professional outreach email for this person:

{profile_context}

Request: {ask}

Generate both a subject line and email body. Make it personal and specific to their background."""

    response = await asyncio.to_thread(
        client.chat.completions.create,
        model="gpt-4o",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        temperature=0.7,
        max_tokens=500 if message_type == "linkedin" else 800
    )
    
    content = response.choices[0].message.content or ""
    
    if message_type == "email":
        # Try to parse subject and body
        lines = content.strip().split('\n')
        subject_line = None
        body_lines = []
        
        for i, line in enumerate(lines):
            if line.lower().startswith('subject:'):
                subject_line = line[8:].strip().strip('"')
                body_lines = lines[i+1:]
                break
        
        if not subject_line:
            # If no subject found, use first line as subject
            subject_line = lines[0] if lines else "Quick chat request"
            body_lines = lines[1:]
        
        body = '\n'.join(body_lines).strip()
        
        return Draft(subject=subject_line, body=body)
    else:
        # LinkedIn message - just return the body
        return Draft(body=content.strip()) 