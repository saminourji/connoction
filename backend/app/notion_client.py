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
            "Company": {"select": {"name": profile.currentCompany} if profile.currentCompany else None},  # Single select for current company
            "Previous Companies": self._multi_select([c for c in profile.companies if c != profile.currentCompany]),  # Multiselect for previous companies
            "Role": {"rich_text": [{"text": {"content": profile.role or ""}}]},
            "School(s)": self._multi_select(profile.schools),
            "Highest Degree": {"select": {"name": profile.highestDegree} if profile.highestDegree else None},
            "Field": {"select": {"name": profile.field} if profile.field else None},  # Fixed field extraction
            "LinkedIn URL": {"url": str(profile.linkedinUrl) if profile.linkedinUrl else None},
            "Date Contacted": {"date": {"start": today}},
            "Last Interaction Date": {"date": {"start": today}},
        }

        # Handle messages and outreach tracking
        if linkedin_message:
            props["LinkedIn Message"] = {"rich_text": [{"text": {"content": linkedin_message}}]}
            props["LinkedIn Reached Out"] = {"checkbox": True}  # Track LinkedIn outreach

        if email_message:
            props["Email Message"] = {"rich_text": [{"text": {"content": email_message}}]}
            props["Email Reached Out"] = {"checkbox": True}  # Track Email outreach

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
                "companies": profile.companies,
                "highestDegree": profile.highestDegree,
                "field": profile.field,
                "schools": profile.schools,
                "location": profile.location,
                "linkedinUrl": str(profile.linkedinUrl) if profile.linkedinUrl else None,
            },
        }

    def find_profile_by_linkedin_url(self, linkedin_url: str) -> Optional[str]:
        """Find an existing profile page by LinkedIn URL. Returns page_id if found."""
        try:
            response = self.client.databases.query(
                database_id=self.database_id,
                filter={
                    "property": "LinkedIn URL",
                    "url": {"equals": linkedin_url}
                }
            )
            
            if response["results"]:
                return response["results"][0]["id"]
            return None
        except Exception:
            return None
    
    def update_profile_page_with_message(
        self,
        page_id: str,
        message_type: str,
        message_content: str,
        subject: Optional[str] = None
    ) -> Dict[str, Any]:
        """Update an existing profile page with generated message."""
        today = dt.date.today().isoformat()
        
        props: Dict[str, Any] = {
            "Last Interaction Date": {"date": {"start": today}},
            "Status": {"status": {"name": "Contacted"}}
        }
        
        if message_type == "linkedin":
            props["LinkedIn Message"] = {"rich_text": [{"text": {"content": message_content}}]}
            props["LinkedIn Reached Out"] = {"checkbox": True}
        elif message_type == "email":
            props["Email Message"] = {"rich_text": [{"text": {"content": message_content}}]}
            props["Email Reached Out"] = {"checkbox": True}
            if subject:
                props["Email Subject"] = {"rich_text": [{"text": {"content": subject}}]}
        
        response = self.client.pages.update(
            page_id=page_id,
            properties=props
        )
        
        return {
            "pageId": response["id"],
            "url": response.get("url"),
            "updated": True
        }

    def _multi_select(self, items: List[str]) -> Dict[str, Any]:
        return {"multi_select": [{"name": item} for item in items if item]} 