import unittest

from goal_state import (
    GoalValidationError,
    create_goal_state,
    goal_response,
    goal_with_elapsed,
    update_goal_status,
    validate_goal_objective,
)
from goal_middleware import render_goal_context


class GoalStateTest(unittest.TestCase):
    def test_create_goal_state_normalizes_objective_and_budget(self) -> None:
        goal = create_goal_state(
            "  ship goal mode  ",
            token_budget=5000,
            thread_id="thread-1",
            now=100,
        )

        self.assertEqual(goal["objective"], "ship goal mode")
        self.assertEqual(goal["status"], "active")
        self.assertEqual(goal["tokenBudget"], 5000)
        self.assertEqual(goal["threadId"], "thread-1")
        self.assertEqual(goal["createdAt"], 100)
        self.assertEqual(goal["updatedAt"], 100)

    def test_rejects_empty_objective_and_non_positive_budget(self) -> None:
        with self.assertRaises(GoalValidationError):
            validate_goal_objective("  ")
        with self.assertRaises(GoalValidationError):
            create_goal_state("do work", token_budget=0)

    def test_update_goal_status_is_terminal_only_and_tracks_elapsed_time(self) -> None:
        goal = create_goal_state("do work", now=100)

        completed = update_goal_status(goal, "complete", now=160)

        self.assertEqual(completed["status"], "complete")
        self.assertEqual(completed["updatedAt"], 160)
        self.assertEqual(completed["timeUsedSeconds"], 60)
        with self.assertRaises(GoalValidationError):
            update_goal_status(goal, "active", now=170)  # type: ignore[arg-type]

    def test_goal_response_includes_elapsed_and_remaining_tokens(self) -> None:
        goal = create_goal_state("do work", token_budget=100, now=10)
        goal["tokensUsed"] = 25

        response = goal_response(goal, now=40)

        self.assertEqual(response["remainingTokens"], 75)
        self.assertEqual(response["goal"]["timeUsedSeconds"], 30)
        self.assertEqual(goal_with_elapsed(goal, now=15)["timeUsedSeconds"], 5)

    def test_render_goal_context_escapes_user_objective(self) -> None:
        goal = create_goal_state("<do>&work", now=10)

        prompt = render_goal_context(goal)

        self.assertIn("&lt;do&gt;&amp;work", prompt)
        self.assertNotIn("<do>&work", prompt)


if __name__ == "__main__":
    unittest.main()
