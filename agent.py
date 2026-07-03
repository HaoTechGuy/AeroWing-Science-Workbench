"""LangGraph entrypoint shim for InternAgents.

The graph implementation lives in :mod:`internagents.agent_graph`; this
root-level module stays so LangGraph configs and remote runtime launchers can
keep using ``./agent.py:agent``.
"""

from internagents.agent_graph import *  # noqa: F401,F403
