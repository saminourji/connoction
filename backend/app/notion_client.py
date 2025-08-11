from __future__ import annotations
from typing import Any, Dict, List, Optional
import datetime as dt

from notion_client import Client

from .schemas import Profile


class NotionWrapper:
    def __init__(self, api_key: str, database_id: str) -> None:
        self.client = Client(auth=api_key)
        self.database_id = database_id

    def create_profile_page(
        self,
        profile: Profile,
        ask: Optional[str],
        draft_text: Optional[str],
        draft_destination: Optional[str],
    ) -> Dict[str, Any]:
        today = dt.date.today().isoformat()

        props: Dict[str, Any] = {
            "Name": {"title": [{"text": {"content": profile.name or ""}}]},
            "Company": self._multi_select([profile.currentCompany] if profile.currentCompany else []),
            "Role": {"rich_text": [{"text": {"content": profile.role or ""}}]},
            "LinkedIn URL": {"url": str(profile.linkedinUrl) if profile.linkedinUrl else None},
            "Date Contacted": {"date": {"start": today}},
            "Last Interaction Date": {"date": {"start": today}},
        }

        # Only set Status when we actually saved a draft, to avoid invalid option errors
        if draft_text and draft_destination in ("LinkedIn Message", "Email Message"):
            props["Status"] = {"status": {"name": "Contacted"}}

        # Save draft to the appropriate field if requested
        if draft_text and draft_destination == "LinkedIn Message":
            props["LinkedIn Message"] = {"rich_text": [{"text": {"content": draft_text}}]}
        elif draft_text and draft_destination == "Email Message":
            props["Email Message"] = {"rich_text": [{"text": {"content": draft_text}}]}

        payload = {
            "parent": {"database_id": self.database_id},
            "properties": props,
        }
        return self.client.pages.create(**payload)

    @staticmethod
    def _multi_select(values: Optional[List[str]]) -> Dict[str, Any]:
        options = [{"name": v} for v in (values or []) if v]
        return {"multi_select": options} 