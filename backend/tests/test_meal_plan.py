"""Integration tests for /meal-plan — real Supabase for auth + DB; AI agent mocked.

Mocking pattern: replace `app.meal_plan.router.generate_weekly_plan` directly,
because the router does `from meal_plan_agent import generate_weekly_plan` at
module load — patching sys.modules after the fact wouldn't reach the captured
reference. Anthropic itself is never called.
"""
import pytest

from tests.test_auth import _create_member, _signup_admin


WEEK = "2026-06-01"  # Monday
PREV_WEEK = "2026-05-25"


def _good_days(recipe_id=None) -> list[dict]:
    return [
        {
            "day_of_week": d,
            "recipe_id": recipe_id if d == 1 else None,
            "meal_name": f"Day {d} meal",
            "prep_label": "fresh",
            "notes": None,
            "suggested_ingredients": (
                []
                if d == 1
                else [{"name": "Eggs", "quantity": "6", "unit": "units", "category": "dairy"}]
            ),
        }
        for d in range(1, 8)
    ]


def _member_token(client, member) -> str:
    return client.post(
        "/auth/login",
        json={"email": member["email"], "password": member["password"]},
    ).json()["access_token"]


# ---------- Mock the agent module globally for this file ----------


@pytest.fixture
def patch_meal_plan_agent(monkeypatch):
    holder = {
        "result": {"ai_summary": "default summary", "days": _good_days(), "reason": None}
    }
    calls: list = []

    def fake_generate(context):
        calls.append(context)
        return holder["result"]

    monkeypatch.setattr(
        "app.meal_plan.router.generate_weekly_plan", fake_generate
    )

    def set_result(**kw):
        base = {"ai_summary": None, "days": _good_days(), "reason": None}
        base.update(kw)
        holder["result"] = base

    return type("H", (), {"set": staticmethod(set_result), "calls": calls})


# ---------- Submissions ----------


def test_submission_upsert_returns_row(client, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    tok = _member_token(client, member)
    r = client.post(
        "/meal-plan/submissions",
        headers={"Authorization": f"Bearer {tok}"},
        json={
            "week_start": WEEK,
            "busy_days": [3, 5],
            "meal_requests": [{"description": "something quick", "recipe_id": None}],
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["user_id"] == member["user_id"]
    assert body["busy_days"] == [3, 5]
    assert body["meal_requests"][0]["description"] == "something quick"


def test_submission_resubmit_replaces(client, sb, created_users):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    tok = _member_token(client, member)
    client.post(
        "/meal-plan/submissions",
        headers={"Authorization": f"Bearer {tok}"},
        json={"week_start": WEEK, "busy_days": [1], "meal_requests": []},
    )
    r = client.post(
        "/meal-plan/submissions",
        headers={"Authorization": f"Bearer {tok}"},
        json={"week_start": WEEK, "busy_days": [2, 4], "meal_requests": []},
    )
    assert r.status_code == 201
    rows = (
        sb.table("meal_plan_submissions")
        .select("id", count="exact")
        .eq("household_id", admin["household_id"])
        .eq("user_id", member["user_id"])
        .eq("week_start", WEEK)
        .execute()
    )
    assert rows.count == 1
    assert r.json()["busy_days"] == [2, 4]


def test_submission_invalid_busy_day_returns_422(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.post(
        "/meal-plan/submissions",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"week_start": WEEK, "busy_days": [0, 3], "meal_requests": []},
    )
    assert r.status_code == 422


def test_submission_duplicate_busy_day_returns_422(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.post(
        "/meal-plan/submissions",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"week_start": WEEK, "busy_days": [3, 3], "meal_requests": []},
    )
    assert r.status_code == 422


def test_get_own_submission(client, created_users):
    admin = _signup_admin(client, created_users)
    client.post(
        "/meal-plan/submissions",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"week_start": WEEK, "busy_days": [2], "meal_requests": []},
    )
    r = client.get(
        f"/meal-plan/submissions/me?week_start={WEEK}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r.status_code == 200
    assert r.json()["busy_days"] == [2]


def test_get_own_submission_404_before_submit(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.get(
        f"/meal-plan/submissions/me?week_start={WEEK}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r.status_code == 404


def test_submission_status_per_member(client, created_users):
    admin = _signup_admin(client, created_users)
    m1 = _create_member(client, admin["access_token"], created_users, display_name="M1")
    m2 = _create_member(client, admin["access_token"], created_users, display_name="M2")
    t1 = _member_token(client, m1)
    # Only m1 submits.
    client.post(
        "/meal-plan/submissions",
        headers={"Authorization": f"Bearer {t1}"},
        json={"week_start": WEEK, "busy_days": [], "meal_requests": []},
    )
    r = client.get(
        f"/meal-plan/submissions/status?week_start={WEEK}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 3 and body["submitted"] == 1
    by_uid = {row["user_id"]: row for row in body["members"]}
    assert by_uid[m1["user_id"]]["submitted"] is True
    assert by_uid[m2["user_id"]]["submitted"] is False
    assert by_uid[admin["user_id"]]["submitted"] is False


# ---------- Plan read ----------


def test_get_plan_404_when_not_generated(client, created_users):
    admin = _signup_admin(client, created_users)
    r = client.get(
        f"/meal-plan/{WEEK}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r.status_code == 404


def test_get_plan_cross_household_404(client, created_users, patch_meal_plan_agent):
    a1 = _signup_admin(client, created_users, household_name="H1")
    a2 = _signup_admin(client, created_users, household_name="H2")
    client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {a1['access_token']}"},
        json={"week_start": WEEK},
    )
    r = client.get(
        f"/meal-plan/{WEEK}",
        headers={"Authorization": f"Bearer {a2['access_token']}"},
    )
    assert r.status_code == 404


# ---------- Generate ----------


def test_generate_as_family_403(client, created_users, patch_meal_plan_agent):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    tok = _member_token(client, member)
    r = client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {tok}"},
        json={"week_start": WEEK},
    )
    assert r.status_code == 403


def test_generate_as_admin_writes_plan_and_seven_days(
    client, sb, created_users, patch_meal_plan_agent
):
    admin = _signup_admin(client, created_users)
    patch_meal_plan_agent.set(ai_summary="A good week", days=_good_days())
    r = client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"week_start": WEEK},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "draft"
    assert body["ai_summary"] == "A good week"
    assert len(body["days"]) == 7
    # Days come back ordered by day_of_week.
    assert [d["day_of_week"] for d in body["days"]] == [1, 2, 3, 4, 5, 6, 7]
    plan_rows = (
        sb.table("meal_plans")
        .select("id", count="exact")
        .eq("household_id", admin["household_id"])
        .eq("week_start", WEEK)
        .execute()
    )
    assert plan_rows.count == 1


def test_generate_total_failure_502_no_row(client, sb, created_users, patch_meal_plan_agent):
    admin = _signup_admin(client, created_users)
    patch_meal_plan_agent.set(days=[], reason="agent rate-limited")
    r = client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"week_start": WEEK},
    )
    assert r.status_code == 502
    rows = (
        sb.table("meal_plans")
        .select("id", count="exact")
        .eq("household_id", admin["household_id"])
        .eq("week_start", WEEK)
        .execute()
    )
    assert (rows.count or 0) == 0


def test_generate_wrong_day_count_502(client, sb, created_users, patch_meal_plan_agent):
    admin = _signup_admin(client, created_users)
    patch_meal_plan_agent.set(days=_good_days()[:5])  # only 5 days
    r = client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"week_start": WEEK},
    )
    assert r.status_code == 502
    rows = (
        sb.table("meal_plans")
        .select("id", count="exact")
        .eq("household_id", admin["household_id"])
        .eq("week_start", WEEK)
        .execute()
    )
    assert (rows.count or 0) == 0


def test_generate_reroll_replaces_days(client, sb, created_users, patch_meal_plan_agent):
    admin = _signup_admin(client, created_users)
    patch_meal_plan_agent.set(days=_good_days())
    client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"week_start": WEEK},
    )
    # Second roll: same week, different meal_names.
    new_days = _good_days()
    for d in new_days:
        d["meal_name"] = f"NEW {d['day_of_week']}"
    patch_meal_plan_agent.set(days=new_days)
    r = client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"week_start": WEEK},
    )
    assert r.status_code == 200
    names = [d["meal_name"] for d in r.json()["days"]]
    assert names == [f"NEW {i}" for i in range(1, 8)]
    # Still exactly 7 day rows for that plan.
    plan_id = r.json()["id"]
    days = sb.table("meal_plan_days").select("id", count="exact").eq("plan_id", plan_id).execute()
    assert days.count == 7


def test_generate_context_pulls_low_stock_from_flags_not_items(
    client, sb, created_users, patch_meal_plan_agent
):
    admin = _signup_admin(client, created_users)
    sb.table("low_stock_flags").insert(
        {
            "household_id": admin["household_id"],
            "name": "Olive oil",
            "added_by": admin["user_id"],
        }
    ).execute()

    r = client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"week_start": WEEK},
    )
    assert r.status_code == 200
    ctx = patch_meal_plan_agent.calls[-1]
    assert "Olive oil" in ctx["low_stock_items"]


def test_generate_context_passes_none_for_missing_columns(
    client, created_users, patch_meal_plan_agent
):
    admin = _signup_admin(client, created_users)
    client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"week_start": WEEK},
    )
    ctx = patch_meal_plan_agent.calls[-1]
    member = ctx["household_members"][0]
    assert member["age_group"] is None
    assert member["taste_preferences"] is None
    assert isinstance(member["health_preferences"], dict)


def test_generate_context_includes_last_week_meals(
    client, created_users, patch_meal_plan_agent
):
    admin = _signup_admin(client, created_users)
    # First, generate the previous week so it ends up in the context for the current week.
    prev_days = _good_days()
    for d in prev_days:
        d["meal_name"] = f"Old {d['day_of_week']}"
    patch_meal_plan_agent.set(days=prev_days)
    client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"week_start": PREV_WEEK},
    )
    patch_meal_plan_agent.set(days=_good_days())
    client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"week_start": WEEK},
    )
    ctx = patch_meal_plan_agent.calls[-1]
    assert "Old 3" in ctx["last_week_meals"]


# ---------- Day-edit ----------


def test_admin_patches_day_meal_name(client, created_users, patch_meal_plan_agent):
    admin = _signup_admin(client, created_users)
    gen = client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"week_start": WEEK},
    ).json()
    plan_id = gen["id"]
    day_id = gen["days"][2]["id"]
    r = client.patch(
        f"/meal-plan/{plan_id}/days/{day_id}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"meal_name": "Renamed"},
    )
    assert r.status_code == 200
    renamed = next(d for d in r.json()["days"] if d["id"] == day_id)
    assert renamed["meal_name"] == "Renamed"


def test_family_patch_day_403(client, created_users, patch_meal_plan_agent):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    tok = _member_token(client, member)
    gen = client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"week_start": WEEK},
    ).json()
    r = client.patch(
        f"/meal-plan/{gen['id']}/days/{gen['days'][0]['id']}",
        headers={"Authorization": f"Bearer {tok}"},
        json={"meal_name": "Nope"},
    )
    assert r.status_code == 403


def test_patch_day_empty_body_422(client, created_users, patch_meal_plan_agent):
    admin = _signup_admin(client, created_users)
    gen = client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"week_start": WEEK},
    ).json()
    r = client.patch(
        f"/meal-plan/{gen['id']}/days/{gen['days'][0]['id']}",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={},
    )
    assert r.status_code == 422


def test_patch_day_cross_household_404(client, created_users, patch_meal_plan_agent):
    a1 = _signup_admin(client, created_users, household_name="H1")
    a2 = _signup_admin(client, created_users, household_name="H2")
    gen = client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {a1['access_token']}"},
        json={"week_start": WEEK},
    ).json()
    r = client.patch(
        f"/meal-plan/{gen['id']}/days/{gen['days'][0]['id']}",
        headers={"Authorization": f"Bearer {a2['access_token']}"},
        json={"meal_name": "Foreign"},
    )
    assert r.status_code == 404


# ---------- Finalize ----------


def test_admin_finalize_flips_status(client, sb, created_users, patch_meal_plan_agent):
    admin = _signup_admin(client, created_users)
    gen = client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"week_start": WEEK},
    ).json()

    r = client.post(
        f"/meal-plan/{gen['id']}/finalize",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "finalized"

    # Finalize must NOT touch the items table — FE owns shopping-list population.
    items = (
        sb.table("items")
        .select("id", count="exact")
        .eq("household_id", admin["household_id"])
        .execute()
    )
    assert (items.count or 0) == 0


def test_finalize_idempotent(client, created_users, patch_meal_plan_agent):
    admin = _signup_admin(client, created_users)
    gen = client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"week_start": WEEK},
    ).json()
    client.post(
        f"/meal-plan/{gen['id']}/finalize",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )

    r = client.post(
        f"/meal-plan/{gen['id']}/finalize",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "finalized"


def test_family_cannot_finalize(client, created_users, patch_meal_plan_agent):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    tok = _member_token(client, member)
    gen = client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"week_start": WEEK},
    ).json()
    r = client.post(
        f"/meal-plan/{gen['id']}/finalize",
        headers={"Authorization": f"Bearer {tok}"},
    )
    assert r.status_code == 403


def test_finalize_cross_household_404(client, created_users, patch_meal_plan_agent):
    a1 = _signup_admin(client, created_users, household_name="H1")
    a2 = _signup_admin(client, created_users, household_name="H2")
    gen = client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {a1['access_token']}"},
        json={"week_start": WEEK},
    ).json()
    r = client.post(
        f"/meal-plan/{gen['id']}/finalize",
        headers={"Authorization": f"Bearer {a2['access_token']}"},
    )
    assert r.status_code == 404


# ---------- week_notes + dietary_preferences in agent context ----------


def test_submission_round_trips_week_notes(client, created_users):
    admin = _signup_admin(client, created_users)
    tok = admin["access_token"]
    r = client.post(
        "/meal-plan/submissions",
        headers={"Authorization": f"Bearer {tok}"},
        json={
            "week_start": WEEK,
            "busy_days": [3],
            "meal_requests": [],
            "week_notes": "hosting Friday, need easy meals",
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["week_notes"] == "hosting Friday, need easy meals"

    me_sub = client.get(
        f"/meal-plan/submissions/me?week_start={WEEK}",
        headers={"Authorization": f"Bearer {tok}"},
    )
    assert me_sub.status_code == 200
    assert me_sub.json()["week_notes"] == "hosting Friday, need easy meals"


def test_resubmit_overwrites_week_notes(client, created_users):
    admin = _signup_admin(client, created_users)
    tok = admin["access_token"]
    client.post(
        "/meal-plan/submissions",
        headers={"Authorization": f"Bearer {tok}"},
        json={"week_start": WEEK, "busy_days": [], "meal_requests": [], "week_notes": "first"},
    )
    r = client.post(
        "/meal-plan/submissions",
        headers={"Authorization": f"Bearer {tok}"},
        json={"week_start": WEEK, "busy_days": [], "meal_requests": []},
    )
    # Body omitted week_notes — Pydantic defaults to None, upsert clears it.
    assert r.status_code == 201
    assert r.json()["week_notes"] is None


def test_generate_context_includes_dietary_prefs_and_week_notes(
    client, created_users, patch_meal_plan_agent
):
    admin = _signup_admin(client, created_users)
    tok = admin["access_token"]
    client.patch(
        "/me/dietary-preferences",
        headers={"Authorization": f"Bearer {tok}"},
        json={"dietary_types": ["vegetarian"], "allergies": ["peanuts"]},
    )
    client.post(
        "/meal-plan/submissions",
        headers={"Authorization": f"Bearer {tok}"},
        json={
            "week_start": WEEK,
            "busy_days": [2],
            "meal_requests": [],
            "week_notes": "hosting Friday",
        },
    )

    client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {tok}"},
        json={"week_start": WEEK},
    )
    ctx = patch_meal_plan_agent.calls[-1]
    me_in_ctx = next(
        m for m in ctx["household_members"] if m["display_name"] == "Admin"
    )
    assert me_in_ctx["dietary_preferences"]["dietary_types"] == ["vegetarian"]
    assert me_in_ctx["dietary_preferences"]["allergies"] == ["peanuts"]
    assert me_in_ctx["dietary_preferences"]["dislikes"] == []
    assert me_in_ctx["week_notes"] == "hosting Friday"


def test_generate_context_defaults_for_member_without_submission_or_prefs(
    client, created_users, patch_meal_plan_agent
):
    admin = _signup_admin(client, created_users)
    _create_member(client, admin["access_token"], created_users, display_name="NoSub")
    # Admin generates without anyone submitting or setting prefs.
    client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"week_start": WEEK},
    )
    ctx = patch_meal_plan_agent.calls[-1]
    nosub = next(m for m in ctx["household_members"] if m["display_name"] == "NoSub")
    assert nosub["dietary_preferences"] == {
        "dietary_types": [], "allergies": [], "dislikes": [],
    }
    assert nosub["week_notes"] is None


# ---------- Reactions ----------


def _generate_and_finalize(client, admin_token, agent, week_start=WEEK):
    gen = client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"week_start": week_start},
    ).json()
    client.post(
        f"/meal-plan/{gen['id']}/finalize",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    return gen


def test_react_on_finalized_day_persists(client, sb, created_users, patch_meal_plan_agent):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    tok = _member_token(client, member)
    gen = _generate_and_finalize(client, admin["access_token"], patch_meal_plan_agent)

    r = client.post(
        f"/meal-plan/{gen['id']}/react",
        headers={"Authorization": f"Bearer {tok}"},
        json={"day_id": gen["days"][2]["id"], "reaction": "liked"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user_id"] == member["user_id"]
    assert body["reaction"] == "liked"
    assert body["day_id"] == gen["days"][2]["id"]


def test_react_replaces_on_repost_same_user(client, created_users, patch_meal_plan_agent):
    admin = _signup_admin(client, created_users)
    tok = admin["access_token"]
    gen = _generate_and_finalize(client, tok, patch_meal_plan_agent)
    day_id = gen["days"][0]["id"]

    r1 = client.post(
        f"/meal-plan/{gen['id']}/react",
        headers={"Authorization": f"Bearer {tok}"},
        json={"day_id": day_id, "reaction": "liked"},
    )
    r2 = client.post(
        f"/meal-plan/{gen['id']}/react",
        headers={"Authorization": f"Bearer {tok}"},
        json={"day_id": day_id, "reaction": "disliked"},
    )
    assert r2.status_code == 200
    assert r2.json()["reaction"] == "disliked"
    assert r2.json()["id"] == r1.json()["id"], "Upsert must return the same row, not a new one"


def test_react_invalid_value_422(client, created_users, patch_meal_plan_agent):
    admin = _signup_admin(client, created_users)
    gen = _generate_and_finalize(client, admin["access_token"], patch_meal_plan_agent)
    r = client.post(
        f"/meal-plan/{gen['id']}/react",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"day_id": gen["days"][0]["id"], "reaction": "neutral"},
    )
    assert r.status_code == 422


def test_react_on_draft_plan_409(client, sb, created_users, patch_meal_plan_agent):
    admin = _signup_admin(client, created_users)
    gen = client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"week_start": WEEK},
    ).json()  # NOT finalized

    r = client.post(
        f"/meal-plan/{gen['id']}/react",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"day_id": gen["days"][0]["id"], "reaction": "liked"},
    )
    assert r.status_code == 409
    rows = (
        sb.table("meal_plan_day_reactions")
        .select("id", count="exact")
        .eq("user_id", admin["user_id"])
        .execute()
    )
    assert (rows.count or 0) == 0


def test_react_wrong_day_id_404(client, created_users, patch_meal_plan_agent):
    admin = _signup_admin(client, created_users)
    gen = _generate_and_finalize(client, admin["access_token"], patch_meal_plan_agent)
    r = client.post(
        f"/meal-plan/{gen['id']}/react",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={
            "day_id": "00000000-0000-0000-0000-000000000000",
            "reaction": "liked",
        },
    )
    assert r.status_code == 404


def test_react_cross_household_404(client, created_users, patch_meal_plan_agent):
    a1 = _signup_admin(client, created_users, household_name="H1")
    a2 = _signup_admin(client, created_users, household_name="H2")
    gen = _generate_and_finalize(client, a1["access_token"], patch_meal_plan_agent)
    r = client.post(
        f"/meal-plan/{gen['id']}/react",
        headers={"Authorization": f"Bearer {a2['access_token']}"},
        json={"day_id": gen["days"][0]["id"], "reaction": "liked"},
    )
    assert r.status_code == 404


def test_get_reactions_returns_all_members(client, created_users, patch_meal_plan_agent):
    admin = _signup_admin(client, created_users)
    member = _create_member(client, admin["access_token"], created_users)
    fam_tok = _member_token(client, member)
    gen = _generate_and_finalize(client, admin["access_token"], patch_meal_plan_agent)

    client.post(
        f"/meal-plan/{gen['id']}/react",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"day_id": gen["days"][0]["id"], "reaction": "liked"},
    )
    client.post(
        f"/meal-plan/{gen['id']}/react",
        headers={"Authorization": f"Bearer {fam_tok}"},
        json={"day_id": gen["days"][1]["id"], "reaction": "disliked"},
    )

    r = client.get(
        f"/meal-plan/{gen['id']}/reactions",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r.status_code == 200
    body = r.json()
    by_user = {row["user_id"]: row for row in body["reactions"]}
    assert by_user[admin["user_id"]]["reaction"] == "liked"
    assert by_user[member["user_id"]]["reaction"] == "disliked"


def test_reactions_cascade_on_regenerate(client, sb, created_users, patch_meal_plan_agent):
    admin = _signup_admin(client, created_users)
    gen = _generate_and_finalize(client, admin["access_token"], patch_meal_plan_agent)
    client.post(
        f"/meal-plan/{gen['id']}/react",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"day_id": gen["days"][0]["id"], "reaction": "liked"},
    )

    # Re-generate same week — should cascade-delete the reactions for that plan.
    client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"week_start": WEEK},
    )

    # The original day_id is gone (delete-then-insert), so the reaction row
    # for it cascaded out too.
    rows = (
        sb.table("meal_plan_day_reactions")
        .select("id", count="exact")
        .eq("day_id", gen["days"][0]["id"])
        .execute()
    )
    assert (rows.count or 0) == 0


def test_generate_context_includes_recent_reactions(
    client, sb, created_users, patch_meal_plan_agent
):
    admin = _signup_admin(client, created_users)
    tok = admin["access_token"]
    # Week N-1: generate + finalize, react.
    prev_days = _good_days()
    prev_days[2]["meal_name"] = "Memorable dish"
    patch_meal_plan_agent.set(days=prev_days)
    gen_prev = _generate_and_finalize(client, tok, patch_meal_plan_agent, week_start=PREV_WEEK)
    client.post(
        f"/meal-plan/{gen_prev['id']}/react",
        headers={"Authorization": f"Bearer {tok}"},
        json={"day_id": gen_prev["days"][2]["id"], "reaction": "liked"},
    )

    # Week N: generate again; capture the context.
    patch_meal_plan_agent.set(days=_good_days())
    client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {tok}"},
        json={"week_start": WEEK},
    )
    ctx = patch_meal_plan_agent.calls[-1]
    me_in_ctx = next(m for m in ctx["household_members"] if m["display_name"] == "Admin")
    assert len(me_in_ctx["recent_reactions"]) >= 1
    found = next(
        r for r in me_in_ctx["recent_reactions"]
        if r["meal_name"] == "Memorable dish"
    )
    assert found["reaction"] == "liked"
    assert found["week_start"] == PREV_WEEK
