import unittest
from types import SimpleNamespace

from langchain.agents.middleware.types import ModelRequest
from langchain_core.messages import HumanMessage

from mineru_middleware import MINERU_TOOL_NAME, PdfMinerUMiddleware


class FakeBackend:
    def __init__(self, exit_code: int = 127, output: str = "mineru not found") -> None:
        self.exit_code = exit_code
        self.output = output
        self.commands: list[tuple[str, int | None]] = []

    def execute(self, command: str, *, timeout: int | None = None):
        self.commands.append((command, timeout))
        return SimpleNamespace(
            exit_code=self.exit_code,
            output=self.output,
            truncated=False,
        )

    def glob(self, pattern: str, path: str = "/"):
        return SimpleNamespace(error=None, matches=[])

    def download_files(self, paths: list[str]):
        return []


def _tool_names(tools: list[object]) -> set[str]:
    names: set[str] = set()
    for tool_like in tools:
        name = getattr(tool_like, "name", None)
        if name:
            names.add(str(name))
    return names


class PdfMinerUMiddlewareTest(unittest.TestCase):
    def test_hides_mineru_tool_without_pdf_attachment(self) -> None:
        middleware = PdfMinerUMiddleware(backend=FakeBackend())
        request = ModelRequest(
            model=object(),
            messages=[HumanMessage(content="hello")],
            tools=[*middleware.tools],
        )

        activated = middleware._activate_if_needed(request)

        self.assertNotIn(MINERU_TOOL_NAME, _tool_names(activated.tools))
        self.assertIsNone(activated.system_message)

    def test_keeps_mineru_tool_and_prompt_with_pdf_attachment(self) -> None:
        middleware = PdfMinerUMiddleware(backend=FakeBackend())
        request = ModelRequest(
            model=object(),
            messages=[
                HumanMessage(
                    content="read this",
                    additional_kwargs={
                        "attachments": [
                            {
                                "kind": "pdf",
                                "workspacePath": "/.internagents/uploads/paper.pdf",
                            }
                        ]
                    },
                )
            ],
            tools=[*middleware.tools],
        )

        activated = middleware._activate_if_needed(request)

        self.assertIn(MINERU_TOOL_NAME, _tool_names(activated.tools))
        self.assertIsNotNone(activated.system_message)
        self.assertIn("parse_pdf_with_mineru", activated.system_message.text)

    def test_rejects_host_absolute_paths(self) -> None:
        middleware = PdfMinerUMiddleware(backend=FakeBackend())

        result = middleware.tools[0].invoke({"pdf_path": "/Users/me/paper.pdf"})

        self.assertFalse(result["ok"])
        self.assertIn("Host absolute paths", result["error"])

    def test_returns_structured_error_when_mineru_is_missing(self) -> None:
        backend = FakeBackend()
        middleware = PdfMinerUMiddleware(backend=backend)

        result = middleware.tools[0].invoke({"pdf_path": "/paper.pdf"})

        self.assertFalse(result["ok"])
        self.assertEqual(result["exitCode"], 127)
        self.assertIn("MinerU command failed", result["error"])
        self.assertTrue(backend.commands)
        self.assertIn("mineru", backend.commands[0][0])


if __name__ == "__main__":
    unittest.main()
