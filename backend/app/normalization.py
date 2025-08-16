from __future__ import annotations
from typing import List, Optional


def clean_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    value = value.strip()
    return value or None


def derive_field(role: Optional[str]) -> Optional[str]:
    if not role:
        return None
    r = role.lower()
    if any(k in r for k in ["software", "engineer", "swe", "developer"]):
        if any(k in r for k in ["ml", "ai", "machine learning", "artificial intelligence"]):
            return "AI SWE"
        return "SWE"
    if any(k in r for k in ["product manager", "pm", "program manager", "product "]):
        return "PM"
    if any(k in r for k in ["machine learning", "ml", "data science", "mle"]):
        return "MLE"
    if any(k in r for k in ["research", "phd", "scientist"]):
        return "Research"
    return "Research"


def pick_highest_degree(degrees: List[str]) -> Optional[str]:
    if not degrees:
        return None
    order = [
        "phd",
        "doctor",
        "master",
        "msc",
        "ma",
        "bachelor",
        "bsc",
        "ba",
        "associate",
        "diploma",
    ]
    def rank(d: str) -> int:
        d_low = d.lower()
        for idx, key in enumerate(order):
            if key in d_low:
                return idx
        return len(order)
    return sorted(degrees, key=rank)[0] 