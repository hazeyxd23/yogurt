from dataclasses import asdict

from fastapi import APIRouter, HTTPException

from app.agent.agent import ask
from app.agent.db import run_readonly, uses_readonly_role
from app.agent.llm import LLMError, make_chat_model
from app.agent.schema import ALLOWED_TABLES
from app.config import logger, settings
from app.schemas import AgentAnswerResponse, AgentQuestion, AgentStatusResponse

router = APIRouter(prefix="/agent", tags=["agent"])


@router.post("/ask", response_model=AgentAnswerResponse)
def ask_agent(body: AgentQuestion):
    try:
        llm = make_chat_model(settings)
        result = ask(
            body.question.strip(),
            llm,
            run_readonly,
            max_attempts=settings.agent_max_attempts,
            row_limit=settings.agent_row_limit,
        )
    except LLMError as e:
        raise HTTPException(status_code=503, detail=str(e))
    logger.info(
        "agent: %r answered=%s attempts=%d %dms",
        result.question, result.answered, len(result.attempts), result.elapsed_ms,
    )
    return AgentAnswerResponse(**asdict(result), provider=llm.provider, model=llm.model)


@router.get("/status", response_model=AgentStatusResponse)
def agent_status():
    try:
        llm = make_chat_model(settings)
        provider, model, available = llm.provider, llm.model, llm.available()
    except LLMError:
        provider, model, available = settings.llm_provider, settings.openai_model, False
    return AgentStatusResponse(
        provider=provider,
        model=model,
        available=available,
        readonly_role=uses_readonly_role(),
        tables=list(ALLOWED_TABLES),
    )
