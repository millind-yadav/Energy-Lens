import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    def __init__(self) -> None:
        self.entsoe_api_key = os.getenv("ENTSOE_API_KEY")
        self.database_url = os.getenv("DATABASE_URL", "sqlite:///./energy_lens.db")
        self.openai_api_key = os.getenv("OPENAI_API_KEY")
        self.anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")


settings = Settings()
