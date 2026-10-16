"""Chat clients for the agent: a local Ollama server or the OpenAI API, over plain HTTP."""

from typing import Protocol

import requests

from app.config import Settings


class LLMError(Exception):
    """The model couldn't be reached or returned something unusable."""


Message = dict[str, str]  # {"role": "system" | "user" | "assistant", "content": ...}


class ChatModel(Protocol):
    provider: str
    model: str

    def chat(self, messages: list[Message], max_tokens: int | None = None) -> str: ...


class OllamaChat:
    provider = "ollama"

    def __init__(self, base_url: str, model: str, timeout: float):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout

    def chat(self, messages: list[Message], max_tokens: int | None = None) -> str:
        options = {"temperature": 0}
        if max_tokens:
            options["num_predict"] = max_tokens
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "think": False,  # thinking models otherwise reason at length before every query
            "options": options,
        }
        try:
            response = requests.post(f"{self.base_url}/api/chat", json=payload, timeout=self.timeout)
        except requests.RequestException as e:
            raise LLMError(f"Ollama is not reachable at {self.base_url} ({type(e).__name__})") from e
        if response.status_code != 200:
            raise LLMError(f"Ollama returned {response.status_code}: {response.text[:200]}")
        try:
            return response.json()["message"]["content"]
        except (ValueError, KeyError, TypeError) as e:
            raise LLMError("Ollama returned an unexpected response") from e

    def available(self) -> bool:
        try:
            tags = requests.get(f"{self.base_url}/api/tags", timeout=3).json()
        except (requests.RequestException, ValueError):
            return False
        return any(m.get("name") == self.model for m in tags.get("models", []))


class OpenAIChat:
    provider = "openai"
    URL = "https://api.openai.com/v1/chat/completions"

    def __init__(self, api_key: str, model: str, timeout: float):
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    def chat(self, messages: list[Message], max_tokens: int | None = None) -> str:
        body = {"model": self.model, "messages": messages, "temperature": 0}
        if max_tokens:
            body["max_tokens"] = max_tokens
        try:
            response = requests.post(
                self.URL,
                headers={"Authorization": f"Bearer {self.api_key}"},
                json=body,
                timeout=self.timeout,
            )
        except requests.RequestException as e:
            raise LLMError(f"OpenAI is not reachable ({type(e).__name__})") from e
        if response.status_code != 200:
            # the body explains quota / key problems without echoing the key
            raise LLMError(f"OpenAI returned {response.status_code}: {response.text[:200]}")
        try:
            return response.json()["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as e:
            raise LLMError("OpenAI returned an unexpected response") from e

    def available(self) -> bool:
        return bool(self.api_key)


def make_chat_model(settings: Settings) -> ChatModel:
    if settings.llm_provider == "openai":
        if not settings.openai_api_key:
            raise LLMError("LLM_PROVIDER=openai but OPENAI_API_KEY is not set in backend/.env")
        return OpenAIChat(settings.openai_api_key, settings.openai_model, settings.llm_timeout_seconds)
    return OllamaChat(settings.ollama_base_url, settings.ollama_model, settings.llm_timeout_seconds)
