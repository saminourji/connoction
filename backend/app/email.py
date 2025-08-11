from __future__ import annotations
import asyncio
import os
from typing import Optional, Tuple

import httpx
from openai import OpenAI

from .schemas import Draft, Profile


async def maybe_generate_draft(profile: Profile, ask: str) -> tuple[Optional[Draft], Optional[str], Optional[str]]:
    provider_env = os.getenv("EMAIL_PROVIDER", "").lower()
    api_key = os.getenv("OPENAI_API_KEY")

    if provider_env != "openai" or not api_key:
        return None, None, "OpenAI not configured"

    try:
        draft = await _generate_with_openai(profile, ask, api_key)
        return draft, "openai", None
    except Exception as exc:  # noqa: BLE001
        return None, None, f"OpenAI error: {exc.__class__.__name__}"


async def _generate_with_openai(profile: Profile, ask: str, api_key: str) -> Draft:
    client = OpenAI(api_key=api_key)

    system = (
        "You generate concise, friendly outreach emails. Use provided profile fields only. "
        "100-140 words, no fluff, specific to their role/company/education and the user's ask."
    )
    user = (
        f"Profile: name={profile.name}; role={profile.role}; company={profile.currentCompany}; "
        f"degree={profile.highestDegree}; field={profile.field}; schools={', '.join(profile.schools)}; "
        f"location={profile.location}; linkedin={profile.linkedinUrl}\n\nAsk: {ask}"
    )

    # Simple retry loop
    for delay in [0.5, 1.0, 2.0]:
        try:
            completion = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=0.4,
                max_tokens=350,
            )
            text = completion.choices[0].message.content or ""
            subject, body = _split_subject_body(text)
            return Draft(subject=subject, body=body)
        except Exception:  # noqa: BLE001
            await asyncio.sleep(delay)

    # If still failing, raise
    raise RuntimeError("OpenAI draft generation failed after retries")


def _split_subject_body(text: str) -> tuple[str, str]:
    # Heuristic: first line starting with 'Subject:' else first sentence as subject
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    subject = "Quick intro"
    body = text.strip()

    for i, line in enumerate(lines):
        if line.lower().startswith("subject:"):
            subject = line.split(":", 1)[1].strip() or subject
            body = "\n".join(lines[i + 1:]).strip() or body
            break
    else:
        # Fall back to first line as subject if it's short
        if lines and len(lines[0]) <= 80:
            subject = lines[0]
            body = "\n".join(lines[1:]).strip() or body

    return subject, body 