import sys

from agent import agent


def main() -> None:
    user_message = " ".join(sys.argv[1:]) or "你好，介绍一下你能做什么。"

    result = agent.invoke(
        {"messages": [{"role": "user", "content": user_message}]}
    )
    print(result["messages"][-1].content)


if __name__ == "__main__":
    main()
