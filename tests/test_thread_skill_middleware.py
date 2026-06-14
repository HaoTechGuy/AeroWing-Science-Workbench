import unittest
from pathlib import Path
from types import SimpleNamespace

from langchain.agents.middleware.types import ToolCallRequest
from langchain_core.messages import ToolMessage
from langgraph.types import Command

from thread_skill_middleware import ThreadSkillMiddleware


class ThreadSkillMiddlewareTest(unittest.TestCase):
    def setUp(self) -> None:
        self.middleware = ThreadSkillMiddleware(
            backend=SimpleNamespace(),
            root_dir=Path.cwd(),
            catalog_paths=[],
        )

    def _request(self, tool_name: str = "task") -> ToolCallRequest:
        return ToolCallRequest(
            tool_call={
                "name": tool_name,
                "args": {},
                "id": "tool-call-1",
                "type": "tool_call",
            },
            tool=SimpleNamespace(name=tool_name),
            state={
                "messages": [],
                "threadSkills": {
                    "revision": 1,
                    "active": [{"key": "skills/docx", "name": "docx"}],
                },
            },
            runtime=SimpleNamespace(),
        )

    def test_task_can_read_thread_skills_but_does_not_return_them(self) -> None:
        def handler(request: ToolCallRequest) -> Command:
            self.assertIn("threadSkills", request.state)
            return Command(
                update={
                    "messages": [
                        ToolMessage(content="done", tool_call_id=request.tool_call["id"])
                    ],
                    "threadSkills": {
                        "revision": 1,
                        "active": [{"key": "skills/docx", "name": "docx"}],
                    },
                    "files": {},
                }
            )

        result = self.middleware.wrap_tool_call(self._request(), handler)

        self.assertIsInstance(result, Command)
        self.assertNotIn("threadSkills", result.update)
        self.assertIn("messages", result.update)
        self.assertIn("files", result.update)

    def test_non_task_tool_result_can_update_thread_skills(self) -> None:
        def handler(request: ToolCallRequest) -> Command:
            return Command(update={"threadSkills": {"revision": 2, "active": []}})

        result = self.middleware.wrap_tool_call(self._request("manage_skills"), handler)

        self.assertIsInstance(result, Command)
        self.assertIn("threadSkills", result.update)

    def test_task_tuple_update_strips_thread_skills(self) -> None:
        def handler(request: ToolCallRequest) -> Command:
            return Command(
                update=(
                    ("threadSkills", {"revision": 1, "active": []}),
                    (
                        "messages",
                        [ToolMessage(content="done", tool_call_id=request.tool_call["id"])],
                    ),
                )
            )

        result = self.middleware.wrap_tool_call(self._request(), handler)

        self.assertIsInstance(result, Command)
        self.assertEqual(len(result.update), 1)
        self.assertEqual(result.update[0][0], "messages")


if __name__ == "__main__":
    unittest.main()
