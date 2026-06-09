"""Web search tools for InternAgents."""

from __future__ import annotations

import html
import json
import os
import urllib.parse
import urllib.request
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any

from langchain.tools import tool


DEFAULT_PROVIDER = "duckduckgo"
DEFAULT_MAX_RESULTS = 5
DEFAULT_TIMEOUT_SECONDS = 10
MAX_RESULTS_LIMIT = 10
DUCKDUCKGO_HTML_URL = "https://duckduckgo.com/html/"


@dataclass(frozen=True)
class WebSearchSettings:
    enabled: bool
    provider: str
    max_results: int
    timeout_seconds: int


@dataclass(frozen=True)
class WebSearchResult:
    title: str
    url: str
    snippet: str


class DuckDuckGoHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.results: list[WebSearchResult] = []
        self._current_title: list[str] = []
        self._current_snippet: list[str] = []
        self._current_url = ""
        self._capture_title = False
        self._capture_snippet = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {key: value or "" for key, value in attrs}
        classes = set(attr_map.get("class", "").split())
        if tag == "a" and "result__a" in classes:
            self._flush_result()
            self._current_url = _normalize_duckduckgo_url(attr_map.get("href", ""))
            self._current_title = []
            self._current_snippet = []
            self._capture_title = True
            return
        if "result__snippet" in classes:
            self._capture_snippet = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._capture_title:
            self._capture_title = False
        if tag in {"a", "div"} and self._capture_snippet:
            self._capture_snippet = False

    def handle_data(self, data: str) -> None:
        if self._capture_title:
            self._current_title.append(data)
        elif self._capture_snippet:
            self._current_snippet.append(data)

    def close(self) -> None:
        super().close()
        self._flush_result()

    def _flush_result(self) -> None:
        title = _clean_text(" ".join(self._current_title))
        if not title or not self._current_url:
            return
        self.results.append(
            WebSearchResult(
                title=title,
                url=self._current_url,
                snippet=_clean_text(" ".join(self._current_snippet)),
            )
        )
        self._current_title = []
        self._current_snippet = []
        self._current_url = ""


def _env_value(name: str) -> str | None:
    value = os.getenv(name)
    if value and value.strip():
        return value.strip()
    return None


def _bool_value(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.strip():
        return value.strip().lower() not in {"0", "false", "no", "off"}
    return default


def _positive_int(value: Any, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def web_search_settings(config: dict[str, Any] | None = None) -> WebSearchSettings:
    config = config or {}
    raw_settings = config.get("web_search")
    settings = raw_settings if isinstance(raw_settings, dict) else {}
    enabled = _bool_value(
        _env_value("INTERNAGENTS_WEB_SEARCH_ENABLED")
        or settings.get("enabled"),
        True,
    )
    provider = (
        _env_value("INTERNAGENTS_WEB_SEARCH_PROVIDER")
        or str(settings.get("provider") or DEFAULT_PROVIDER)
    ).strip().lower()
    max_results = min(
        MAX_RESULTS_LIMIT,
        _positive_int(
            _env_value("INTERNAGENTS_WEB_SEARCH_MAX_RESULTS")
            or settings.get("max_results"),
            DEFAULT_MAX_RESULTS,
        ),
    )
    timeout_seconds = _positive_int(
        _env_value("INTERNAGENTS_WEB_SEARCH_TIMEOUT_SECONDS")
        or settings.get("timeout_seconds"),
        DEFAULT_TIMEOUT_SECONDS,
    )
    return WebSearchSettings(
        enabled=enabled,
        provider=provider or DEFAULT_PROVIDER,
        max_results=max_results,
        timeout_seconds=timeout_seconds,
    )


def _clean_text(value: str) -> str:
    return " ".join(html.unescape(value).split())


def _normalize_duckduckgo_url(value: str) -> str:
    if not value:
        return ""
    parsed = urllib.parse.urlparse(html.unescape(value))
    query = urllib.parse.parse_qs(parsed.query)
    redirect = query.get("uddg", [""])[0]
    if redirect:
        return urllib.parse.unquote(redirect)
    if parsed.scheme in {"http", "https"}:
        return urllib.parse.urlunparse(parsed)
    return value


def _fetch_url(url: str, timeout_seconds: int) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0 Safari/537.36"
            )
        },
    )
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def duckduckgo_search(
    query: str,
    *,
    max_results: int,
    timeout_seconds: int,
) -> list[WebSearchResult]:
    params = urllib.parse.urlencode({"q": query})
    parser = DuckDuckGoHtmlParser()
    parser.feed(_fetch_url(f"{DUCKDUCKGO_HTML_URL}?{params}", timeout_seconds))
    parser.close()
    return parser.results[:max_results]


def format_search_results(query: str, results: list[WebSearchResult]) -> str:
    if not results:
        return f"No web search results found for: {query}"
    lines = [f"Found {len(results)} web search result(s) for: {query}"]
    for index, result in enumerate(results, start=1):
        lines.extend(
            [
                "",
                f"{index}. {result.title}",
                f"URL: {result.url}",
            ]
        )
        if result.snippet:
            lines.append(f"Snippet: {result.snippet}")
    return "\n".join(lines)


def web_search_tools(config: dict[str, Any] | None = None) -> list[Any]:
    settings = web_search_settings(config)
    if not settings.enabled:
        return []

    @tool("web_search")
    def web_search(query: str, max_results: int = settings.max_results) -> str:
        """Search the web for current information and return titles, URLs, and snippets.

        Args:
            query: Search query to execute.
            max_results: Maximum number of results to return. The configured default is used when omitted.
        """

        normalized_query = query.strip()
        if not normalized_query:
            return "Web search query must not be empty."
        requested_results = min(
            MAX_RESULTS_LIMIT,
            max(1, _positive_int(max_results, settings.max_results)),
        )
        if settings.provider in {"duckduckgo", "ddg"}:
            try:
                results = duckduckgo_search(
                    normalized_query,
                    max_results=requested_results,
                    timeout_seconds=settings.timeout_seconds,
                )
            except Exception as exc:
                return f"Web search failed with DuckDuckGo: {exc}"
            return format_search_results(normalized_query, results)

        return json.dumps(
            {
                "error": "unsupported_web_search_provider",
                "provider": settings.provider,
                "supported_providers": ["duckduckgo"],
            },
            ensure_ascii=False,
        )

    return [web_search]
