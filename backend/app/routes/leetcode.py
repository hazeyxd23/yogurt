from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.cache import invalidate_analytics_cache
from app.database import get_db
from app.models import LeetcodeProblem
from app.schemas import (
    LeetcodeProblemCreate,
    LeetcodeProblemResponse,
    LeetcodeProblemUpdate,
    LeetcodeStatsResponse,
)
from app.utils.database_optimization import paginate

router = APIRouter(prefix="/leetcode", tags=["leetcode"])

CURRENT_USER_ID = 1


@router.post("/problems", response_model=LeetcodeProblemResponse)
def create_problem(problem: LeetcodeProblemCreate, db: Session = Depends(get_db)):
    db_problem = LeetcodeProblem(user_id=CURRENT_USER_ID, **problem.model_dump())
    db.add(db_problem)
    db.commit()
    db.refresh(db_problem)
    invalidate_analytics_cache(CURRENT_USER_ID)
    return db_problem


@router.get("/problems", response_model=List[LeetcodeProblemResponse])
def list_problems(
    response: Response,
    solved: Optional[bool] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    query = db.query(LeetcodeProblem).filter(LeetcodeProblem.user_id == CURRENT_USER_ID)
    if solved is not None:
        query = query.filter(LeetcodeProblem.solved == solved)
    query = query.order_by(LeetcodeProblem.id.desc())
    items, total = paginate(query, skip=skip, limit=limit)
    response.headers["X-Total-Count"] = str(total)
    return items


@router.patch("/problems/{problem_id}", response_model=LeetcodeProblemResponse)
def update_problem(
    problem_id: int, problem_update: LeetcodeProblemUpdate, db: Session = Depends(get_db)
):
    db_problem = (
        db.query(LeetcodeProblem)
        .filter(LeetcodeProblem.id == problem_id, LeetcodeProblem.user_id == CURRENT_USER_ID)
        .first()
    )
    if not db_problem:
        raise HTTPException(status_code=404, detail="Leetcode problem not found")
    for field, value in problem_update.model_dump(exclude_unset=True).items():
        setattr(db_problem, field, value)
    db.commit()
    db.refresh(db_problem)
    invalidate_analytics_cache(CURRENT_USER_ID)
    return db_problem


@router.get("/stats", response_model=LeetcodeStatsResponse)
def leetcode_stats(db: Session = Depends(get_db)):
    query = db.query(LeetcodeProblem).filter(LeetcodeProblem.user_id == CURRENT_USER_ID)
    total_problems = query.count()
    solved_count = query.filter(LeetcodeProblem.solved == True).count()  # noqa: E712
    unsolved_count = total_problems - solved_count
    return LeetcodeStatsResponse(
        total_problems=total_problems,
        solved_count=solved_count,
        unsolved_count=unsolved_count,
    )
