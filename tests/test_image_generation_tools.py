import os
import sys
import types
import unittest
from types import SimpleNamespace
from unittest.mock import patch

_installed_langchain_test_shim = False
try:
    import langchain.tools  # noqa: F401
except ModuleNotFoundError:
    _installed_langchain_test_shim = True
    langchain_module = types.ModuleType("langchain")
    tools_module = types.ModuleType("langchain.tools")

    class ToolRuntime:  # noqa: D101
        pass

    def tool(name):
        def decorator(function):
            function.name = name
            return function

        return decorator

    tools_module.ToolRuntime = ToolRuntime
    tools_module.tool = tool
    langchain_module.tools = tools_module
    sys.modules["langchain"] = langchain_module
    sys.modules["langchain.tools"] = tools_module

import image_generation_tools
from image_generation_tools import (
    DEFAULT_OUTPUT_DIR,
    ImageGenerationSettings,
    CUSTOM_PROVIDER,
    generate_images,
    image_generation_settings,
    image_generation_reference_prompt,
    image_generation_tools as build_image_generation_tools,
)

if _installed_langchain_test_shim:
    sys.modules.pop("langchain.tools", None)
    sys.modules.pop("langchain", None)


class FakeBackend:
    def __init__(self) -> None:
        self.uploaded: list[tuple[str, bytes]] = []

    def upload_files(self, files: list[tuple[str, bytes]]):
        self.uploaded.extend(files)
        return [SimpleNamespace(path=path, error=None) for path, _ in files]


class ImageGenerationToolTests(unittest.TestCase):
    def test_generates_downloads_and_uploads_image_url(self) -> None:
        backend = FakeBackend()
        settings = ImageGenerationSettings()

        with (
            patch.dict(
                os.environ,
                {"INTERNAGENTS_GATEWAY_KEY": "gateway-key"},
                clear=True,
            ),
            patch.object(
                image_generation_tools,
                "_request_json",
                return_value={"data": [{"url": "https://example.test/image.png"}]},
            ) as request_json,
            patch.object(
                image_generation_tools,
                "_download_image",
                return_value=(b"fake-png", "image/png"),
            ) as download_image,
        ):
            result = generate_images(
                settings=settings,
                backend=backend,
                prompt="A precise scientific diagram",
                filename_prefix="science diagram",
            )

        self.assertNotIn("error", result)
        self.assertEqual(result["provider"], "internagents_gateway")
        self.assertEqual(result["model"], "cogview-3-flash")
        self.assertEqual(len(result["images"]), 1)
        self.assertEqual(len(backend.uploaded), 1)
        path, content = backend.uploaded[0]
        self.assertTrue(path.startswith(f"{DEFAULT_OUTPUT_DIR}/science-diagram-"))
        self.assertTrue(path.endswith(".png"))
        self.assertEqual(content, b"fake-png")
        request_json.assert_called_once()
        self.assertEqual(
            request_json.call_args.kwargs["url"],
            "http://43.106.18.167/jisi/v1/images/generations",
        )
        self.assertEqual(request_json.call_args.kwargs["api_key"], "gateway-key")
        self.assertEqual(request_json.call_args.kwargs["payload"]["model"], "cogview-3-flash")
        self.assertEqual(request_json.call_args.kwargs["payload"]["size"], "1024x1024")
        download_image.assert_called_once_with(
            "https://example.test/image.png",
            timeout_seconds=60,
        )

    def test_missing_api_key_returns_clear_error(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            result = generate_images(
                settings=ImageGenerationSettings(),
                backend=FakeBackend(),
                prompt="A molecule render",
            )

        self.assertIn("error", result)
        self.assertIn("Missing image generation gateway key", result["error"])

    def test_gateway_provider_does_not_use_openai_key_outside_gateway_mode(self) -> None:
        with patch.dict(os.environ, {"OPENAI_API_KEY": "openai-key"}, clear=True):
            result = generate_images(
                settings=ImageGenerationSettings(),
                backend=FakeBackend(),
                prompt="A molecule render",
            )

        self.assertIn("error", result)
        self.assertIn("Missing image generation gateway key", result["error"])

    def test_gateway_provider_accepts_openai_key_in_gateway_mode(self) -> None:
        backend = FakeBackend()
        with (
            patch.dict(
                os.environ,
                {
                    "INTERNAGENTS_MODEL_PROVIDER": "gateway",
                    "OPENAI_API_KEY": "gateway-openai-key",
                    "OPENAI_BASE_URL": "https://gateway.example.test/v1",
                },
                clear=True,
            ),
            patch.object(
                image_generation_tools,
                "_request_json",
                return_value={"data": [{"url": "https://example.test/image.png"}]},
            ) as request_json,
            patch.object(
                image_generation_tools,
                "_download_image",
                return_value=(b"fake-png", "image/png"),
            ),
        ):
            result = generate_images(
                settings=ImageGenerationSettings(),
                backend=backend,
                prompt="A gateway render",
            )

        self.assertNotIn("error", result)
        self.assertEqual(request_json.call_args.kwargs["api_key"], "gateway-openai-key")
        self.assertEqual(
            request_json.call_args.kwargs["url"],
            "https://gateway.example.test/v1/images/generations",
        )

    def test_custom_provider_uses_custom_key_and_base_url(self) -> None:
        backend = FakeBackend()
        settings = image_generation_settings(
            {
                "image_generation": {
                    "provider": CUSTOM_PROVIDER,
                    "base_url": "https://images.example.test/v1",
                    "model": "custom-image-model",
                }
            }
        )

        with (
            patch.dict(
                os.environ,
                {"INTERNAGENTS_IMAGE_API_KEY": "custom-key"},
                clear=True,
            ),
            patch.object(
                image_generation_tools,
                "_request_json",
                return_value={"data": [{"url": "https://example.test/image.png"}]},
            ) as request_json,
            patch.object(
                image_generation_tools,
                "_download_image",
                return_value=(b"fake-png", "image/png"),
            ),
        ):
            result = generate_images(
                settings=settings,
                backend=backend,
                prompt="A precise scientific diagram",
            )

        self.assertNotIn("error", result)
        self.assertEqual(result["provider"], "custom")
        self.assertEqual(result["model"], "custom-image-model")
        self.assertEqual(
            request_json.call_args.kwargs["url"],
            "https://images.example.test/v1/images/generations",
        )
        self.assertEqual(request_json.call_args.kwargs["api_key"], "custom-key")
        self.assertEqual(
            request_json.call_args.kwargs["payload"]["model"],
            "custom-image-model",
        )

    def test_custom_provider_requires_custom_base_url(self) -> None:
        settings = image_generation_settings(
            {"image_generation": {"provider": CUSTOM_PROVIDER}}
        )

        with patch.dict(
            os.environ,
            {"INTERNAGENTS_IMAGE_API_KEY": "custom-key"},
            clear=True,
        ):
            result = generate_images(
                settings=settings,
                backend=FakeBackend(),
                prompt="A custom render",
            )

        self.assertIn("error", result)
        self.assertIn("Missing custom image generation base URL", result["error"])

    def test_disabled_config_returns_no_tool_and_no_prompt(self) -> None:
        config = {"image_generation": {"enabled": False}}

        self.assertEqual(build_image_generation_tools(config, FakeBackend()), [])
        self.assertEqual(image_generation_reference_prompt(config), "")

    def test_disabled_config_ignores_invalid_stale_values(self) -> None:
        config = {
            "image_generation": {
                "enabled": False,
                "size": "not-a-size",
                "output_dir": "../outside",
            }
        }

        self.assertEqual(build_image_generation_tools(config, FakeBackend()), [])
        self.assertEqual(image_generation_reference_prompt(config), "")

    def test_unsupported_provider_returns_error(self) -> None:
        with patch.dict(os.environ, {"INTERNAGENTS_GATEWAY_KEY": "test-key"}, clear=True):
            result = generate_images(
                settings=ImageGenerationSettings(provider="unknown"),
                backend=FakeBackend(),
                prompt="A lab bench",
            )

        self.assertEqual(
            result,
            {"error": "Unsupported image generation provider: unknown"},
        )

    def test_invalid_output_dir_is_rejected(self) -> None:
        result = generate_images(
            settings=ImageGenerationSettings(),
            backend=FakeBackend(),
            prompt="A chart",
            output_dir="../outside",
        )

        self.assertIn("error", result)
        self.assertIn("inside the workspace", result["error"])

    def test_timeout_error_is_readable(self) -> None:
        backend = FakeBackend()
        with (
            patch.dict(os.environ, {"INTERNAGENTS_GATEWAY_KEY": "test-key"}, clear=True),
            patch.object(
                image_generation_tools,
                "_request_json",
                side_effect=RuntimeError("Image generation request timed out."),
            ),
        ):
            result = generate_images(
                settings=ImageGenerationSettings(),
                backend=backend,
                prompt="A delayed render",
            )

        self.assertEqual(result, {"error": "Image generation request timed out."})
        self.assertEqual(backend.uploaded, [])

    def test_empty_response_is_readable(self) -> None:
        backend = FakeBackend()
        with (
            patch.dict(os.environ, {"INTERNAGENTS_GATEWAY_KEY": "test-key"}, clear=True),
            patch.object(image_generation_tools, "_request_json", return_value={"data": []}),
        ):
            result = generate_images(
                settings=ImageGenerationSettings(),
                backend=backend,
                prompt="A blank provider response",
            )

        self.assertEqual(result, {"error": "Image provider returned no image data."})
        self.assertEqual(backend.uploaded, [])


if __name__ == "__main__":
    unittest.main()
