import tempfile
import unittest
from pathlib import Path

from scp_catalog import get_scp_catalog_item, load_scp_catalog
from scp_state import (
    ScpInvocationValidationError,
    create_scp_invocation_state,
    normalize_scp_invocation,
    update_scp_invocation_status,
)


class ScpCatalogTest(unittest.TestCase):
    def test_loads_catalog_items(self) -> None:
        items = load_scp_catalog()

        self.assertTrue(items)
        chemical = get_scp_catalog_item(
            "chemical-structure-analysis", "ChemicalStructureAnalyzer"
        )
        self.assertIsNotNone(chemical)
        self.assertEqual(chemical.tool_name, "ChemicalStructureAnalyzer")

    def test_invalid_catalog_item_is_ignored(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "scp_catalog.json"
            path.write_text(
                '{"skills":[{"skillName":"bad"},{"skillName":"ok","displayName":"OK",'
                '"description":"desc","endpoint":"https://example.com/mcp",'
                '"transport":"http","toolName":"tool","toolDescription":"tool desc",'
                '"argumentHint":{},"skillInstructions":"Use it."}]}',
                encoding="utf-8",
            )

            items = load_scp_catalog(path)

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].skill_name, "ok")


class ScpInvocationStateTest(unittest.TestCase):
    def test_create_normalize_and_update_invocation(self) -> None:
        invocation = create_scp_invocation_state(
            skill_name="chemical-structure-analysis",
            display_name="Chemical Structure Analysis",
            tool_name="ChemicalStructureAnalyzer",
            endpoint="https://scp.intern-ai.org.cn/api/v1/mcp/28/InternAgent",
            prompt="analyze aspirin",
            thread_id="thread-1",
            now=100,
        )

        normalized = normalize_scp_invocation(invocation)

        self.assertIsNotNone(normalized)
        self.assertEqual(normalized["status"], "active")
        self.assertEqual(normalized["prompt"], "analyze aspirin")

        updated = update_scp_invocation_status(
            normalized,
            "complete",
            summary="done",
            now=120,
        )

        self.assertEqual(updated["status"], "complete")
        self.assertEqual(updated["summary"], "done")
        self.assertEqual(updated["updatedAt"], 120)

    def test_empty_prompt_is_rejected(self) -> None:
        with self.assertRaises(ScpInvocationValidationError):
            create_scp_invocation_state(
                skill_name="skill",
                display_name="Skill",
                tool_name="tool",
                endpoint="https://example.com/mcp",
                prompt="",
            )


if __name__ == "__main__":
    unittest.main()
