import argparse
import os
import re
from pathlib import Path

from agents import (
	Agent,
	Runner,
	set_default_openai_api,
	set_default_openai_client,
	set_tracing_disabled,
)
from openai import AsyncOpenAI
from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[4]


def configure_client() -> None:
	"""Configure the custom OpenAI-compatible endpoint for the Agents SDK."""
	api_key = os.getenv("QN_API_KEY")
	if not api_key:
		raise RuntimeError("Missing env var QN_API_KEY")

	base_url = os.getenv("QN_BASE_URL", "https://api.qnaigc.com/v1")

	custom_client = AsyncOpenAI(base_url=base_url, api_key=api_key)
	set_default_openai_client(custom_client)

	# These settings are required for many OpenAI-compatible gateways.
	set_default_openai_api("chat_completions")
	set_tracing_disabled(True)


def build_agent() -> Agent:
	model = os.getenv("OPENSCAD_MODEL", "deepseek-r1")
	return Agent(
		name="openscad-generator",
		model=model,
		instructions=(
			"You generate valid OpenSCAD code from user requirements. "
			"Return only OpenSCAD source code. "
			"Use parametric variables where useful and keep code runnable."
		),
	)


def extract_scad(text: str) -> str:
	"""Extract OpenSCAD code from fenced markdown or return raw text."""
	code_block = re.search(r"```(?:openscad|scad)?\s*(.*?)```", text, re.IGNORECASE | re.DOTALL)
	if code_block:
		return code_block.group(1).strip()
	return text.strip()


def main() -> None:
	load_dotenv(dotenv_path=PROJECT_ROOT / ".env")

	parser = argparse.ArgumentParser(description="Generate OpenSCAD code from a natural language prompt")
	parser.add_argument("prompt", help="Natural language prompt for OpenSCAD generation")
	args = parser.parse_args()

	configure_client()
	openscad_agent = build_agent()

	result = Runner.run_sync(openscad_agent, args.prompt)
	output = extract_scad(str(result.final_output))
	print(output)


if __name__ == "__main__":
	main()
