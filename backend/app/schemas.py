from __future__ import annotations
from typing import List, Optional, Literal
from pydantic import BaseModel, HttpUrl, Field


class Profile(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    currentCompany: Optional[str] = None
    companies: List[str] = Field(default_factory=list)
    highestDegree: Optional[str] = None
    field: Optional[str] = None
    schools: List[str] = Field(default_factory=list)
    location: Optional[str] = None
    linkedinUrl: Optional[HttpUrl] = None
    # Optional HTML content for LLM parsing
    htmlContent: Optional[str] = None


class Draft(BaseModel):
    subject: Optional[str] = None
    body: str


class DraftOptions(BaseModel):
    saveDraftToNotion: bool = False
    draftDestination: Optional[Literal["LinkedIn Message", "Email Message"]] = None
    messageType: Optional[Literal["linkedin", "email"]] = None
    linkedinMessage: Optional[str] = None
    emailMessage: Optional[str] = None


class DraftRequest(BaseModel):
    profile: Profile
    ask: str
    options: Optional[DraftOptions] = None


class NotionResult(BaseModel):
    pageId: str
    url: Optional[str] = None
    savedFields: dict = Field(default_factory=dict)


class DraftResponse(BaseModel):
    notion: Optional[NotionResult] = None
    draft: Optional[Draft] = None
    provider: Optional[str] = None
    message: Optional[str] = None 