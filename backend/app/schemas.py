from __future__ import annotations
from typing import List, Optional, Literal
from pydantic import BaseModel, HttpUrl, Field


class Profile(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    currentCompany: Optional[str] = None
    highestDegree: Optional[str] = None
    field: Optional[str] = None
    schools: List[str] = Field(default_factory=list)
    location: Optional[str] = None
    linkedinUrl: Optional[HttpUrl] = None


class Draft(BaseModel):
    subject: str
    body: str


class DraftOptions(BaseModel):
    saveDraftToNotion: bool = False
    draftDestination: Optional[Literal["LinkedIn Message", "Email Message"]] = None


class DraftRequest(BaseModel):
    profile: Profile
    ask: str
    options: Optional[DraftOptions] = None


class NotionResult(BaseModel):
    pageId: str
    url: Optional[str] = None
    savedFields: Profile


class DraftResponse(BaseModel):
    notion: NotionResult
    draft: Optional[Draft] = None
    provider: Optional[Literal["openai"]] = None
    message: Optional[str] = None 