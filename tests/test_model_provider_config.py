import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import agent


class ModelProviderConfigTests(unittest.TestCase):
    def _config_path(self, payload: dict[str, object]) -> str:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        config_path = Path(temp_dir.name) / "deepagent.config.json"
        config_path.write_text(json.dumps(payload), encoding="utf-8")
        return str(config_path)

    def test_legacy_openrouter_provider_resolves_to_openai_compatible_model(self) -> None:
        config_path = self._config_path(
            {
                "model_provider": "openrouter",
                "openrouter_model": "deepseek/deepseek-v4-pro",
            }
        )

        with patch.dict(os.environ, {"DEEPAGENT_CONFIG": config_path}, clear=True):
            self.assertEqual(agent._effective_model_provider(), "openai_compatible")
            self.assertEqual(
                agent._resolve_model(),
                "openai:deepseek/deepseek-v4-pro",
            )

    def test_openai_compatible_provider_sets_standard_openai_environment(self) -> None:
        config_path = self._config_path(
            {
                "model_provider": "openai_compatible",
                "openai_compatible_base_url": "https://models.example.test/v1",
                "openai_compatible_model": "provider/model-a",
            }
        )

        with patch.dict(
            os.environ,
            {
                "DEEPAGENT_CONFIG": config_path,
                "OPENROUTER_API_KEY": "legacy-openrouter-key",
            },
            clear=True,
        ):
            agent._lock_openai_compatible_environment()

            self.assertEqual(
                os.environ["OPENAI_BASE_URL"],
                "https://models.example.test/v1",
            )
            self.assertEqual(
                os.environ["OPENAI_API_KEY"],
                "legacy-openrouter-key",
            )
            self.assertEqual(agent._resolve_model(), "openai:provider/model-a")

    def test_gateway_provider_still_uses_gateway_model_spec(self) -> None:
        config_path = self._config_path(
            {
                "model_provider": "gateway",
                "model_selection_mode": "manual",
                "manual_model": "qwen3.5-397b-a17b",
            }
        )

        with patch.dict(os.environ, {"DEEPAGENT_CONFIG": config_path}, clear=True):
            self.assertEqual(agent._effective_model_provider(), "gateway")
            self.assertEqual(
                agent._resolve_model(),
                "openrouter:qwen3.5-397b-a17b",
            )


if __name__ == "__main__":
    unittest.main()
