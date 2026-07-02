"""Image generation tools for InternAgents."""

from __future__ import annotations

import base64
import json
import mimetypes
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from typing import Any

from langchain.tools import ToolRuntime, tool


GATEWAY_PROVIDER = "internagents_gateway"
CUSTOM_PROVIDER = "custom"
DEFAULT_PROVIDER = GATEWAY_PROVIDER
DEFAULT_MODEL = "cogview-3-flash"
DEFAULT_GATEWAY_BASE_URL = "http://43.106.18.167/jisi/v1"
DEFAULT_BASE_URL = DEFAULT_GATEWAY_BASE_URL
DEFAULT_ENDPOINT = "/images/generations"
DEFAULT_SIZE = "1024x1024"
DEFAULT_OUTPUT_DIR = "/generated-images"
LEGACY_DEFAULT_OUTPUT_DIR = "/.internagents/generated-images"
DEFAULT_TIMEOUT_SECONDS = 60
DEFAULT_MAX_IMAGES_PER_CALL = 1
MAX_IMAGE_BYTES = 25 * 1024 * 1024
SUPPORTED_PROVIDERS = {GATEWAY_PROVIDER, CUSTOM_PROVIDER}
GATEWAY_API_KEY_ENV_NAMES = (
    "INTERNAGENTS_IMAGE_GATEWAY_KEY",
    "INTERNAGENTS_GATEWAY_KEY",
)
CUSTOM_API_KEY_ENV_NAMES = (
    "INTERNAGENTS_IMAGE_API_KEY",
)
GATEWAY_BASE_URL_ENV_NAMES = (
    "INTERNAGENTS_IMAGE_GATEWAY_BASE_URL",
    "INTERNAGENTS_GATEWAY_BASE_URL",
)
CUSTOM_BASE_URL_ENV_NAMES = (
    "INTERNAGENTS_IMAGE_BASE_URL",
    "INTERNAGENTS_IMAGE_API_BASE",
    "INTERNAGENTS_IMAGE_API_BASE_URL",
)

_SIZE_RE = re.compile(r"^(?:auto|[1-9][0-9]{1,4}x[1-9][0-9]{1,4})$")
_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


@dataclass(frozen=True)
class ImageGenerationSettings:
    enabled: bool = True
    provider: str = DEFAULT_PROVIDER
    model: str = DEFAULT_MODEL
    base_url: str = DEFAULT_BASE_URL
    endpoint: str = DEFAULT_ENDPOINT
    size: str = DEFAULT_SIZE
    output_dir: str = DEFAULT_OUTPUT_DIR
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS
    max_images_per_call: int = DEFAULT_MAX_IMAGES_PER_CALL
    user_id: str | None = None
    watermark_enabled: bool | None = None


def _bool_value(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    return default


def _positive_int(value: Any, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _string_value(value: Any, default: str) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return default


def _optional_string(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _optional_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    return None


def _normalize_base_url(value: str) -> str:
    return value.rstrip("/")


def _normalize_provider(value: str) -> str:
    normalized = value.strip().lower().replace("-", "_")
    if normalized in {"gateway", "jisi_gateway", "internagents_gateway"}:
        return GATEWAY_PROVIDER
    if normalized in {"custom", "openai_compatible", "image_api"}:
        return CUSTOM_PROVIDER
    return normalized


def _default_base_url(provider: str) -> str:
    if provider == CUSTOM_PROVIDER:
        return ""
    return DEFAULT_GATEWAY_BASE_URL


def _normalize_endpoint(value: str) -> str:
    normalized = value.strip() or DEFAULT_ENDPOINT
    return normalized if normalized.startswith("/") else f"/{normalized}"


def _normalize_output_dir(value: str) -> str:
    raw = value.strip().replace("\\", "/")
    if not raw:
        raw = DEFAULT_OUTPUT_DIR
    if ":" in raw or raw.startswith("~"):
        raise ValueError("Output directory must be a workspace logical path.")
    if not raw.startswith("/"):
        raw = f"/{raw}"
    parts = [part for part in raw.split("/") if part]
    if any(part in {".", ".."} for part in parts):
        raise ValueError("Output directory must stay inside the workspace.")
    normalized = "/" + "/".join(parts) if parts else "/"
    if normalized == LEGACY_DEFAULT_OUTPUT_DIR:
        return DEFAULT_OUTPUT_DIR
    return normalized


def _normalize_size(value: str) -> str:
    normalized = value.strip()
    if not _SIZE_RE.match(normalized):
        raise ValueError("Image size must be 'auto' or WIDTHxHEIGHT, for example 1024x1024.")
    return normalized


def _safe_filename_prefix(value: str | None) -> str:
    prefix = _SAFE_FILENAME_RE.sub("-", (value or "cogview").strip()).strip(".-")
    return (prefix or "cogview")[:48]


def image_generation_settings(config: dict[str, Any] | None = None) -> ImageGenerationSettings:
    raw = (config or {}).get("image_generation")
    if raw is False:
        return ImageGenerationSettings(enabled=False)
    if not isinstance(raw, dict):
        raw = {}
    enabled = _bool_value(raw.get("enabled"), True)
    if not enabled:
        return ImageGenerationSettings(enabled=False)

    provider = _normalize_provider(_string_value(raw.get("provider"), DEFAULT_PROVIDER))
    output_dir = _normalize_output_dir(
        _string_value(raw.get("output_dir") or raw.get("outputDir"), DEFAULT_OUTPUT_DIR)
    )
    size = _normalize_size(_string_value(raw.get("size"), DEFAULT_SIZE))
    return ImageGenerationSettings(
        enabled=enabled,
        provider=provider,
        model=_string_value(raw.get("model"), DEFAULT_MODEL),
        base_url=_normalize_base_url(
            _string_value(
                raw.get("base_url") or raw.get("baseUrl"),
                _default_base_url(provider),
            )
        ),
        endpoint=_normalize_endpoint(_string_value(raw.get("endpoint"), DEFAULT_ENDPOINT)),
        size=size,
        output_dir=output_dir,
        timeout_seconds=_positive_int(
            raw.get("timeout_seconds") or raw.get("timeoutSeconds"),
            DEFAULT_TIMEOUT_SECONDS,
        ),
        max_images_per_call=_positive_int(
            raw.get("max_images_per_call") or raw.get("maxImagesPerCall"),
            DEFAULT_MAX_IMAGES_PER_CALL,
        ),
        user_id=_optional_string(raw.get("user_id") or raw.get("userId")),
        watermark_enabled=_optional_bool(
            raw.get("watermark_enabled") or raw.get("watermarkEnabled")
        ),
    )


def image_generation_reference_prompt(config: dict[str, Any] | None = None) -> str:
    settings = image_generation_settings(config)
    if not settings.enabled:
        return ""
    return (
        "Image generation is available through the generate_image tool. "
        "When the user asks to create, draw, or generate an image, call "
        "generate_image and include the saved workspace path(s) in your response."
    )


def _env_value(*names: str) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value and value.strip():
            return value.strip()
    return None


def _api_key(settings: ImageGenerationSettings) -> str | None:
    if settings.provider == GATEWAY_PROVIDER:
        gateway_key = _env_value(*GATEWAY_API_KEY_ENV_NAMES)
        if gateway_key:
            return gateway_key
        if _env_value("INTERNAGENTS_MODEL_PROVIDER") == "gateway":
            return _env_value("OPENAI_API_KEY", "OPENROUTER_API_KEY")
        return None
    return _env_value(*CUSTOM_API_KEY_ENV_NAMES)


def _provider_url(settings: ImageGenerationSettings) -> str:
    base_url = settings.base_url
    if settings.provider == GATEWAY_PROVIDER:
        gateway_base_url = _env_value(*GATEWAY_BASE_URL_ENV_NAMES)
        if not gateway_base_url and _env_value("INTERNAGENTS_MODEL_PROVIDER") == "gateway":
            gateway_base_url = _env_value(
                "OPENAI_BASE_URL",
                "OPENAI_API_BASE",
                "OPENROUTER_API_BASE",
                "OPENROUTER_BASE_URL",
            )
        base_url = gateway_base_url or base_url
    elif settings.provider == CUSTOM_PROVIDER:
        base_url = _env_value(*CUSTOM_BASE_URL_ENV_NAMES) or base_url
        if not base_url:
            raise RuntimeError(
                "Missing custom image generation base URL. Set "
                "image_generation.base_url or INTERNAGENTS_IMAGE_BASE_URL."
            )
    return f"{base_url.rstrip('/')}{settings.endpoint}"


def _missing_api_key_error(settings: ImageGenerationSettings) -> str:
    if settings.provider == GATEWAY_PROVIDER:
        return (
            "Missing image generation gateway key. Bind the InternAgents gateway "
            "account or set INTERNAGENTS_GATEWAY_KEY in the backend environment."
        )
    return (
        "Missing custom image generation API key. Set "
        "INTERNAGENTS_IMAGE_API_KEY in the backend environment."
    )


def _request_json(
    *,
    url: str,
    api_key: str,
    payload: dict[str, Any],
    timeout_seconds: int,
) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            raw = response.read(MAX_IMAGE_BYTES + 1)
    except urllib.error.HTTPError as exc:
        error_body = exc.read(4096).decode("utf-8", errors="replace")
        raise RuntimeError(f"Image generation request failed with HTTP {exc.code}: {error_body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Image generation request failed: {exc.reason}") from exc
    except TimeoutError as exc:
        raise RuntimeError("Image generation request timed out.") from exc

    if len(raw) > MAX_IMAGE_BYTES:
        raise RuntimeError("Image generation response is too large.")
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError("Image generation response was not valid JSON.") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError("Image generation response was not a JSON object.")
    return parsed


def _download_image(url: str, *, timeout_seconds: int) -> tuple[bytes, str]:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise RuntimeError("Image provider returned a non-HTTP image URL.")
    request = urllib.request.Request(url, headers={"Accept": "image/*"}, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            content_type = response.headers.get_content_type() or "image/png"
            raw = response.read(MAX_IMAGE_BYTES + 1)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Image download failed with HTTP {exc.code}.") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Image download failed: {exc.reason}") from exc
    except TimeoutError as exc:
        raise RuntimeError("Image download timed out.") from exc
    if len(raw) > MAX_IMAGE_BYTES:
        raise RuntimeError("Generated image is too large to save.")
    return raw, content_type


def _extension_for_mime_type(mime_type: str) -> str:
    extension = mimetypes.guess_extension(mime_type.split(";", 1)[0].strip())
    if extension == ".jpe":
        return ".jpg"
    return extension or ".png"


def _extract_image_payloads(
    response: dict[str, Any],
    *,
    timeout_seconds: int,
) -> list[dict[str, Any]]:
    data = response.get("data")
    if not isinstance(data, list) or not data:
        raise RuntimeError("Image provider returned no image data.")

    images: list[dict[str, Any]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        url = item.get("url")
        b64_json = item.get("b64_json") or item.get("base64")
        if isinstance(url, str) and url.strip():
            raw, mime_type = _download_image(url.strip(), timeout_seconds=timeout_seconds)
            images.append({"bytes": raw, "mime_type": mime_type, "source_url": url.strip()})
            continue
        if isinstance(b64_json, str) and b64_json.strip():
            try:
                raw = base64.b64decode(b64_json, validate=True)
            except ValueError as exc:
                raise RuntimeError("Image provider returned invalid base64 image data.") from exc
            mime_type = _string_value(item.get("mime_type") or item.get("mimeType"), "image/png")
            images.append({"bytes": raw, "mime_type": mime_type, "source_url": None})
    if not images:
        raise RuntimeError("Image provider returned no usable image URL or base64 data.")
    return images


def _resolve_backend(backend: Any, runtime: ToolRuntime | None) -> Any:
    if callable(backend) and not hasattr(backend, "upload_files"):
        return backend(runtime)
    return backend


def generate_images(
    *,
    settings: ImageGenerationSettings,
    backend: Any,
    prompt: str,
    size: str | None = None,
    count: int = 1,
    output_dir: str | None = None,
    filename_prefix: str | None = None,
    user_id: str | None = None,
    watermark_enabled: bool | None = None,
) -> dict[str, Any]:
    if settings.provider not in SUPPORTED_PROVIDERS:
        return {"error": f"Unsupported image generation provider: {settings.provider}"}
    if not hasattr(backend, "upload_files"):
        return {"error": "The current backend cannot save generated images."}

    normalized_prompt = prompt.strip() if isinstance(prompt, str) else ""
    if not normalized_prompt:
        return {"error": "Image prompt must not be empty."}

    try:
        requested_count = max(1, min(int(count or 1), settings.max_images_per_call))
        requested_size = _normalize_size(size or settings.size)
        target_dir = _normalize_output_dir(output_dir or settings.output_dir)
    except (TypeError, ValueError) as exc:
        return {"error": str(exc)}

    api_key = _api_key(settings)
    if not api_key:
        return {"error": _missing_api_key_error(settings)}

    saved_files: list[dict[str, Any]] = []
    files_to_upload: list[tuple[str, bytes]] = []
    image_metadata: list[dict[str, Any]] = []
    prefix = _safe_filename_prefix(filename_prefix)
    effective_user_id = user_id or settings.user_id
    effective_watermark = (
        watermark_enabled
        if watermark_enabled is not None
        else settings.watermark_enabled
    )

    try:
        for image_index in range(requested_count):
            payload: dict[str, Any] = {
                "model": settings.model,
                "prompt": normalized_prompt,
                "size": requested_size,
            }
            if effective_user_id:
                payload["user_id"] = effective_user_id
            if effective_watermark is not None:
                payload["watermark_enabled"] = effective_watermark

            response = _request_json(
                url=_provider_url(settings),
                api_key=api_key,
                payload=payload,
                timeout_seconds=settings.timeout_seconds,
            )
            image_payloads = _extract_image_payloads(
                response,
                timeout_seconds=settings.timeout_seconds,
            )
            for payload_index, image in enumerate(image_payloads):
                mime_type = str(image["mime_type"])
                extension = _extension_for_mime_type(mime_type)
                name = (
                    f"{prefix}-{time.strftime('%Y%m%d-%H%M%S', time.gmtime())}-"
                    f"{uuid.uuid4().hex[:8]}-{image_index + 1}-{payload_index + 1}"
                    f"{extension}"
                )
                path = f"{target_dir.rstrip('/')}/{name}"
                files_to_upload.append((path, image["bytes"]))
                image_metadata.append(
                    {
                        "path": path,
                        "mime_type": mime_type,
                        "bytes": len(image["bytes"]),
                    }
                )
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}

    responses = backend.upload_files(files_to_upload)
    for response, metadata in zip(responses, image_metadata, strict=False):
        error = getattr(response, "error", None)
        if error:
            return {
                "error": f"Generated image could not be saved to {metadata['path']}: {error}",
                "images": saved_files,
            }
        saved_files.append(metadata)

    return {
        "provider": settings.provider,
        "model": settings.model,
        "prompt": normalized_prompt,
        "size": requested_size,
        "images": saved_files,
    }


def image_generation_tools(config: dict[str, Any] | None, backend: Any) -> list[Any]:
    settings = image_generation_settings(config)
    if not settings.enabled:
        return []

    @tool("generate_image")
    def generate_image(
        prompt: str,
        runtime: ToolRuntime,
        size: str | None = None,
        count: int = 1,
        output_dir: str | None = None,
        filename_prefix: str | None = None,
        user_id: str | None = None,
        watermark_enabled: bool | None = None,
    ) -> dict[str, Any]:
        """Generate images with the configured image model and save them to the workspace.

        Args:
            prompt: Detailed image prompt.
            size: Optional output size such as 1024x1024. Uses the configured default when omitted.
            count: Number of images to generate, capped by configuration.
            output_dir: Optional workspace logical directory for saved images.
            filename_prefix: Optional safe filename prefix.
            user_id: Optional provider user id.
            watermark_enabled: Optional provider watermark flag.
        """

        active_backend = _resolve_backend(backend, runtime)
        return generate_images(
            settings=settings,
            backend=active_backend,
            prompt=prompt,
            size=size,
            count=count,
            output_dir=output_dir,
            filename_prefix=filename_prefix,
            user_id=user_id,
            watermark_enabled=watermark_enabled,
        )

    return [generate_image]
