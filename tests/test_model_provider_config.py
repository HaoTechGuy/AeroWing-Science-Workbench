import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import agent
from langchain_core.language_models.fake_chat_models import FakeListChatModel


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

    def test_legacy_gateway_provider_resolves_to_openai_compatible_model(self) -> None:
        config_path = self._config_path(
            {
                "model_provider": "gateway",
                "model_selection_mode": "manual",
                "manual_model": "qwen3.5-397b-a17b",
            }
        )

        with patch.dict(os.environ, {"DEEPAGENT_CONFIG": config_path}, clear=True):
            self.assertEqual(agent._effective_model_provider(), "openai_compatible")
            self.assertEqual(
                agent._resolve_model(),
                "openai:qwen3.5-397b-a17b",
            )

    def test_missing_openai_credentials_use_placeholder_model(self) -> None:
        original_model = agent.MODEL
        try:
            agent.MODEL = "openai:deepseek-v4-flash"
            with patch.dict(os.environ, {}, clear=True):
                self.assertTrue(agent._model_credentials_missing(agent.MODEL))
                self.assertIsInstance(
                    agent._create_agent_model(),
                    FakeListChatModel,
                )
        finally:
            agent.MODEL = original_model

    def test_openai_compatible_model_uses_chat_completions_api(self) -> None:
        original_model = agent.MODEL
        try:
            agent.MODEL = "openai:deepseek-v4-pro"
            with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}, clear=True):
                model = agent._create_agent_model()
                self.assertFalse(getattr(model, "use_responses_api", True))
        finally:
            agent.MODEL = original_model


if __name__ == "__main__":
    unittest.main()
