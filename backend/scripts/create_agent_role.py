"""Create the Postgres role the Ask agent runs its SQL as: SELECT on the habit tables, nothing else.

    cd backend
    .venv/Scripts/python.exe scripts/create_agent_role.py            # create (or re-grant) the role
    .venv/Scripts/python.exe scripts/create_agent_role.py --rotate   # also set a new password

Connects with DATABASE_URL, which must be able to create roles (the default `postgres` user can).
The role gets a random password, defaults to read-only transactions with a statement timeout, and
can SELECT only the tables in app/agent/schema.py. AGENT_DATABASE_URL is then written to
backend/.env so the agent connects as this role instead of the app's own user.
"""

import secrets
import sys
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.agent.schema import ALLOWED_TABLES  # noqa: E402
from app.config import settings  # noqa: E402

ROLE = "yogurt_agent"
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def write_env(key: str, value: str) -> None:
    lines = ENV_FILE.read_text(encoding="utf-8").splitlines() if ENV_FILE.exists() else []
    lines = [line for line in lines if not line.startswith(f"{key}=")]
    lines.append(f"{key}={value}")
    ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    rotate = "--rotate" in sys.argv
    url = make_url(settings.database_url)
    engine = create_engine(url, isolation_level="AUTOCOMMIT")
    password = None

    with engine.connect() as conn:
        exists = conn.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": ROLE}).scalar()
        if not exists or rotate or not settings.agent_database_url:
            password = secrets.token_urlsafe(24)
            verb = "ALTER" if exists else "CREATE"
            conn.exec_driver_sql(f"{verb} ROLE {ROLE} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '{password}'")
        conn.exec_driver_sql(f"ALTER ROLE {ROLE} SET default_transaction_read_only = on")
        conn.exec_driver_sql(f"ALTER ROLE {ROLE} SET statement_timeout = '{settings.agent_statement_timeout_ms}ms'")

        conn.exec_driver_sql(f'GRANT CONNECT ON DATABASE "{url.database}" TO {ROLE}')
        conn.exec_driver_sql(f"GRANT USAGE ON SCHEMA public TO {ROLE}")
        conn.exec_driver_sql(f"REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {ROLE}")
        conn.exec_driver_sql(f"REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM {ROLE}")
        for table in ALLOWED_TABLES:
            conn.exec_driver_sql(f"GRANT SELECT ON {table} TO {ROLE}")

    if password:
        agent_url = url.set(username=ROLE, password=password)
        write_env("AGENT_DATABASE_URL", agent_url.render_as_string(hide_password=False))
        print(f"Role {ROLE} ready; AGENT_DATABASE_URL written to {ENV_FILE.name}.")
    else:
        print(f"Role {ROLE} re-granted; AGENT_DATABASE_URL in {ENV_FILE.name} is unchanged.")
    print(f"SELECT allowed on: {', '.join(ALLOWED_TABLES)}")


if __name__ == "__main__":
    main()
