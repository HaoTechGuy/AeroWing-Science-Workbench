import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from langchain.agents.middleware.types import ModelRequest, ModelResponse, ToolCallRequest
from langchain_core.messages import AIMessage, ToolMessage

from internagents import web_search_tools
from internagents.web_search_tools import (
    WebSearchSettings,
    WebSearchBudgetMiddleware,
    academic_search,
    arxiv_search,
    bing_search,
    duckduckgo_search,
    jina_fetch_url,
    openalex_search,
    pubmed_search,
    semantic_scholar_search,
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

ARXIV_ATOM = """
<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>https://arxiv.org/abs/2501.00001v1</id>
    <title>Arxiv Paper Title</title>
    <summary>Arxiv abstract text.</summary>
    <published>2025-01-01T00:00:00Z</published>
    <author><name>Alice Author</name></author>
    <arxiv:doi>10.1234/arxiv-test</arxiv:doi>
  </entry>
</feed>
"""

SEMANTIC_SCHOLAR_JSON = """
{
  "data": [
    {
      "title": "Semantic Scholar Paper",
      "url": "https://www.semanticscholar.org/paper/example",
      "abstract": "Semantic Scholar abstract.",
      "year": 2024,
      "venue": "ACL",
      "authors": [{"name": "Sam Scholar"}],
      "externalIds": {"DOI": "10.1000/test"}
    }
  ]
}
"""

PUBMED_ESEARCH_JSON = """
{
  "esearchresult": {
    "idlist": ["123456"]
  }
}
"""

PUBMED_ESUMMARY_JSON = """
{
  "result": {
    "uids": ["123456"],
    "123456": {
      "title": "PubMed Paper Title",
      "fulljournalname": "Journal of Tests",
      "pubdate": "2024",
      "authors": [{"name": "Pat Pubmed"}],
      "articleids": [{"idtype": "doi", "value": "10.2000/pubmed-test"}]
    }
  }
}
"""

OPENALEX_JSON = """
{
  "results": [
    {
      "display_name": "OpenAlex Paper Title",
      "doi": "https://doi.org/10.3000/openalex-test",
      "publication_year": 2023,
      "authorships": [{"author": {"display_name": "Olivia Open"}}],
      "primary_location": {"source": {"display_name": "Open Journal"}},
      "abstract_inverted_index": {
        "OpenAlex": [0],
        "abstract": [1],
        "text.": [2]
      }
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

    def test_arxiv_results_are_parsed(self) -> None:
        with patch.object(web_search_tools, "_fetch_url", return_value=ARXIV_ATOM):
            results = arxiv_search(
                "multi agent",
                max_results=2,
                timeout_seconds=3,
            )

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].title, "[arXiv] Arxiv Paper Title")
        self.assertEqual(results[0].url, "https://arxiv.org/abs/2501.00001v1")
        self.assertIn("Arxiv abstract text", results[0].snippet)

    def test_semantic_scholar_results_are_parsed(self) -> None:
        with patch.object(
            web_search_tools, "_fetch_url", return_value=SEMANTIC_SCHOLAR_JSON
        ):
            results = semantic_scholar_search(
                "multi agent",
                max_results=2,
                timeout_seconds=3,
            )

        self.assertEqual(len(results), 1)
        self.assertEqual(
            results[0].title, "[Semantic Scholar] Semantic Scholar Paper"
        )
        self.assertEqual(
            results[0].url, "https://www.semanticscholar.org/paper/example"
        )
        self.assertIn("Semantic Scholar abstract", results[0].snippet)

    def test_pubmed_results_are_parsed(self) -> None:
        with patch.object(
            web_search_tools,
            "_fetch_url",
            side_effect=[PUBMED_ESEARCH_JSON, PUBMED_ESUMMARY_JSON],
        ):
            results = pubmed_search(
                "multi agent",
                max_results=2,
                timeout_seconds=3,
            )

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].title, "[PubMed] PubMed Paper Title")
        self.assertEqual(results[0].url, "https://pubmed.ncbi.nlm.nih.gov/123456/")
        self.assertIn("Journal of Tests", results[0].snippet)

    def test_openalex_results_are_parsed(self) -> None:
        with patch.object(web_search_tools, "_fetch_url", return_value=OPENALEX_JSON):
            results = openalex_search(
                "multi agent",
                max_results=2,
                timeout_seconds=3,
            )

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].title, "[OpenAlex] OpenAlex Paper Title")
        self.assertEqual(results[0].url, "https://doi.org/10.3000/openalex-test")
        self.assertIn("OpenAlex abstract text", results[0].snippet)

    def test_academic_results_are_aggregated(self) -> None:
        with patch.object(
            web_search_tools,
            "_fetch_url",
            side_effect=[
                SEMANTIC_SCHOLAR_JSON,
                OPENALEX_JSON,
                ARXIV_ATOM,
                PUBMED_ESEARCH_JSON,
                PUBMED_ESUMMARY_JSON,
            ],
        ):
            results = academic_search(
                "multi agent",
                max_results=4,
                timeout_seconds=3,
            )

        self.assertEqual(len(results), 4)
        self.assertEqual(
            [result.title.split("]", 1)[0] + "]" for result in results],
            ["[Semantic Scholar]", "[OpenAlex]", "[arXiv]", "[PubMed]"],
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
                provider="duckduckgo",
                max_results=10,
                timeout_seconds=7,
                max_fetch_chars=12000,
            ),
        )

    def test_jina_reader_fetches_and_formats_content(self) -> None:
        with patch.object(web_search_tools, "_fetch_url", return_value=JINA_READER_JSON) as fetch:
            result = jina_fetch_url(
                "https://example.com/article",
                timeout_seconds=3,
                max_chars=40,
            )

        self.assertEqual(fetch.call_args.args[1], 30)
        self.assertNotIn("Authorization", fetch.call_args.kwargs["headers"])
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
            tools = build_web_search_tools({})
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

    def test_web_search_tool_falls_back_to_academic_when_general_sources_empty(
        self,
    ) -> None:
        academic_results = [
            web_search_tools.WebSearchResult(
                title="[arXiv] Academic fallback",
                url="https://arxiv.org/abs/2501.00001",
                snippet="Academic fallback snippet.",
            )
        ]
        with (
            patch.object(web_search_tools, "duckduckgo_search", return_value=[]),
            patch.object(web_search_tools, "bing_search", return_value=[]),
            patch.object(
                web_search_tools,
                "academic_search",
                return_value=academic_results,
            ),
        ):
            search_tool = build_web_search_tools(
                {"web_search": {"provider": "duckduckgo", "max_results": 1}}
            )[0]
            result = search_tool.invoke({"query": "multi agent"})

        self.assertIn("Found 1 web search result", result)
        self.assertIn("[arXiv] Academic fallback", result)
        self.assertIn("URL [1]: https://arxiv.org/abs/2501.00001", result)

    def test_web_search_tool_falls_back_to_academic_when_general_sources_fail(
        self,
    ) -> None:
        academic_results = [
            web_search_tools.WebSearchResult(
                title="[Semantic Scholar] Academic fallback",
                url="https://www.semanticscholar.org/paper/example",
                snippet="Academic fallback snippet.",
            )
        ]
        with (
            patch.object(
                web_search_tools,
                "duckduckgo_search",
                side_effect=OSError("ddg blocked"),
            ),
            patch.object(
                web_search_tools,
                "bing_search",
                side_effect=OSError("bing blocked"),
            ),
            patch.object(
                web_search_tools,
                "academic_search",
                return_value=academic_results,
            ),
        ):
            search_tool = build_web_search_tools(
                {"web_search": {"provider": "duckduckgo", "max_results": 1}}
            )[0]
            result = search_tool.invoke({"query": "multi agent"})

        self.assertIn("Found 1 web search result", result)
        self.assertIn("[Semantic Scholar] Academic fallback", result)
        self.assertIn(
            "URL [1]: https://www.semanticscholar.org/paper/example",
            result,
        )

    def test_web_search_tool_uses_arxiv_provider(self) -> None:
        with patch.object(web_search_tools, "_fetch_url", return_value=ARXIV_ATOM):
            search_tool = build_web_search_tools(
                {"web_search": {"provider": "arxiv", "max_results": 1}}
            )[0]
            result = search_tool.invoke({"query": "multi agent"})

        self.assertIn("Found 1 web search result", result)
        self.assertIn("[arXiv] Arxiv Paper Title", result)
        self.assertIn("URL [1]: https://arxiv.org/abs/2501.00001v1", result)

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

    def test_jina_search_provider_is_not_supported(self) -> None:
        search_tool = build_web_search_tools(
            {"web_search": {"provider": "jina"}}
        )[0]

        result = search_tool.invoke({"query": "internagents"})

        self.assertIn("unsupported_web_search_provider", result)
        self.assertIn("jina", result)


if __name__ == "__main__":
    unittest.main()
