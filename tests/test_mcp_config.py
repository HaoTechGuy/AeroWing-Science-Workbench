import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from mcp_config import load_mcp_config
from mcp_tools import _filter_tools, load_configured_mcp_tools


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
                                "url": "https://scp.intern-ai.org.cn/api/v1/mcp/28/InternAgent",
                                "headers": {
                                    "SCP-HUB-API-KEY": "${SCP_HUB_API_KEY}",
                                },
                                "allowedTools": ["ChemicalStructureAnalyzer"],
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )

            with patch.dict(os.environ, {"SCP_HUB_API_KEY": "sk-test"}, clear=False):
                config = load_mcp_config({}, root_dir=root, home_dir=root / "home")

            server = config.servers["InternAgent"]
            self.assertEqual(server.transport, "http")
            self.assertEqual(server.headers["SCP-HUB-API-KEY"], "sk-test")
            self.assertEqual(server.allowed_tools, ("ChemicalStructureAnalyzer",))
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
                            "scp": {
                                "type": "http",
                                "url": "https://example.com/mcp",
                                "allowedTools": ["scp_Chemical*", "FlowSearch"],
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )
            config = load_mcp_config({}, root_dir=root, home_dir=root / "home")
            server = config.servers["scp"]

        filtered = _filter_tools(
            [
                SimpleNamespace(name="ChemicalStructureAnalyzer"),
                SimpleNamespace(name="FlowSearch"),
                SimpleNamespace(name="ProteinPropertyCalculator"),
            ],
            server,
        )

        self.assertEqual(
            [tool.name for tool in filtered],
            ["ChemicalStructureAnalyzer", "FlowSearch"],
        )

    def test_no_config_does_not_require_mcp_dependency(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tools = load_configured_mcp_tools({}, root_dir=Path(tmp))

        self.assertEqual(tools, [])
