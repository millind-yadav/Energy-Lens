# Energy Lens

European energy price dashboard with a FastAPI backend and a React frontend.

## Local development

Backend:
- cd backend
- python -m venv .venv
- source .venv/bin/activate
- pip install -r requirements.txt
- uvicorn app.main:app --reload --port 8000

Frontend:
- cd frontend
- npm install
- npm run dev

## Docker development

- cp .env.example .env
- docker compose up --build


## Environment variables

- ENTSOE_API_KEY: ENTSO-E API key
- OPENAI_API_KEY: OpenAI key (optional)
- ANTHROPIC_API_KEY: Anthropic key (optional)
- DATABASE_URL: SQLite database URL
- VITE_API_URL: Backend base URL for the frontend
