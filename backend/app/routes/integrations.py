import re
from datetime import date, datetime
from typing import Optional

import requests
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import logger, settings
from app.database import get_db
from app.models import Integration, LeetcodeProblem
from app.schemas import IntegrationResponse

router = APIRouter(prefix="/integrations", tags=["integrations"])

CURRENT_USER_ID = 1
REQUEST_TIMEOUT = 10

# Filenames that look like a LeetCode solution, e.g. "146-lru-cache.py", "leetcode/two_sum.java".
_LEETCODE_FILE_RE = re.compile(r"(leetcode|lc[-_])", re.IGNORECASE)
_NUMBERED_FILE_RE = re.compile(r"^(\d{1,4})[-_.]?(.+)\.\w+$")


def _get_integration(db: Session, provider: str) -> Optional[Integration]:
    return (
        db.query(Integration)
        .filter(Integration.user_id == CURRENT_USER_ID, Integration.provider == provider)
        .first()
    )


def _upsert_integration(db: Session, provider: str, token: str, external_ref: Optional[str]) -> Integration:
    integration = _get_integration(db, provider)
    if not integration:
        integration = Integration(user_id=CURRENT_USER_ID, provider=provider)
        db.add(integration)
    integration.access_token = token
    integration.external_ref = external_ref
    db.commit()
    db.refresh(integration)
    return integration


# ---------- GitHub ----------

def fetch_github_repo_stats(token: str, repo: str) -> dict:
    headers = {"Authorization": f"token {token}", "Accept": "application/vnd.github+json"}
    resp = requests.get(f"{settings.github_api_base_url}/repos/{repo}", headers=headers, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    data = resp.json()
    return {
        "default_branch": data.get("default_branch", "main"),
        "pushed_at": data.get("pushed_at"),
        "size_kb": data.get("size"),
    }


def parse_leetcode_from_repo(token: str, repo: str, default_branch: str) -> list[dict]:
    """Best-effort heuristic: scans the repo's file tree for filenames that look like
    LeetCode solutions (e.g. '146-lru-cache.py' or anything under a 'leetcode/' folder).
    Doesn't fetch per-file commit dates (that's one API call per file and would burn
    through GitHub's rate limit fast) - synced problems get solved_date = today.
    """
    headers = {"Authorization": f"token {token}", "Accept": "application/vnd.github+json"}
    resp = requests.get(
        f"{settings.github_api_base_url}/repos/{repo}/git/trees/{default_branch}",
        params={"recursive": "1"},
        headers=headers,
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    tree = resp.json().get("tree", [])

    found = []
    for entry in tree:
        if entry.get("type") != "blob":
            continue
        path = entry["path"]
        filename = path.rsplit("/", 1)[-1]

        if not (_LEETCODE_FILE_RE.search(path) or _NUMBERED_FILE_RE.match(filename)):
            continue

        match = _NUMBERED_FILE_RE.match(filename)
        if match:
            name = match.group(2).replace("-", " ").replace("_", " ").strip().title()
        else:
            name = filename.rsplit(".", 1)[0].replace("-", " ").replace("_", " ").strip().title()

        if name:
            found.append({"question_name": name, "path": path})

    return found


@router.post("/github/connect", response_model=IntegrationResponse)
def connect_github(token: str, repo: str, db: Session = Depends(get_db)):
    """`repo` is the GitHub 'owner/name' that holds your LeetCode solutions."""
    try:
        fetch_github_repo_stats(token, repo)
    except requests.RequestException as exc:
        raise HTTPException(status_code=400, detail=f"Couldn't verify token/repo against GitHub: {exc}")

    return _upsert_integration(db, "github", token, repo)


@router.get("/github/sync", response_model=IntegrationResponse)
def sync_github(db: Session = Depends(get_db)):
    integration = _get_integration(db, "github")
    if not integration:
        raise HTTPException(status_code=404, detail="GitHub isn't connected yet - call POST /integrations/github/connect first")

    try:
        stats = fetch_github_repo_stats(integration.access_token, integration.external_ref)
        parsed = parse_leetcode_from_repo(integration.access_token, integration.external_ref, stats["default_branch"])
    except requests.RequestException as exc:
        logger.error("GitHub sync failed for repo %s: %s", integration.external_ref, exc)
        # Graceful degradation: keep serving whatever we last synced instead of erroring out.
        integration.last_sync_summary = f"Last sync failed ({exc}); showing previous data."
        db.commit()
        db.refresh(integration)
        return integration

    existing_names = {
        p.question_name.strip().lower()
        for p in db.query(LeetcodeProblem).filter(LeetcodeProblem.user_id == CURRENT_USER_ID).all()
    }
    new_count = 0
    today = date.today()
    for item in parsed:
        key = item["question_name"].strip().lower()
        if key in existing_names:
            continue
        db.add(
            LeetcodeProblem(
                user_id=CURRENT_USER_ID,
                question_name=item["question_name"],
                key_note=f"Synced from GitHub: {item['path']}",
                solved=True,
                solved_date=today,
            )
        )
        existing_names.add(key)
        new_count += 1

    integration.last_synced_at = datetime.utcnow()
    integration.last_sync_summary = f"Scanned repo, found {len(parsed)} candidate files, added {new_count} new problems."
    db.commit()
    db.refresh(integration)
    return integration


@router.get("/github/stats", response_model=IntegrationResponse)
def github_stats(db: Session = Depends(get_db)):
    integration = _get_integration(db, "github")
    if not integration:
        raise HTTPException(status_code=404, detail="GitHub isn't connected yet")
    return integration


# ---------- Goodreads ----------
#
# NOTE: Goodreads retired public API sign-ups for new developer keys in December 2020.
# This integration only works if you already hold a legacy key issued before then; for
# a new account, fetch_goodreads_data() below will fail with a 401/403 from Goodreads
# itself. It's included so the contract matches the spec and is ready to wire up to a
# different reading-tracker API (e.g. StoryGraph) or a manual CSV import if needed.

def fetch_goodreads_data(token: str) -> dict:
    resp = requests.get(
        f"{settings.goodreads_api_base_url}/review/list",
        params={"key": token, "v": 2, "format": "xml"},
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    return {"raw": resp.text[:2000]}


@router.post("/goodreads/connect", response_model=IntegrationResponse)
def connect_goodreads(token: str, db: Session = Depends(get_db)):
    return _upsert_integration(db, "goodreads", token, None)


@router.get("/goodreads/sync", response_model=IntegrationResponse)
def sync_goodreads(db: Session = Depends(get_db)):
    integration = _get_integration(db, "goodreads")
    if not integration:
        raise HTTPException(status_code=404, detail="Goodreads isn't connected yet - call POST /integrations/goodreads/connect first")

    try:
        fetch_goodreads_data(integration.access_token)
        integration.last_sync_summary = "Synced successfully."
    except requests.RequestException as exc:
        logger.warning("Goodreads sync failed (expected if API key is post-2020): %s", exc)
        integration.last_sync_summary = (
            f"Sync failed: {exc}. Goodreads stopped issuing public API keys in Dec 2020 - "
            "this only works with a legacy key."
        )

    integration.last_synced_at = datetime.utcnow()
    db.commit()
    db.refresh(integration)
    return integration
