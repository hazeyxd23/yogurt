"""Showcase sample data: LeetCode problems, a busy calendar, and a DSA roadmap graph.

    cd backend
    .venv/Scripts/python.exe scripts/showcase_data.py           # add samples
    .venv/Scripts/python.exe scripts/showcase_data.py --remove  # take them out again

Everything is dated relative to today. What gets added is recorded in
scripts/.showcase_ids.json so --remove only deletes sample rows (and restores the
LeetCode note to what it was before).
"""

import json
import random
import sys
from datetime import date, datetime, time, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.cache import invalidate_analytics_cache  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.models import LeetcodeProblem, Note, Task  # noqa: E402
from app.routes.notes import system_note  # noqa: E402
from app.routes.tasks import _materialize  # noqa: E402

USER_ID = 1
IDS_FILE = Path(__file__).with_name(".showcase_ids.json")
rng = random.Random(42)
today = date.today()
now = datetime.now()

# ---------------------------------------------------------------- LeetCode

PROBLEMS = {
    "Arrays & Hashing": [
        ("Two Sum", "Easy", "Hash map of value -> index, check complement first."),
        ("Contains Duplicate", "Easy", "Set; return as soon as a value repeats."),
        ("Valid Anagram", "Easy", "Count letters with a 26-slot array."),
        ("Group Anagrams", "Medium", "Key = sorted word (or letter counts tuple)."),
        ("Top K Frequent Elements", "Medium", "Bucket sort by frequency - O(n)."),
        ("Product of Array Except Self", "Medium", "Prefix pass, then suffix pass, no division."),
        ("Longest Consecutive Sequence", "Medium", "Only start counting from numbers with no n-1."),
        ("Valid Sudoku", "Medium", "Sets per row / column / 3x3 box."),
    ],
    "Two Pointers": [
        ("Valid Palindrome", "Easy", "Skip non-alphanumerics, compare lowercase."),
        ("3Sum", "Medium", "Sort, fix one, two-pointer the rest, skip duplicates."),
        ("Container With Most Water", "Medium", "Move the shorter wall inward."),
        ("Trapping Rain Water", "Hard", "Track left/right max with two pointers."),
    ],
    "Sliding Window": [
        ("Best Time to Buy and Sell Stock", "Easy", "Keep the min price seen so far."),
        ("Longest Substring Without Repeating Characters", "Medium", "Window + last-seen index map."),
        ("Longest Repeating Character Replacement", "Medium", "Window valid while len - maxFreq <= k."),
        ("Minimum Window Substring", "Hard", "Expand to satisfy, shrink to minimise."),
    ],
    "Stack": [
        ("Valid Parentheses", "Easy", "Push openers, match closers."),
        ("Min Stack", "Medium", "Second stack of running minimums."),
        ("Daily Temperatures", "Medium", "Monotonic decreasing stack of indices."),
        ("Largest Rectangle in Histogram", "Hard", None),
    ],
    "Binary Search": [
        ("Binary Search", "Easy", "lo <= hi, mid = lo + (hi - lo) // 2."),
        ("Search a 2D Matrix", "Medium", "Treat it as one sorted array."),
        ("Koko Eating Bananas", "Medium", "Binary search on the answer (speed)."),
        ("Find Minimum in Rotated Sorted Array", "Medium", "Compare mid with the right end."),
        ("Median of Two Sorted Arrays", "Hard", None),
    ],
    "Linked List": [
        ("Reverse Linked List", "Easy", "prev / curr / next - draw it out."),
        ("Merge Two Sorted Lists", "Easy", "Dummy head node."),
        ("Linked List Cycle", "Easy", "Floyd: slow and fast pointers."),
        ("Reorder List", "Medium", "Find middle, reverse second half, weave."),
        ("LRU Cache", "Medium", "Hash map + doubly linked list."),
        ("Merge k Sorted Lists", "Hard", None),
    ],
    "Trees": [
        ("Invert Binary Tree", "Easy", "Swap children recursively."),
        ("Maximum Depth of Binary Tree", "Easy", "1 + max(depth(left), depth(right))."),
        ("Same Tree", "Easy", "Compare node by node."),
        ("Binary Tree Level Order Traversal", "Medium", "BFS with a queue, one level per loop."),
        ("Validate Binary Search Tree", "Medium", "Pass (low, high) bounds down."),
        ("Kth Smallest Element in a BST", "Medium", "In-order traversal, stop at k."),
        ("Binary Tree Maximum Path Sum", "Hard", None),
        ("Serialize and Deserialize Binary Tree", "Hard", None),
    ],
    "Graphs": [
        ("Number of Islands", "Medium", "DFS flood fill, mark visited."),
        ("Clone Graph", "Medium", "Map old node -> new node while DFS-ing."),
        ("Course Schedule", "Medium", "Topological sort / cycle detection."),
        ("Pacific Atlantic Water Flow", "Medium", None),
    ],
    "Dynamic Programming": [
        ("Climbing Stairs", "Easy", "Fibonacci in disguise."),
        ("House Robber", "Medium", "dp[i] = max(dp[i-1], dp[i-2] + nums[i])."),
        ("Coin Change", "Medium", "Bottom-up, dp[amount] = min coins."),
        ("Longest Increasing Subsequence", "Medium", None),
        ("Word Break", "Medium", None),
        ("Edit Distance", "Medium", None),
    ],
}


def solved_days():
    """A believable history: a current streak plus scattered days over ~6 weeks."""
    days = [today - timedelta(days=i) for i in range(0, 9)]  # 9-day streak up to today
    days += [today - timedelta(days=i) for i in range(11, 44) if rng.random() < 0.6]
    return days


def seed_leetcode(db, record):
    days = solved_days()
    created = []
    flat = [(topic, *p) for topic, items in PROBLEMS.items() for p in items]
    # The last few problems of each topic stay unsolved (notes = None marks them).
    solved_pool = [p for p in flat if p[3]]
    rng.shuffle(days)
    solved_i = 0
    for topic, name, difficulty, note in flat:
        solved = note is not None
        if solved:
            day = days[solved_i % len(days)]
            solved_i += 1
        else:
            day = today - timedelta(days=rng.randint(0, 20))
        hour = rng.choice([7, 7, 8, 12, 20, 21, 21, 22, 23])
        stamp = datetime.combine(day, time(hour, rng.randint(0, 59)))
        p = LeetcodeProblem(
            user_id=USER_ID,
            question_name=name,
            difficulty=difficulty,
            key_note=note,
            solved=solved,
            solved_date=day if solved else None,
            created_at=stamp,
        )
        db.add(p)
        created.append(p)
    db.flush()
    record["leetcode_ids"] = [p.id for p in created]

    # The problems list is a note: one section per topic, tick = solved.
    note = system_note("leetcode", db)
    record["leetcode_note_id"] = note.id
    record["leetcode_note_before"] = note.content
    solved_count = len(solved_pool)
    lines = [
        "# LeetCode Problems",
        "",
        f"**{solved_count}/{len(flat)} solved** - following the [[DSA Roadmap]]. Tick a problem when it's solved.",
        "",
    ]
    # keep anything that was already in the list
    existing = [l for l in note.content.splitlines() if l.lstrip().startswith("- [")]
    if existing:
        lines += ["## Earlier", *existing, ""]
    for topic, items in PROBLEMS.items():
        done = sum(1 for _, _, n in items if n)
        lines.append(f"## {topic} · {done}/{len(items)}")
        for name, difficulty, n in items:
            lines.append(f"- [{'x' if n else ' '}] {name} #{difficulty.lower()}")
            if n:
                lines.append(f"  - {n}")
        lines.append("")
    lines += ["## Next up", "- Revisit ==Trapping Rain Water== without looking at notes", "- Timed mock: 2 mediums in 45 min", ""]
    note.content = "\n".join(lines)
    print(f"LeetCode: {len(flat)} problems ({solved_count} solved)")


# ---------------------------------------------------------------- calendar

C = {
    "tomato": "#d50000", "flamingo": "#e67c73", "tangerine": "#f4511e", "banana": "#f6bf26",
    "sage": "#33b679", "basil": "#0b8043", "peacock": "#039be5", "blueberry": "#3f51b5",
    "lavender": "#7986cb", "grape": "#8e24aa", "graphite": "#616161",
}

week_start = today - timedelta(days=(today.weekday() + 1) % 7)  # Sunday


def at(day, hh, mm=0):
    return datetime.combine(day, time(hh, mm))


def event(db, record, title, day, start=None, end=None, color="sage", note=None, priority=2, all_day=False, repeat=None, done=None):
    t = Task(
        user_id=USER_ID,
        title=title,
        description=note,
        task_date=day,
        scheduled_time=at(day, *start) if start else None,
        end_time=at(day, *end) if end else None,
        all_day=all_day or not start,
        color=C[color],
        priority=priority,
        completed=False,
    )
    if done is None:
        done = (t.end_time or at(day, 23, 59)) < now
    t.completed = bool(done)
    db.add(t)
    db.flush()
    if repeat:
        _materialize(db, t, repeat)
        db.flush()
        # past occurrences of routines are mostly done
        for occ in db.query(Task).filter(Task.series_id == t.series_id, Task.id != t.id).all():
            end_at = occ.end_time or at(occ.task_date, 23, 59)
            occ.completed = end_at < now and rng.random() < 0.85
        record.setdefault("series", []).append(t.series_id)
    else:
        record.setdefault("task_ids", []).append(t.id)
    return t


def seed_calendar(db, record):
    w = lambda n: week_start + timedelta(days=n)  # noqa: E731  (0 = Sunday of this week)

    # Routines (repeating, started a few weeks ago)
    event(db, record, "Morning workout", w(-13), (7, 0), (7, 45), "sage", repeat="weekdays", priority=3,
          note="- [ ] 10 min mobility\n- [ ] 3 x 12 push-ups\n- [ ] 20 min run")
    event(db, record, "LeetCode daily", w(-14), (8, 0), (8, 45), "grape", repeat="daily", priority=1,
          note="One problem from the [[LeetCode Problems]] list.\n- [ ] Read the problem twice\n- [ ] Brute force first, then optimise\n- [ ] Write the pattern down")
    event(db, record, "Team standup", w(-13), (10, 0), (10, 15), "peacock", repeat="weekdays")
    event(db, record, "Guitar practice", w(-14), (19, 0), (19, 45), "tangerine", repeat="daily", priority=3,
          note="- [ ] Scales with the metronome at 90 BPM\n- [ ] Chord changes G - C - D\n- [ ] Learn 8 bars of the new song")
    event(db, record, "Weekly review", w(-14), (18, 0), (18, 30), "lavender", repeat="weekly",
          note="## Review\n- [ ] Check the dashboard streaks\n- [ ] What went well?\n- [ ] Plan next week's deep work blocks")
    event(db, record, "LeetCode Weekly Contest", w(-14), (8, 30), (10, 0), "grape", repeat="weekly", priority=1,
          note="Contest every Sunday. Upsolve one problem afterwards.")

    # This week
    event(db, record, "Meal prep", w(0), (15, 0), (16, 30), "banana", note="- [ ] Chicken + rice\n- [ ] Overnight oats x5")
    event(db, record, "System design reading", w(1), (14, 0), (15, 30), "blueberry", priority=1,
          note="Chapter 4: **rate limiter**\n- [x] Token bucket vs leaky bucket\n- [ ] Sketch a distributed version")
    event(db, record, "Gym - legs", w(1), (17, 30), (18, 30), "sage")
    event(db, record, "Mock interview", w(2), (16, 0), (17, 0), "tomato", priority=1,
          note="## Prep\n- [x] Review [[DSA Roadmap]] weak spots\n- [x] 2 mediums: graphs + DP\n- [ ] Ask about their on-call culture")
    event(db, record, "Read: Atomic Habits ch. 6", w(2), (21, 0), (21, 45), "peacock")
    event(db, record, "Deep work: productivity app", w(3), (13, 0), (16, 0), "blueberry", priority=1,
          note="## Goal\nShip the calendar view.\n- [x] Week grid + drag to move\n- [ ] Month view polish\n- [ ] Screenshots for LinkedIn")
    event(db, record, "Code review", w(3), (14, 0), (15, 0), "lavender", note="PR #42 - notes system")
    event(db, record, "Dentist", w(3), (17, 30), (18, 15), "graphite", priority=2)
    event(db, record, "Coffee with mentor", w(4), (12, 30), (13, 30), "flamingo",
          note="- [ ] Ask about system design prep\n- [ ] Share the productivity app")
    event(db, record, "Binary trees deep dive", w(4), (20, 0), (21, 30), "grape", priority=1,
          note="Work through [[Binary Tree Traversals]].\n- [ ] Iterative in-order\n- [ ] Morris traversal")
    event(db, record, "Ship productivity app v2", w(5), color="basil", all_day=True, priority=1,
          note="- [ ] Final QA pass\n- [ ] Deploy\n- [ ] Write the LinkedIn post")
    event(db, record, "Pair programming", w(5), (15, 0), (16, 30), "lavender")
    event(db, record, "Hike", w(6), (9, 0), (12, 0), "sage", priority=3)
    event(db, record, "Groceries", w(6), (13, 0), (13, 45), "banana", priority=3)

    # Coming weeks
    event(db, record, "LinkedIn post: productivity app", w(8), color="peacock", all_day=True)
    event(db, record, "Interview: backend role", w(9), (11, 0), (12, 0), "tomato", priority=1,
          note="## Checklist\n- [ ] Research the team\n- [ ] Two STAR stories\n- [ ] Questions to ask")
    event(db, record, "Book club", w(11), (19, 30), (21, 0), "flamingo", note="Discussing *Atomic Habits*.")
    event(db, record, "Hackathon", w(12), color="tangerine", all_day=True, priority=1)
    event(db, record, "Hackathon", w(13), color="tangerine", all_day=True, priority=1)
    event(db, record, "Dynamic programming sprint", w(15), (18, 0), (20, 0), "grape", priority=1,
          note="See [[DP Cheatsheet]].\n- [ ] Knapsack variants\n- [ ] Interval DP")
    event(db, record, "Car service", w(17), (9, 0), (10, 0), "graphite")
    event(db, record, "Mock interview #2", w(18), (16, 0), (17, 0), "tomato", priority=1)
    event(db, record, "Rent due", w(24), color="graphite", all_day=True)

    # Last week (done)
    event(db, record, "Graph algorithms session", w(-5), (20, 0), (21, 30), "grape",
          note="- [x] BFS / DFS templates\n- [x] Course Schedule\n- [x] Number of Islands")
    event(db, record, "Portfolio review", w(-4), (14, 0), (15, 0), "blueberry")
    event(db, record, "Team lunch", w(-3), (12, 0), (13, 0), "flamingo")

    count = db.query(Task).filter(
        (Task.id.in_(record.get("task_ids", []))) | (Task.series_id.in_(record.get("series", [])))
    ).count()
    print(f"Calendar: {count} events")


# ---------------------------------------------------------------- DSA graph

def seed_graph(db, record):
    def note(title, content):
        n = Note(user_id=USER_ID, title=title, kind="text", content=content)
        db.add(n)
        db.flush()
        record.setdefault("note_ids", []).append(n.id)
        return n

    two_ptr = note("Two Pointer Patterns", "# Two Pointer Patterns\n\n## Opposite ends\n- [x] Valid Palindrome\n- [x] 3Sum - sort first\n- [x] Container With Most Water\n\n## Same direction\n- [x] Remove duplicates in place\n- [ ] Trapping Rain Water (hard)\n\n> Move the pointer that can only make things worse.\n\nBack to the [[DSA Roadmap]].")
    trees = note("Binary Tree Traversals", "# Binary Tree Traversals\n\n- [x] Pre-order: node, left, right\n- [x] In-order: left, node, right (sorted for a BST)\n- [x] Post-order: left, right, node\n- [x] Level order: BFS with a queue\n- [ ] Morris traversal (O(1) space)\n\n```\ndef inorder(node):\n    if node:\n        inorder(node.left); visit(node); inorder(node.right)\n```\n\nPart of the [[DSA Roadmap]].")
    dp = note("DP Cheatsheet", "# DP Cheatsheet\n\n1. Define the state\n2. Write the recurrence\n3. Base cases\n4. Order of computation\n\n## Classics\n- [x] Climbing Stairs #easy\n- [x] House Robber #medium\n- [x] Coin Change #medium\n- [ ] Edit Distance #medium\n- [ ] Burst Balloons #hard\n\nSee the [[DSA Roadmap]].")

    def n(id_, label, x, y, priority=None, progress=0, accent=False, note_id=None):
        return {"id": id_, "label": label, "x": x, "y": y, "priority": priority, "progress": progress,
                "accent": accent, "noteId": note_id}

    def g(id_, label, x, y, w, h):
        return {"id": id_, "label": label, "x": x, "y": y, "w": w, "h": h}

    edge_no = iter(range(1, 100))

    def e(a, b, style="solid"):
        return {"id": f"e_{next(edge_no)}", "from": a, "to": b, "style": style}

    graph = {
        "nodes": [
            n("n_root", "Data Structure & Algorithm", 455, 0, progress=None, accent=True),
            n("n_array", "Array", 250, 110, progress=None, accent=True),
            n("n_ll", "Linked List", 740, 110, progress=None, accent=True),
            n("n_prefix", "Prefix Sum", 140, 270, "low", 100),
            n("n_diff", "Diff Array", 140, 340, "low", 80),
            n("n_2d", "2D Array", 140, 410, "low", 90),
            n("n_tp1", "Two Pointer", 140, 560, "low", 100, note_id=two_ptr.id),
            n("n_sw", "Sliding Window", 140, 630, "medium", 60),
            n("n_bs", "Binary Search", 140, 700, "medium", 45),
            n("n_rand", "Randomize", 140, 770, "high", 0),
            n("n_cycle", "Cycle Array", 440, 270, "low", 100),
            n("n_stack", "Stack & Queue", 590, 270, "medium", 70),
            n("n_hash", "Hashing", 440, 340, "low", 100),
            n("n_design", "Design", 590, 340, "medium", 35),
            n("n_tp2", "Two Pointer", 870, 230, "low", 100, note_id=two_ptr.id),
            n("n_rec", "Recursion", 870, 330, "medium", 75),
            n("n_bt", "Binary Tree", 870, 430, "medium", 60, note_id=trees.id),
            n("n_bst", "BST", 420, 520, "medium", 50),
            n("n_heap", "Heap", 560, 520, "medium", 40),
            n("n_trie", "Trie", 420, 590, "high", 10),
            n("n_graph", "Graph", 560, 590, "high", 25),
            n("n_rtrav", "Recursive Traverse", 740, 570, "medium", 65, note_id=trees.id),
            n("n_ltrav", "Level Traverse", 960, 570, "medium", 55),
            n("n_math", "Math", 380, 740, "medium", 30),
            n("n_greedy", "Greedy", 380, 810, "medium", 40),
            n("n_back", "Backtracking", 590, 740, "high", 15),
            n("n_dfs", "DFS", 590, 810, "high", 30),
            n("n_dc", "Divide & Conquer", 790, 740, "high", 10),
            n("n_dp", "DP", 790, 810, "high", 35, note_id=dp.id),
            n("n_bfs", "BFS", 990, 700, "high", 40),
            n("n_sp", "Shortest Path", 990, 800, "high", 0),
        ],
        "groups": [
            g("g_ops", "Operations", 120, 230, 170, 245),
            g("g_atp", "Array Two Pointer", 120, 520, 190, 315),
            g("g_basic", "Basic Data Structure", 420, 230, 320, 175),
            g("g_adv", "Advanced Data Structure", 400, 480, 300, 175),
            g("g_other", "Other", 360, 700, 170, 175),
            g("g_trav", "Traverse View", 570, 700, 180, 175),
            g("g_sub", "Subproblem View", 770, 700, 190, 175),
        ],
        "edges": [
            e("n_root", "n_array"), e("n_root", "n_ll"),
            e("n_array", "g_ops", "dashed"), e("n_ll", "g_basic", "dashed"), e("n_ll", "n_tp2", "dashed"),
            e("g_ops", "g_basic"), e("g_ops", "g_atp"),
            e("n_tp2", "n_rec"), e("n_rec", "n_bt"),
            e("n_bt", "g_adv"), e("n_bt", "n_rtrav"), e("n_bt", "n_ltrav"),
            e("n_rtrav", "g_trav"), e("n_rtrav", "g_sub"),
            e("n_ltrav", "n_bfs"), e("n_bfs", "n_sp"),
        ],
    }
    roadmap = Note(user_id=USER_ID, title="DSA Roadmap", kind="graph", content="", graph=graph)
    db.add(roadmap)
    db.flush()
    record["note_ids"].append(roadmap.id)
    print(f"Notes: DSA Roadmap graph ({len(graph['nodes'])} nodes) + 3 linked notes")


# ---------------------------------------------------------------- main

def add():
    if IDS_FILE.exists():
        sys.exit("Showcase data is already loaded - run with --remove first.")
    db = SessionLocal()
    record = {}
    try:
        seed_leetcode(db, record)
        seed_calendar(db, record)
        seed_graph(db, record)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    IDS_FILE.write_text(json.dumps(record, indent=2))
    invalidate_analytics_cache(USER_ID)
    print(f"Done. Remove later with: python {Path(__file__).name} --remove")


def remove():
    if not IDS_FILE.exists():
        sys.exit("No showcase data recorded.")
    record = json.loads(IDS_FILE.read_text())
    db = SessionLocal()
    try:
        db.query(LeetcodeProblem).filter(LeetcodeProblem.id.in_(record.get("leetcode_ids", []))).delete(synchronize_session=False)
        db.query(Task).filter(Task.id.in_(record.get("task_ids", []))).delete(synchronize_session=False)
        db.query(Task).filter(Task.series_id.in_(record.get("series", []))).delete(synchronize_session=False)
        db.query(Note).filter(Note.id.in_(record.get("note_ids", []))).delete(synchronize_session=False)
        lc = db.query(Note).filter(Note.id == record.get("leetcode_note_id")).first()
        if lc is not None:
            lc.content = record.get("leetcode_note_before", lc.content)
        db.commit()
    finally:
        db.close()
    IDS_FILE.unlink()
    invalidate_analytics_cache(USER_ID)
    print("Showcase data removed.")


if __name__ == "__main__":
    remove() if "--remove" in sys.argv else add()
