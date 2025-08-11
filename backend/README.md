# Connoction Backend

## Setup
1. Create `.env` in `backend/` based on `.env.example`.
2. Ensure your Notion integration has access to the database and IDs are correct.

## Install and run
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

## API
- POST `/draft`: Save to Notion, optionally generate email with OpenAI.
- GET `/healthz`: Health check. 