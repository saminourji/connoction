from __future__ import annotations
import asyncio
import os
from typing import Optional, Tuple

import httpx
from openai import OpenAI

from .schemas import Draft, Profile


async def maybe_generate_draft(profile: Profile, ask: str, message_type: str = "email") -> tuple[Optional[Draft], Optional[str], Optional[str]]:
    provider_env = os.getenv("EMAIL_PROVIDER", "").lower()
    api_key = os.getenv("OPENAI_API_KEY")

    if provider_env != "openai" or not api_key:
        return None, None, "OpenAI not configured"

    try:
        draft = await _generate_with_openai(profile, ask, api_key, message_type)
        return draft, "openai", None
    except Exception as exc:  # noqa: BLE001
        return None, None, f"OpenAI error: {exc.__class__.__name__}"


async def _generate_with_openai(profile: Profile, ask: str, api_key: str, message_type: str) -> Draft:
    client = OpenAI(api_key=api_key)
    
    # Build profile context
    profile_context = f"Name: {profile.name or 'Unknown'}"
    if profile.role:
        profile_context += f"\nRole: {profile.role}"
    if profile.currentCompany:
        profile_context += f"\nCompany: {profile.currentCompany}"
    if profile.schools:
        profile_context += f"\nEducation: {', '.join(profile.schools)}"
    if profile.highestDegree:
        profile_context += f"\nDegree: {profile.highestDegree}"
    if profile.location:
        profile_context += f"\nLocation: {profile.location}"
    
    if message_type == "linkedin":
        system_prompt = """You are writing a LinkedIn outreach message. Keep it UNDER 300 characters total.

Be direct, warm, and specific. Use these examples as templates for tone and style:

Example 1: "Hey Hans, Really cool background in NLP/Computational Social Science! I'm currently exploring MecInterp and AI Safety, and your work is super interesting. Would love to hear about your thoughts on industry research vs academia + learn more about why you're pursuing PhD. I'm exploring post-grad plans after getting a taste of big tech SWE, so your insights would be super"

Example 2: "Hey Aaquib, Really cool background in ML Research and SWE — would love to hear about your experience in industry research, how that compares to academia + your take on PhDs. I'm exploring different paths for post-grad after getting a taste of big tech SWE, so your insights would be super helpful."

Key elements:
- Start with "Hey [Name],"
- Compliment their background specifically
- Connect to your situation/interests
- Make a specific ask
- Explain why their insights would be valuable
- Keep it under 300 characters total
- Be conversational and warm"""

        user_prompt = f"""Write a LinkedIn message for this person:

{profile_context}

Request: {ask}

Remember: Keep it UNDER 300 characters total. Be direct, warm, and specific about why you're reaching out to them specifically."""

    else:  # email
        system_prompt = """You are writing a professional outreach email. Be direct, warm, and respectful of their time.

Use this example as a template for tone and structure:

Subject: "Brown student curious about PMing + your work industry research!"
Body: "Hi Dana,

I know you're incredibly busy, so I'll keep this email under 60 seconds.

I'm a rising senior interested in using tech/AI for good, currently working on research (NLP + AI Safety) and Agentic AI @ Amazon. While I've gotten a taste of swe in big tech, I've been thinking a lot about other roles that could combine my interests in design and research, and product management in industry research sounds super interesting!

I'd love to hear about your work as a PM at DeepMind, why you decided to work in industry research (vs. e.g., working on another product at Google), and what it takes to succeed as a PM in big tech.
I'm exploring whether product management would be a right fit for me post-grad, so your perspective would be invaluable!

I completely understand if you're too busy to respond; even a short reply (or a quick 15–20 minute chat anytime, e.g., during a break or walk home) would make my day.

All the best,"

Key elements:
- Acknowledge they're busy
- Brief personal context
- Specific ask related to their background
- Explain why their perspective is valuable
- Respectful closing that gives them an out
- Professional but warm tone"""

        user_prompt = f"""Write a professional outreach email for this person:

{profile_context}

Request: {ask}

Generate both a subject line and email body. Make it personal and specific to their background."""

    response = await asyncio.to_thread(
        client.chat.completions.create,
        model="gpt-4",
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