# Development Notes

## Windows local runtime startup

The Web UI restart endpoint starts two LangGraph dev servers:

- the coordinator backend on port `2024`
- the local runtime on port `22024`

On Windows, these spawned Python processes need UTF-8 mode enabled. Without it,
`langgraph_cli dev` can fail while reading UTF-8 OpenAPI metadata through the
default GBK locale. The restart helper sets `PYTHONUTF8=1` and
`PYTHONIOENCODING=utf-8` only on Windows.

The Windows local runtime is also started with `--allow-blocking`. The current
local filesystem backend performs synchronous path resolution during model
startup, which LangGraph dev can otherwise reject with a `Blocking call to
os.getcwd` error. This flag is limited to the local runtime and is not applied
to non-Windows platforms.
