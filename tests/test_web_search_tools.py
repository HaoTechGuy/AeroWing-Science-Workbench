import os
import unittest
from unittest.mock import patch

import web_search_tools
from web_search_tools import (
    WebSearchSettings,
    duckduckgo_search,
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
            ),
        )

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
        self.assertNotIn("Second Result", result)

    def test_unsupported_provider_returns_config_error(self) -> None:
        search_tool = build_web_search_tools(
            {"web_search": {"provider": "brave"}}
        )[0]

        result = search_tool.invoke({"query": "internagents"})

        self.assertIn("unsupported_web_search_provider", result)
        self.assertIn("brave", result)


if __name__ == "__main__":
    unittest.main()
