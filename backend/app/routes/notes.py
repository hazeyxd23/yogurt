import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import LeetcodeProblem, Note
from app.schemas import NoteCreate, NoteResponse, NoteUpdate

router = APIRouter(prefix="/notes", tags=["notes"])

CURRENT_USER_ID = 1
DASHBOARD_NOTE_TITLE = "Dashboard"
DASHBOARD_NOTE_CONTENT = "# Quick note\n\n- [ ] Something to remember today\n"


def _get_note(db: Session, note_id: int) -> Note:
    note = db.query(Note).filter(Note.id == note_id, Note.user_id == CURRENT_USER_ID).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


def _rewrite_links(db: Session, old_title: str, new_title: str, skip_id: int) -> int:
    """Obsidian-style rename: point [[Old]] / [[Old|alias]] links in other notes at the new title."""
    pattern = re.compile(r"\[\[\s*" + re.escape(old_title) + r"\s*(\|[^\]]*)?\]\]", re.IGNORECASE)
    changed = 0
    candidates = (
        db.query(Note)
        .filter(Note.user_id == CURRENT_USER_ID, Note.id != skip_id, Note.content.ilike(f"%[[%{old_title}%"))
        .all()
    )
    for other in candidates:
        updated = pattern.sub(lambda m: f"[[{new_title}{m.group(1) or ''}]]", other.content)
        if updated != other.content:
            other.content = updated
            changed += 1
    return changed


@router.get("", response_model=List[NoteResponse])
def list_notes(floating: Optional[bool] = None, db: Session = Depends(get_db)):
    query = db.query(Note).filter(Note.user_id == CURRENT_USER_ID)
    if floating is not None:
        query = query.filter(Note.floating == floating)
    return query.order_by(Note.updated_at.desc()).all()


@router.get("/dashboard", response_model=NoteResponse)
def dashboard_note(db: Session = Depends(get_db)):
    note = db.query(Note).filter(Note.user_id == CURRENT_USER_ID, Note.is_dashboard.is_(True)).first()
    if not note:
        note = Note(
            user_id=CURRENT_USER_ID,
            title=DASHBOARD_NOTE_TITLE,
            content=DASHBOARD_NOTE_CONTENT,
            is_dashboard=True,
        )
        db.add(note)
        db.commit()
        db.refresh(note)
    return note


def _leetcode_note_content(db: Session) -> str:
    """Seed the LeetCode note from the problems already tracked."""
    lines = ["# LeetCode Problems", "", "Tick a problem when it's solved. New problems from the form land at the bottom.", ""]
    problems = (
        db.query(LeetcodeProblem)
        .filter(LeetcodeProblem.user_id == CURRENT_USER_ID)
        .order_by(LeetcodeProblem.created_at.asc(), LeetcodeProblem.id.asc())
        .all()
    )
    for p in problems:
        tag = f" #{p.difficulty.lower()}" if p.difficulty else ""
        lines.append(f"- [{'x' if p.solved else ' '}] {p.question_name}{tag}")
        if p.key_note:
            lines.append(f"  - {p.key_note}")
    return "\n".join(lines) + "\n"


SYSTEM_NOTES = {
    "leetcode": ("LeetCode Problems", _leetcode_note_content),
}


@router.get("/system/{key}", response_model=NoteResponse)
def system_note(key: str, db: Session = Depends(get_db)):
    """App-owned notes (e.g. the LeetCode problem list), created on first use."""
    if key not in SYSTEM_NOTES:
        raise HTTPException(status_code=404, detail="Unknown system note")
    note = db.query(Note).filter(Note.user_id == CURRENT_USER_ID, Note.system_key == key).first()
    if not note:
        title, build = SYSTEM_NOTES[key]
        note = Note(user_id=CURRENT_USER_ID, title=title, content=build(db), system_key=key)
        db.add(note)
        db.commit()
        db.refresh(note)
    return note


@router.post("", response_model=NoteResponse, status_code=201)
def create_note(payload: NoteCreate, db: Session = Depends(get_db)):
    data = payload.model_dump()
    if data["kind"] == "graph" and data["graph"] is None:
        data["graph"] = {"nodes": [], "edges": [], "groups": []}
    note = Note(user_id=CURRENT_USER_ID, **data)
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


@router.get("/{note_id}", response_model=NoteResponse)
def get_note(note_id: int, db: Session = Depends(get_db)):
    return _get_note(db, note_id)


@router.patch("/{note_id}", response_model=NoteResponse)
def update_note(note_id: int, payload: NoteUpdate, response: Response, db: Session = Depends(get_db)):
    note = _get_note(db, note_id)
    changes = payload.model_dump(exclude_unset=True)

    new_title = changes.get("title")
    if new_title is not None:
        new_title = new_title.strip() or "Untitled"
        changes["title"] = new_title
        if new_title != note.title:
            rewritten = _rewrite_links(db, note.title, new_title, note.id)
            response.headers["X-Links-Updated"] = str(rewritten)

    for field, value in changes.items():
        setattr(note, field, value)
    db.commit()
    db.refresh(note)
    return note


@router.delete("/{note_id}", status_code=204)
def delete_note(note_id: int, db: Session = Depends(get_db)):
    note = _get_note(db, note_id)
    if note.is_dashboard or note.system_key:
        raise HTTPException(status_code=400, detail="This note is used by the app and can't be deleted")
    db.delete(note)
    db.commit()
    return Response(status_code=204)
