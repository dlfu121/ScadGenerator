import argparse
import os
import re
from pathlib import Path
import json

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


def build_agent(agent_name: str = "openscad-generator") -> Agent:
	"""Build an agent based on the specified agent name."""
	model = os.getenv("OPENSCAD_MODEL", "deepseek-r1") if agent_name == "openscad-generator" else "claude-4.5-sonnet"
	instructions = (
		"You generate valid OpenSCAD code from user requirements. "
		"Return a JSON object with two fields: 'code' for OpenSCAD source code and 'reasoning' for the thought process. "
		"Use parametric variables where useful and keep code runnable."
		if agent_name == "openscad-generator"
		else (
			"You are a general-purpose assistant capable of generating responses based on user prompts. "
			"Return a JSON object with two fields: 'code' for the generated content and 'reasoning' for the thought process."
		)
	)

	# Add a new environment variable for the Claude-4.5-Sonnet API key
	claude_api_key = os.getenv("CLAUDE_API_KEY")
	if not claude_api_key:
		raise RuntimeError("Missing env var CLAUDE_API_KEY")

	if agent_name == "claude-4.5-sonnet":
		custom_client = AsyncOpenAI(base_url="https://api.qnaigc.com/v1", api_key=claude_api_key)
		set_default_openai_client(custom_client)

	return Agent(
		name=agent_name,
		model=model,
		instructions=instructions,
	)


def extract_scad(text: str) -> str:
	"""Extract OpenSCAD code from fenced markdown or return raw text."""
	code_block = re.search(r"```(?:openscad|scad)?\s*(.*?)```", text, re.IGNORECASE | re.DOTALL)
	if code_block:
		return code_block.group(1).strip()
	return text.strip()


def main() -> None:
	load_dotenv(dotenv_path=PROJECT_ROOT / ".env")

	parser = argparse.ArgumentParser(description="Generate code from a natural language prompt")
	parser.add_argument("prompt", help="Natural language prompt for code generation")
	parser.add_argument(
		"--agent", default="openscad-generator", help="Specify the agent to use (default: openscad-generator)"
	)
	args = parser.parse_args()

	configure_client()
	agent = build_agent(args.agent)

	result = Runner.run_sync(agent, args.prompt)

	# Extract JSON content from result.final_output
	final_output_raw = result.final_output
	if isinstance(final_output_raw, str):
		match = re.search(r"```json\s*(\{.*?\})\s*```", final_output_raw, re.DOTALL)
		if match:
			final_output_raw = match.group(1)

	try:
		final_output = json.loads(final_output_raw) if isinstance(final_output_raw, str) else final_output_raw
	except Exception as e:
		raise RuntimeError(f"Failed to parse final_output as JSON: {e}")

	output = extract_scad(str(final_output.get("code", "")))
	reasoning = final_output.get("reasoning", "No reasoning provided.")

	print("Generated Code:\n", output)
	print("\nAI Reasoning:\n", reasoning)


if __name__ == "__main__":
	main()
