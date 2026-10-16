"""Natural-language questions about the habit data, answered by an LLM that writes SQL.

schema.py  which tables the model sees, described for the prompt
guard.py   static checks a query must pass before it runs
db.py      read-only execution (READ ONLY transaction, timeout, row cap)
llm.py     Ollama / OpenAI chat clients
agent.py   the generate -> check -> run -> correct loop, then the written answer
"""
