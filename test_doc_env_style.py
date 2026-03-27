import os
from pathlib import Path

from agents import (
    Agent,
    Runner,
    set_default_openai_api,
    set_default_openai_client,
    set_tracing_disabled,
)
from dotenv import load_dotenv
from openai import AsyncOpenAI


PROJECT_ROOT = Path(__file__).resolve().parents[0]


def configure_client() -> None:
    load_dotenv(dotenv_path=PROJECT_ROOT / ".env")

    api_key = os.getenv("QN_API_KEY")
    if not api_key:
        raise RuntimeError("Missing env var QN_API_KEY")

    base_url = os.getenv("QN_BASE_URL", "https://api.qnaigc.com/v1")

    custom_client = AsyncOpenAI(base_url=base_url, api_key=api_key)
    set_default_openai_client(custom_client)

    # Required for many OpenAI-compatible gateways.
    set_default_openai_api("chat_completions")
    set_tracing_disabled(True)


def main() -> None:
    configure_client()

    libai_agent = Agent(
        name="libai",
        model=os.getenv("OPENSCAD_MODEL", "deepseek-r1"),
        instructions="模拟李白风格，根据用户输入创作诗歌。",
    )

    result = Runner.run_sync(libai_agent, "请创作一首描写科举考生赴京场景的诗。")
    print(result.final_output)


if __name__ == "__main__":
    main()
