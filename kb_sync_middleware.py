"""Best-effort KB sync middleware for resource-bound agent sessions."""

from __future__ import annotations

import shlex
from dataclasses import dataclass

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import SystemMessage

from deepagents.backends.protocol import ExecuteResponse
from internagent_resources import ResourceConfig


@dataclass
class KbSyncMiddleware(AgentMiddleware):
    resource: ResourceConfig
    backend: object

    @property
    def name(self) -> str:
        return f"KbSyncMiddleware_{self.resource.id}"

    def _sync(self, action: str) -> ExecuteResponse | None:
        if not self.resource.kb_path:
            return None
        command = f"cd {shlex.quote(self.resource.kb_path)} && {shlex.quote(self.resource.kb_command)} sync {action}"
        execute = getattr(self.backend, "execute", None)
        if not execute:
            return ExecuteResponse(output="Backend does not support execute; KB sync skipped.", exit_code=1)
        return execute(command, timeout=min(self.resource.timeout, 120))

    def before_agent(self, state, runtime):  # noqa: ANN001, ANN201
        result = self._sync("pull")
        if result is None or result.exit_code == 0:
            return None
        return {
            "messages": [
                SystemMessage(
                    content=(
                        f"[InternAgents KB sync warning] Resource {self.resource.id} failed to pull KB before this run.\n"
                        f"{result.output}"
                    )
                )
            ]
        }

    def after_agent(self, state, runtime):  # noqa: ANN001, ANN201
        result = self._sync("push")
        if result is None or result.exit_code == 0:
            return None
        return {
            "messages": [
                SystemMessage(
                    content=(
                        f"[InternAgents KB sync warning] Resource {self.resource.id} failed to push KB after this run.\n"
                        f"{result.output}"
                    )
                )
            ]
        }
