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
        linkedin_message: Optional[str] = None,
        email_message: Optional[str] = None,
    ) -> Dict[str, Any]:
        today = dt.date.today().isoformat()

        # Use only the confirmed properties from your schema
        props: Dict[str, Any] = {
            "Name": {"title": [{"text": {"content": profile.name or ""}}]},
            "Company": self._multi_select([profile.currentCompany] if profile.currentCompany else []),
            "Role": {"rich_text": [{"text": {"content": profile.role or ""}}]},
            "LinkedIn URL": {"url": str(profile.linkedinUrl) if profile.linkedinUrl else None},
            "Date Contacted": {"date": {"start": today}},
            "Last Interaction Date": {"date": {"start": today}},
        }

        # Handle messages
        if linkedin_message:
            props["LinkedIn Message"] = {"rich_text": [{"text": {"content": linkedin_message}}]}

        if email_message:
            props["Email Message"] = {"rich_text": [{"text": {"content": email_message}}]}

        # Set status based on whether any checkboxes were selected
        if linkedin_message or email_message:
            # Any checkbox selected = "Contacted"
            props["Status"] = {"status": {"name": "Contacted"}}
        else:
            # No checkboxes selected = "Need to contact"
            props["Status"] = {"status": {"name": "Need to contact"}}

        response = self.client.pages.create(
            parent={"database_id": self.database_id},
            properties=props,
        )

        return {
            "pageId": response["id"],
            "url": response.get("url"),
            "savedFields": {
                "name": profile.name,
                "role": profile.role,
                "currentCompany": profile.currentCompany,
                "highestDegree": profile.highestDegree,
                "schools": profile.schools,
                "location": profile.location,
                "linkedinUrl": str(profile.linkedinUrl) if profile.linkedinUrl else None,
            },
        }

    def _multi_select(self, items: List[str]) -> Dict[str, Any]:
        return {"multi_select": [{"name": item} for item in items if item]} 