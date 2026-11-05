"""Word a report summary with a local model. The model only words facts it is given, never new figures."""
import asyncio
import os
import re

import httpx

# LM Studio and Ollama both offer this interface on their own computer, and nothing leaves the machine
MODEL_SERVERS = (
    os.environ.get("LOCAL_MODEL_URL", "http://127.0.0.1:1234/v1"),
    "http://127.0.0.1:11434/v1",
)
MODEL_NAME = os.environ.get("LOCAL_MODEL_NAME", "meta/llama-3.2-3b")
LOOKUP_TIMEOUT_SECONDS = 3
# The first request can wait for the model to load into memory
WRITE_TIMEOUT_SECONDS = 180
ATTEMPTS = 2
KINDS = ("Simulated", "Observed", "Forecast")
INSTRUCTIONS = (
    "Rewrite the FACTS as one short paragraph of plain text for a government officer. Include every fact. "
    "Copy every number exactly as written. Add nothing else: no other number, date, place, cause, prediction "
    "or advice. Return only the paragraph, with no heading, label or markdown."
)
EXTRA = {
    "Simulated": (
        " Begin with: This what-if scenario is not an official warning. It has not happened, so write 'would flood' "
        "and never 'has flooded'. Census figures are the whole population of those villages in 2001, so never call "
        "them people affected."
    ),
    "Observed": " Say that the river level is a past reading, not live, and that official counts cover the whole area.",
    "Forecast": " Describe only the rain and the river flow.",
}
OFF_MESSAGE = (
    "AI summary is off because no local model is running. The rest of this report is complete. "
    "To turn it on, start LM Studio's server or Ollama with a chat model."
)
REJECTED_MESSAGE = (
    "AI summary hidden because the local model's text failed the check against this report's data. "
    "The rest of this report is complete."
)

NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")
THINKING = re.compile(r"<think>.*?(</think>|$)", re.S)
OWN_LABEL = re.compile(r"^\W*(simulated|observed|forecast)\W*:\W*", re.I)
# A scenario told as if it happened, or census totals told as people hit, would mislead a reader
MISLEADING = re.compile(
    r"\b(has|have|had|is|are|was|were) (been )?(flooded|caused|reached)\b|\b2001\b.*\baffected\b|\baffected\b.*\b2001\b",
    re.I,
)

summaries: dict[tuple[str, ...], dict] = {}
one_at_a_time = asyncio.Lock()


def numbers_in(text: str) -> set[float]:
    return {float(found.replace(",", "")) for found in NUMBER.findall(text)}


def with_rounding(numbers: set[float]) -> set[float]:
    return numbers | {float(round(number)) for number in numbers}


def unknown_numbers(text: str, facts: list[str]) -> set[float]:
    """Numbers in the text that are not in the facts. A figure may be rounded to a whole number."""
    return numbers_in(text) - with_rounding(numbers_in("\n".join(facts)))


def keeps_every_fact(text: str, facts: list[str]) -> bool:
    """The main figure of each fact must survive, so a fact cannot be quietly dropped."""
    found = with_rounding(numbers_in(text))
    for fact in facts:
        figures = NUMBER.findall(fact)
        if figures and float(figures[0].replace(",", "")) not in found:
            return False
    return True


def well_formed(text: str, facts: list[str]) -> bool:
    return bool(text) and not MISLEADING.search(text) and not unknown_numbers(text, facts) and keeps_every_fact(text, facts)


def plain_text(facts: list[str]) -> str:
    sentences = [re.sub(r"^(Simulated|Forecast): ", "", fact) for fact in facts]
    return " ".join(sentence[0].upper() + sentence[1:] for sentence in sentences)


async def find_model(client: httpx.AsyncClient) -> tuple[str, str] | None:
    for server in MODEL_SERVERS:
        try:
            response = await client.get(f"{server}/models", timeout=LOOKUP_TIMEOUT_SECONDS)
            response.raise_for_status()
            names = [model["id"] for model in response.json()["data"] if "embed" not in model["id"].lower()]
        except (httpx.HTTPError, KeyError, TypeError, ValueError):
            continue
        if MODEL_NAME in names:
            return server, MODEL_NAME
        if names:
            return server, names[0]
    return None


async def ask_model(client: httpx.AsyncClient, server: str, model: str, kind: str, facts: list[str], temperature: float) -> str:
    # Qwen3 thinks at length before answering unless told not to, which only adds delay here
    no_think = "\n/no_think" if "qwen3" in model.lower() else ""
    response = await client.post(
        f"{server}/chat/completions",
        timeout=WRITE_TIMEOUT_SECONDS,
        json={
            "model": model,
            "temperature": temperature,
            "stream": False,
            "messages": [
                {"role": "system", "content": INSTRUCTIONS + EXTRA[kind]},
                {"role": "user", "content": "FACTS:\n" + "\n".join(f"- {fact}" for fact in facts) + no_think},
            ],
        },
    )
    response.raise_for_status()
    text = THINKING.sub("", response.json()["choices"][0]["message"]["content"]).strip()
    return OWN_LABEL.sub("", text)


async def write_summary(facts: list[str]) -> dict:
    """Always answers, so the report never depends on the model being available."""
    key = tuple(facts)
    # Requests wait their turn, so a repeat of the same report reuses the first answer
    async with one_at_a_time:
        if key in summaries:
            return summaries[key]
        async with httpx.AsyncClient() as client:
            found = await find_model(client)
            if found is None:
                return {"status": "off", "message": OFF_MESSAGE}
            server, model = found
            paragraphs = []
            plain = 0
            for kind in KINDS:
                group = [fact for fact in facts if fact.startswith(kind)]
                if not group:
                    continue
                worded = None
                for attempt in range(ATTEMPTS):
                    try:
                        # A repeat at the same temperature would tend to repeat the same mistake
                        text = await ask_model(client, server, model, kind, group, 0.2 + attempt * 0.2)
                    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError):
                        return {"status": "off", "message": OFF_MESSAGE}
                    if well_formed(text, group):
                        worded = text
                        break
                # A paragraph that fails the check shows the plain figures, so no bad sentence reaches the screen
                if worded is None:
                    plain += 1
                paragraphs.append(f"{kind}: {worded or plain_text(group)}")
        if plain == len(paragraphs):
            return {"status": "rejected", "message": REJECTED_MESSAGE}
        summaries[key] = {"status": "ok", "text": "\n\n".join(paragraphs), "model": model, "plain": plain}
        return summaries[key]
