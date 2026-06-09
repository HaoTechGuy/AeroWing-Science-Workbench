import unittest
from datetime import datetime, timezone

from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain_core.messages import SystemMessage

from date_middleware import (
    RuntimeDateContextMiddleware,
    render_runtime_date_context,
)


class RuntimeDateContextMiddlewareTest(unittest.TestCase):
    def test_runtime_date_context_uses_supplied_clock_and_timezone(self) -> None:
        context = render_runtime_date_context(
            timezone_name="UTC",
            clock=lambda tz: datetime(2026, 6, 9, 20, 30, 0, tzinfo=tz),
        )

        self.assertIn("Current date: 2026-06-09 (Tuesday)", context)
        self.assertIn("Current local time: 20:30:00", context)
        self.assertIn("Time zone: UTC", context)
        self.assertIn("Yesterday: 2026-06-08", context)
        self.assertIn("Tomorrow: 2026-06-10", context)
        self.assertIn("dates before the current date as past dates", context)
        self.assertIn("Resolve relative dates", context)

    def test_runtime_date_context_converts_explicit_now(self) -> None:
        context = render_runtime_date_context(
            now=datetime(2026, 6, 9, 12, 30, 0, tzinfo=timezone.utc),
            timezone_name="UTC+08:00",
        )

        self.assertIn("Current date: 2026-06-09 (Tuesday)", context)
        self.assertIn("Current local time: 20:30:00", context)
        self.assertIn("UTC+08:00", context)

    def test_middleware_appends_context_without_replacing_system_prompt(self) -> None:
        request = ModelRequest(
            model=object(),
            messages=[],
            system_message=SystemMessage(content="Base instructions."),
        )
        seen: list[ModelRequest] = []

        def handler(next_request: ModelRequest) -> ModelResponse:
            seen.append(next_request)
            return ModelResponse(result=[])

        RuntimeDateContextMiddleware(
            timezone_name="UTC",
            clock=lambda tz: datetime(2026, 6, 9, 20, 30, 0, tzinfo=tz),
        ).wrap_model_call(request, handler)

        self.assertEqual(len(seen), 1)
        content = seen[0].system_message.text
        self.assertIn("Base instructions.", content)
        self.assertIn("Runtime date context:", content)
        self.assertIn("Current date: 2026-06-09", content)

    def test_screenshot_date_prompt_gets_current_date_context(self) -> None:
        request = ModelRequest(
            model=object(),
            messages=[
                {
                    "role": "user",
                    "content": "Nasdaq trend on 2026-06-08?",
                }
            ],
            system_message=SystemMessage(content="Base instructions."),
        )
        seen: list[ModelRequest] = []

        def handler(next_request: ModelRequest) -> ModelResponse:
            seen.append(next_request)
            return ModelResponse(result=[])

        RuntimeDateContextMiddleware(
            timezone_name="UTC+08:00",
            clock=lambda tz: datetime(2026, 6, 9, 20, 30, 0, tzinfo=tz),
        ).wrap_model_call(request, handler)

        content = seen[0].system_message.text
        self.assertIn("Current date: 2026-06-09 (Tuesday)", content)
        self.assertIn("Yesterday: 2026-06-08", content)
        self.assertIn("dates before the current date as past dates", content)
        self.assertIn("For current facts such as market prices", content)


if __name__ == "__main__":
    unittest.main()
