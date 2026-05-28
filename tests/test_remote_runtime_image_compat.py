import unittest

from langchain.agents.middleware.types import ModelRequest
from langchain_core.messages import HumanMessage, ToolMessage

from agent import (
    GOAL_CONTINUATION_TURNS_KEY,
    ImageContentCompatibilityMiddleware,
    _route_after_remote_runtime,
    _should_continue_goal,
    _normalize_remote_message,
    _normalize_state_for_remote_runtime,
    _with_goal_continuation_accounting,
)


class RemoteRuntimeImageCompatTest(unittest.TestCase):
    def test_tool_message_image_block_becomes_image_url(self) -> None:
        message = ToolMessage(
            content=[
                {
                    "type": "image",
                    "base64": "ZmFrZQ==",
                    "mime_type": "image/png",
                }
            ],
            tool_call_id="tool-1",
        )

        normalized = _normalize_remote_message(message)

        self.assertIsInstance(normalized, ToolMessage)
        self.assertEqual(
            normalized.content,
            [
                {
                    "type": "image_url",
                    "image_url": {"url": "data:image/png;base64,ZmFrZQ=="},
                }
            ],
        )

    def test_state_normalization_preserves_other_messages(self) -> None:
        state = {
            "messages": [
                HumanMessage(
                    content=[
                        {"type": "text", "text": "请分析这张图"},
                        {
                            "type": "image_url",
                            "image_url": {"url": "data:image/png;base64,abcd"},
                        },
                    ]
                ),
                ToolMessage(
                    content=[
                        {
                            "type": "image",
                            "base64": "ZmFrZQ==",
                            "mime_type": "image/png",
                        }
                    ],
                    tool_call_id="tool-2",
                ),
            ]
        }

        normalized = _normalize_state_for_remote_runtime(state)

        self.assertEqual(
            normalized["messages"][0].content,
            [
                {"type": "text", "text": "请分析这张图"},
                {
                    "type": "image_url",
                    "image_url": {"url": "data:image/png;base64,abcd"},
                },
            ],
        )
        self.assertEqual(
            normalized["messages"][1].content,
            [
                {
                    "type": "image_url",
                    "image_url": {"url": "data:image/png;base64,ZmFrZQ=="},
                }
            ],
        )

    def test_state_normalization_drops_parent_goal_runtime_keys(self) -> None:
        normalized = _normalize_state_for_remote_runtime(
            {
                "messages": [],
                "goal": {"status": "active", "objective": "finish"},
                GOAL_CONTINUATION_TURNS_KEY: 3,
            }
        )

        self.assertNotIn(GOAL_CONTINUATION_TURNS_KEY, normalized)
        self.assertEqual(normalized["goal"]["status"], "active")

    def test_tool_message_file_block_becomes_text_placeholder(self) -> None:
        message = ToolMessage(
            content=[
                {
                    "type": "file",
                    "base64": "JVBERi0=",
                    "mime_type": "application/pdf",
                }
            ],
            tool_call_id="tool-file",
        )

        normalized = _normalize_remote_message(message)

        self.assertIsInstance(normalized, ToolMessage)
        self.assertEqual(normalized.content[0]["type"], "text")
        self.assertIn("application/pdf", normalized.content[0]["text"])

    def test_goal_continuation_accounting_and_route(self) -> None:
        previous = {GOAL_CONTINUATION_TURNS_KEY: 2}
        next_state = {"goal": {"status": "active", "objective": "finish"}}

        updated = _with_goal_continuation_accounting(previous, next_state)

        self.assertEqual(updated[GOAL_CONTINUATION_TURNS_KEY], 3)
        self.assertTrue(_should_continue_goal(updated, max_turns=4))
        self.assertFalse(_should_continue_goal(updated, max_turns=3))
        self.assertEqual(
            _route_after_remote_runtime({"goal": {"status": "complete"}}),
            "__end__",
        )

    def test_model_request_middleware_normalizes_tool_image_blocks(self) -> None:
        request = ModelRequest(
            model=object(),
            messages=[
                ToolMessage(
                    content=[
                        {
                            "type": "image",
                            "base64": "ZmFrZQ==",
                            "mime_type": "image/png",
                        }
                    ],
                    tool_call_id="tool-3",
                )
            ],
        )

        normalized = ImageContentCompatibilityMiddleware()._normalize_request(request)

        self.assertEqual(
            normalized.messages[0].content,
            [
                {
                    "type": "image_url",
                    "image_url": {"url": "data:image/png;base64,ZmFrZQ=="},
                }
            ],
        )


if __name__ == "__main__":
    unittest.main()
