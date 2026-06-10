import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from langchain.agents.middleware.types import ModelRequest, ModelResponse, ToolCallRequest
from langchain_core.messages import AIMessage, ToolMessage

import web_search_tools
from web_search_tools import (
    WebSearchSettings,
    WebSearchBudgetMiddleware,
    bing_search,
    duckduckgo_search,
    jina_fetch_url,
    jina_search,
    validate_fetch_web_url,
    web_search_reference_prompt,
    web_search_settings,
    web_search_tools as build_web_search_tools,
)


DUCKDUCKGO_HTML = """
<html>
  <body>
    <a rel="nofollow" class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=abc">
      Example &amp; Result
    </a>
    <a class="result__snippet">First snippet with   spaces.</a>
    <a class="result__a" href="https://example.org/b">Second Result</a>
    <div class="result__snippet">Second snippet</div>
  </body>
</html>
"""

BING_HTML = """
<html>
  <body>
    <ol id="b_results">
      <li class="b_algo">
        <h2><a href="https://example.com/bing-a">Bing &amp; Result</a></h2>
        <div class="b_caption"><p>First Bing snippet.</p></div>
      </li>
      <li class="b_algo">
        <h2><a href="https://example.org/bing-b">Second Bing Result</a></h2>
        <div class="b_caption"><p>Second Bing snippet.</p></div>
      </li>
    </ol>
  </body>
</html>
"""

JINA_JSON = """
{
  "code": 200,
  "status": 200,
  "data": [
    {
      "title": "Jina Result",
      "url": "https://example.com/jina-a",
      "description": "First Jina snippet.",
      "content": "# Jina Result\\n\\nLong page content."
    },
    {
      "title": "Second Jina Result",
      "url": "https://example.org/jina-b",
      "description": "",
      "content": "Second Jina content with enough fallback snippet text."
    }
  ]
}
"""

JINA_READER_JSON = """
{
  "code": 200,
  "status": 200,
  "data": {
    "title": "Example Page",
    "url": "https://example.com/article",
    "content": "# Example Page\\n\\nThis is readable page content from Jina Reader."
  }
}
"""


class WebSearchToolsTest(unittest.TestCase):
    def test_duckduckgo_html_results_are_parsed(self) -> None:
        with patch.object(web_search_tools, "_fetch_url", return_value=DUCKDUCKGO_HTML):
            results = duckduckgo_search(
                "internagents",
                max_results=2,
                timeout_seconds=3,
            )

        self.assertEqual(len(results), 2)
        self.assertEqual(results[0].title, "Example & Result")
        self.assertEqual(results[0].url, "https://example.com/a")
        self.assertEqual(results[0].snippet, "First snippet with spaces.")
        self.assertEqual(results[1].url, "https://example.org/b")

    def test_bing_html_results_are_parsed(self) -> None:
        with patch.object(web_search_tools, "_fetch_url", return_value=BING_HTML):
            results = bing_search(
                "internagents",
                max_results=2,
                timeout_seconds=3,
            )

        self.assertEqual(len(results), 2)
        self.assertEqual(results[0].title, "Bing & Result")
        self.assertEqual(results[0].url, "https://example.com/bing-a")
        self.assertEqual(results[0].snippet, "First Bing snippet.")
        self.assertEqual(results[1].url, "https://example.org/bing-b")

    def test_jina_json_results_are_parsed(self) -> None:
        with patch.object(web_search_tools, "_fetch_url", return_value=JINA_JSON) as fetch:
            results = jina_search(
                "internagents",
                max_results=2,
                timeout_seconds=3,
                api_key="jina_test",
            )

        self.assertEqual(fetch.call_args.args[1], 30)
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0].title, "Jina Result")
        self.assertEqual(results[0].url, "https://example.com/jina-a")
        self.assertEqual(results[0].snippet, "First Jina snippet.")
        self.assertEqual(
            results[1].snippet,
            "Second Jina content with enough fallback snippet text.",
        )

    def test_settings_use_config_and_environment_overrides(self) -> None:
        config = {
            "web_search": {
                "enabled": True,
                "provider": "duckduckgo",
                "max_results": 4,
                "timeout_seconds": 7,
            }
        }
        with patch.dict(
            os.environ,
            {
                "INTERNAGENTS_WEB_SEARCH_PROVIDER": "ddg",
                "INTERNAGENTS_WEB_SEARCH_MAX_RESULTS": "12",
            },
            clear=False,
        ):
            settings = web_search_settings(config)

        self.assertEqual(
            settings,
            WebSearchSettings(
                enabled=True,
                provider="ddg",
                max_results=10,
                timeout_seconds=7,
                max_fetch_chars=12000,
            ),
        )

    def test_settings_read_jina_key_from_environment(self) -> None:
        with patch.dict(
            os.environ,
            {
                "INTERNAGENTS_WEB_SEARCH_PROVIDER": "jina",
                "INTERNAGENTS_WEB_SEARCH_JINA_API_KEY": "jina_test",
            },
            clear=False,
        ):
            settings = web_search_settings({})

        self.assertEqual(settings.provider, "jina")
        self.assertEqual(settings.jina_api_key, "jina_test")

    def test_jina_reader_fetches_and_formats_content(self) -> None:
        with patch.object(web_search_tools, "_fetch_url", return_value=JINA_READER_JSON) as fetch:
            result = jina_fetch_url(
                "https://example.com/article",
                timeout_seconds=3,
                api_key="jina_test",
                max_chars=40,
            )

        self.assertEqual(fetch.call_args.args[1], 30)
        self.assertIn("Authorization", fetch.call_args.kwargs["headers"])
        self.assertIn("Fetched web page: Example Page", result)
        self.assertIn("URL: https://example.com/article", result)
        self.assertIn("# Example Page", result)
        self.assertIn("Content truncated to 40 characters", result)

    def test_fetch_web_url_rejects_unsafe_urls(self) -> None:
        self.assertFalse(validate_fetch_web_url("file:///etc/passwd")[0])
        self.assertFalse(validate_fetch_web_url("http://localhost:3000")[0])
        self.assertFalse(validate_fetch_web_url("http://127.0.0.1:3000")[0])
        self.assertFalse(validate_fetch_web_url("https://user:pass@example.com")[0])

    def test_fetch_web_url_tool_uses_jina_reader(self) -> None:
        with patch.object(web_search_tools, "_fetch_url", return_value=JINA_READER_JSON):
            with patch.dict(
                os.environ,
                {"INTERNAGENTS_WEB_SEARCH_JINA_API_KEY": "jina_test"},
                clear=False,
            ):
                tools = build_web_search_tools({"web_search": {"provider": "jina"}})
                fetch_tool = next(tool for tool in tools if tool.name == "fetch_web_url")
                result = fetch_tool.invoke({"url": "https://example.com/article"})

        self.assertIn("Fetched web page: Example Page", result)
        self.assertIn("This is readable page content", result)

    def test_fetch_web_url_tool_rejects_localhost(self) -> None:
        tools = build_web_search_tools({})
        fetch_tool = next(tool for tool in tools if tool.name == "fetch_web_url")
        result = fetch_tool.invoke({"url": "http://localhost:3000"})

        self.assertIn("cannot access localhost", result)

    def test_disabled_config_returns_no_tool(self) -> None:
        self.assertEqual(
            build_web_search_tools({"web_search": {"enabled": False}}),
            [],
        )
        self.assertEqual(
            web_search_reference_prompt({"web_search": {"enabled": False}}),
            "",
        )

    def test_web_search_tool_returns_formatted_results(self) -> None:
        with patch.object(web_search_tools, "_fetch_url", return_value=DUCKDUCKGO_HTML):
            search_tool = build_web_search_tools(
                {"web_search": {"provider": "duckduckgo", "max_results": 1}}
            )[0]
            result = search_tool.invoke({"query": "internagents"})

        self.assertIn("Found 1 web search result", result)
        self.assertIn("include the relevant source URL", result)
        self.assertIn("Do not list source names without URLs", result)
        self.assertIn("Example & Result", result)
        self.assertIn("URL [1]: https://example.com/a", result)
        self.assertIn("Citation [1]: [Example & Result](https://example.com/a)", result)
        self.assertIn("stop searching and answer with citations", result)
        self.assertIn("Do not call read_file", result)
        self.assertNotIn("Second Result", result)

    def test_web_search_tool_caps_requested_results_to_configured_default(
        self,
    ) -> None:
        with patch.object(web_search_tools, "_fetch_url", return_value=BING_HTML):
            search_tool = build_web_search_tools(
                {"web_search": {"provider": "bing", "max_results": 1}}
            )[0]
            result = search_tool.invoke({"query": "internagents", "max_results": 10})

        self.assertIn("Found 1 web search result", result)
        self.assertIn("Bing & Result", result)
        self.assertNotIn("Second Bing Result", result)

    def test_web_search_tool_falls_back_to_bing_when_duckduckgo_has_no_results(
        self,
    ) -> None:
        with patch.object(
            web_search_tools,
            "_fetch_url",
            side_effect=["<html></html>", BING_HTML],
        ):
            search_tool = build_web_search_tools(
                {"web_search": {"provider": "duckduckgo", "max_results": 1}}
            )[0]
            result = search_tool.invoke({"query": "internagents"})

        self.assertIn("Found 1 web search result", result)
        self.assertIn("Bing & Result", result)
        self.assertIn("URL [1]: https://example.com/bing-a", result)

    def test_web_search_tool_falls_back_to_bing_when_duckduckgo_fails(
        self,
    ) -> None:
        with patch.object(
            web_search_tools,
            "_fetch_url",
            side_effect=[OSError("ddg blocked"), BING_HTML],
        ):
            search_tool = build_web_search_tools(
                {"web_search": {"provider": "duckduckgo", "max_results": 1}}
            )[0]
            result = search_tool.invoke({"query": "internagents"})

        self.assertIn("Found 1 web search result", result)
        self.assertIn("Bing & Result", result)

    def test_web_search_tool_uses_jina_provider(self) -> None:
        with patch.object(web_search_tools, "_fetch_url", return_value=JINA_JSON):
            with patch.dict(
                os.environ,
                {"INTERNAGENTS_WEB_SEARCH_JINA_API_KEY": "jina_test"},
                clear=False,
            ):
                search_tool = build_web_search_tools(
                    {
                        "web_search": {
                            "provider": "jina",
                            "max_results": 1,
                        }
                    }
                )[0]
                result = search_tool.invoke({"query": "internagents"})

        self.assertIn("Found 1 web search result", result)
        self.assertIn("Jina Result", result)
        self.assertIn("URL [1]: https://example.com/jina-a", result)

    def test_web_search_tool_reports_missing_jina_key(self) -> None:
        with patch.dict(
            os.environ,
            {
                "INTERNAGENTS_WEB_SEARCH_JINA_API_KEY": "",
                "JINA_API_KEY": "",
                "JINA_AUTH_TOKEN": "",
            },
            clear=False,
        ):
            search_tool = build_web_search_tools({"web_search": {"provider": "jina"}})[0]
            result = search_tool.invoke({"query": "internagents"})

        self.assertIn("Jina web search requires", result)

    def test_web_search_budget_middleware_blocks_repeated_searches(self) -> None:
        request = ToolCallRequest(
            tool_call={
                "name": "web_search",
                "args": {"query": "internagents"},
                "id": "tool-call-1",
                "type": "tool_call",
            },
            tool=SimpleNamespace(name="web_search"),
            state={
                "messages": [
                    ToolMessage(
                        content="Found results",
                        tool_call_id="previous-call",
                        name="web_search",
                    )
                ]
            },
            runtime=SimpleNamespace(),
        )
        called = False

        def handler(next_request: ToolCallRequest) -> ToolMessage:
            nonlocal called
            called = True
            return ToolMessage(content="called", tool_call_id=next_request.tool_call["id"])

        result = WebSearchBudgetMiddleware(max_calls=1).wrap_tool_call(request, handler)

        self.assertFalse(called)
        self.assertIn("web_search call budget reached", result.content)
        self.assertEqual(result.tool_call_id, "tool-call-1")

    def test_web_search_budget_middleware_blocks_parallel_search_batch(self) -> None:
        request = ToolCallRequest(
            tool_call={
                "name": "web_search",
                "args": {"query": "internagents second"},
                "id": "tool-call-2",
                "type": "tool_call",
            },
            tool=SimpleNamespace(name="web_search"),
            state={
                "messages": [
                    {
                        "type": "ai",
                        "tool_calls": [
                            {
                                "name": "web_search",
                                "args": {"query": "internagents first"},
                                "id": "tool-call-1",
                                "type": "tool_call",
                            },
                            {
                                "name": "web_search",
                                "args": {"query": "internagents second"},
                                "id": "tool-call-2",
                                "type": "tool_call",
                            },
                        ],
                    }
                ]
            },
            runtime=SimpleNamespace(),
        )
        called = False

        def handler(next_request: ToolCallRequest) -> ToolMessage:
            nonlocal called
            called = True
            return ToolMessage(content="called", tool_call_id=next_request.tool_call["id"])

        result = WebSearchBudgetMiddleware(max_calls=1).wrap_tool_call(request, handler)

        self.assertFalse(called)
        self.assertIn("web_search call budget reached", result.content)
        self.assertEqual(result.tool_call_id, "tool-call-2")

    def test_web_search_budget_middleware_trims_parallel_model_search_calls(self) -> None:
        request = SimpleNamespace(state={"messages": []})
        response = ModelResponse(
            result=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "web_search",
                            "args": {"query": "internagents first"},
                            "id": "tool-call-1",
                            "type": "tool_call",
                        },
                        {
                            "name": "web_search",
                            "args": {"query": "internagents second"},
                            "id": "tool-call-2",
                            "type": "tool_call",
                        },
                    ],
                )
            ]
        )

        def handler(_request: ToolCallRequest) -> ModelResponse:
            return response

        result = WebSearchBudgetMiddleware(max_calls=1).wrap_model_call(
            request, handler
        )

        self.assertEqual(len(result.result[0].tool_calls), 1)
        self.assertEqual(result.result[0].tool_calls[0]["id"], "tool-call-1")

    def test_web_search_budget_middleware_retries_without_search_after_budget(self) -> None:
        request = ModelRequest(
            model=SimpleNamespace(),
            messages=[
                ToolMessage(
                    content="Found results",
                    tool_call_id="previous-call",
                    name="web_search",
                )
            ],
            tools=[
                SimpleNamespace(name="web_search"),
                SimpleNamespace(name="read_file"),
            ],
            state={"messages": []},
            runtime=SimpleNamespace(),
        )
        responses = [
            ModelResponse(
                result=[
                    AIMessage(
                        content="",
                        tool_calls=[
                            {
                                "name": "web_search",
                                "args": {"query": "internagents follow-up"},
                                "id": "tool-call-2",
                                "type": "tool_call",
                            }
                        ],
                    )
                ]
            ),
            ModelResponse(result=[AIMessage(content="final answer")]),
        ]
        seen_requests = []

        def handler(next_request: ModelRequest) -> ModelResponse:
            seen_requests.append(next_request)
            return responses.pop(0)

        result = WebSearchBudgetMiddleware(max_calls=1).wrap_model_call(
            request, handler
        )

        self.assertEqual(result.result[0].content, "final answer")
        self.assertEqual(len(seen_requests), 2)
        self.assertEqual(
            [tool.name for tool in seen_requests[1].tools],
            ["read_file"],
        )
        self.assertIn("Do not call web_search again", seen_requests[1].system_prompt)

    def test_unsupported_provider_returns_config_error(self) -> None:
        search_tool = build_web_search_tools(
            {"web_search": {"provider": "brave"}}
        )[0]

        result = search_tool.invoke({"query": "internagents"})

        self.assertIn("unsupported_web_search_provider", result)
        self.assertIn("brave", result)


if __name__ == "__main__":
    unittest.main()
