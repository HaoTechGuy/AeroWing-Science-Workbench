import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from internagents.mcp_config import load_mcp_config
from internagents.mcp_tools import _filter_tools, load_configured_mcp_tools


class McpConfigTest(unittest.TestCase):
    def test_loads_http_server_with_header_env_and_tool_filter(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".mcp.json").write_text(
                json.dumps(
                    {
                        "mcpServers": {
                            "InternAgent": {
                                "type": "streamableHttp",
                                "url": "https://example.com/api/mcp/InternAgent",
                                "headers": {
                                    "X-API-KEY": "${MCP_API_KEY}",
                                },
                                "allowedTools": ["DocumentAnalyzer"],
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )

            with patch.dict(os.environ, {"MCP_API_KEY": "sk-test"}, clear=False):
                config = load_mcp_config({}, root_dir=root, home_dir=root / "home")

            server = config.servers["InternAgent"]
            self.assertEqual(server.transport, "http")
            self.assertEqual(server.headers["X-API-KEY"], "sk-test")
            self.assertEqual(server.allowed_tools, ("DocumentAnalyzer",))
            self.assertEqual(config.errors, ())

    def test_bad_server_does_not_block_valid_server_in_same_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".mcp.json").write_text(
                json.dumps(
                    {
                        "mcpServers": {
                            "valid": {
                                "type": "http",
                                "url": "https://example.com/mcp",
                            },
                            "../bad": {
                                "type": "http",
                                "url": "https://example.com/mcp",
                            },
                        }
                    }
                ),
                encoding="utf-8",
            )

            config = load_mcp_config({}, root_dir=root, home_dir=root / "home")

            self.assertIn("valid", config.servers)
            self.assertNotIn("../bad", config.servers)
            self.assertEqual(len(config.errors), 1)

    def test_project_config_overrides_user_config(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "project"
            home = Path(tmp) / "home"
            (home / ".deepagents").mkdir(parents=True)
            root.mkdir()
            (home / ".deepagents" / ".mcp.json").write_text(
                json.dumps(
                    {
                        "mcpServers": {
                            "docs": {"type": "http", "url": "https://old.example/mcp"}
                        }
                    }
                ),
                encoding="utf-8",
            )
            (root / ".mcp.json").write_text(
                json.dumps(
                    {
                        "mcpServers": {
                            "docs": {"type": "http", "url": "https://new.example/mcp"}
                        }
                    }
                ),
                encoding="utf-8",
            )

            config = load_mcp_config({}, root_dir=root, home_dir=home)

            self.assertEqual(config.servers["docs"].url, "https://new.example/mcp")

    def test_deepagent_config_can_disable_mcp(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".mcp.json").write_text(
                json.dumps({"mcpServers": {"docs": {"type": "http", "url": "https://x/mcp"}}}),
                encoding="utf-8",
            )

            config = load_mcp_config({"mcp": {"enabled": False}}, root_dir=root)

            self.assertEqual(config.servers, {})


class McpToolsTest(unittest.TestCase):
    def test_filter_tools_matches_bare_and_server_prefixed_names(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".mcp.json").write_text(
                json.dumps(
                    {
                        "mcpServers": {
                            "docs": {
                                "type": "http",
                                "url": "https://example.com/mcp",
                                "allowedTools": ["docs_Document*", "FlowSearch"],
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )
            config = load_mcp_config({}, root_dir=root, home_dir=root / "home")
            server = config.servers["docs"]

        filtered = _filter_tools(
            [
                SimpleNamespace(name="DocumentAnalyzer"),
                SimpleNamespace(name="FlowSearch"),
                SimpleNamespace(name="SpreadsheetReader"),
            ],
            server,
        )

        self.assertEqual(
            [tool.name for tool in filtered],
            ["DocumentAnalyzer", "FlowSearch"],
        )

    def test_no_config_does_not_require_mcp_dependency(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tools = load_configured_mcp_tools({}, root_dir=Path(tmp))

        self.assertEqual(tools, [])
