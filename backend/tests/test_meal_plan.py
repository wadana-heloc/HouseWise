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


def _items_in_household(sb, household_id):
    return (
        sb.table("items")
        .select("*")
        .eq("household_id", household_id)
        .execute()
        .data
    ) or []


def test_admin_finalize_flips_status_and_inserts_items(
    client, sb, created_users, patch_meal_plan_agent
):
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

    items = _items_in_household(sb, admin["household_id"])
    # Default _good_days yields "Eggs" on days 2-7 → 1 row after dedup.
    eggs = [i for i in items if i["name"] == "Eggs"]
    assert len(eggs) == 1, items
    e = eggs[0]
    assert e["status"] == "pending"
    assert e["added_by"] == admin["user_id"]
    assert e["category"] == "dairy"
    assert WEEK in (e["notes"] or "")


def test_finalize_dedups_within_batch(client, sb, created_users, patch_meal_plan_agent):
    admin = _signup_admin(client, created_users)
    # Same name, different casings on different days → one row.
    days = _good_days()
    days[1]["suggested_ingredients"] = [
        {"name": "EGGS", "quantity": "2", "unit": "units", "category": "dairy"}
    ]
    days[2]["suggested_ingredients"] = [
        {"name": "eggs", "quantity": "3", "unit": "units", "category": "dairy"}
    ]
    days[3]["suggested_ingredients"] = [
        {"name": "Eggs", "quantity": "4", "unit": "units", "category": "dairy"}
    ]
    patch_meal_plan_agent.set(days=days)
    gen = client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"week_start": WEEK},
    ).json()

    client.post(
        f"/meal-plan/{gen['id']}/finalize",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    items = _items_in_household(sb, admin["household_id"])
    egg_rows = [i for i in items if i["name"].lower() == "eggs"]
    assert len(egg_rows) == 1


def test_finalize_idempotent_no_second_items_insert(
    client, sb, created_users, patch_meal_plan_agent
):
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
    count_before = len(_items_in_household(sb, admin["household_id"]))

    r = client.post(
        f"/meal-plan/{gen['id']}/finalize",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "finalized"
    assert len(_items_in_household(sb, admin["household_id"])) == count_before


def test_finalize_uses_recipe_ingredients_when_recipe_id_set(
    client, sb, created_users, patch_meal_plan_agent
):
    admin = _signup_admin(client, created_users)
    # Admin manual save → status='approved' so it's an eligible recipe.
    recipe = client.post(
        "/cookbook/recipes",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={
            "name": "Tikka",
            "description": None,
            "ingredients": [
                {"name": "Chicken", "quantity": "500", "unit": "g", "category": "meat"},
            ],
            "instructions": None,
            "tags": [],
            "prep_minutes": None,
            "servings": None,
        },
    ).json()

    days = _good_days(recipe_id=recipe["id"])
    # Wipe all suggested_ingredients so the only source is the recipe join.
    for d in days:
        d["suggested_ingredients"] = []
    patch_meal_plan_agent.set(days=days)
    gen = client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"week_start": WEEK},
    ).json()

    client.post(
        f"/meal-plan/{gen['id']}/finalize",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    items = _items_in_household(sb, admin["household_id"])
    names = {i["name"] for i in items}
    assert "Chicken" in names


def test_finalize_falls_back_to_suggested_for_null_recipe_days(
    client, sb, created_users, patch_meal_plan_agent
):
    admin = _signup_admin(client, created_users)
    days = _good_days()  # all days null recipe_id; days 2-7 have Eggs suggested
    patch_meal_plan_agent.set(days=days)
    gen = client.post(
        "/meal-plan/generate",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
        json={"week_start": WEEK},
    ).json()
    client.post(
        f"/meal-plan/{gen['id']}/finalize",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    items = _items_in_household(sb, admin["household_id"])
    assert any(i["name"] == "Eggs" for i in items)


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
