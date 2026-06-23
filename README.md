# HouseWise

A household management app for families — shared shopping lists, a collaborative cookbook, AI-powered meal planning, and low-stock alerts, all under one roof.

---

## Features

### Shopping & Inventory
- **Shared shopping list** with categories, quantities, units, and urgency levels
- **Item approval workflow** — family members add items; admins review, approve, or reject them
- **Barcode / image scanner** — point the camera at any product to auto-fill name, brand, and size via AI
- **Low-stock alerts** — flag items that are running out and quick-add them to the list

### Cookbook
- **Recipe library** shared across the household
- **AI recipe generation** — describe a dish and receive a full recipe
- **Photo recipe extraction** — photograph a handwritten card or a dish and extract the recipe automatically
- **Admin approval workflow** — family members submit recipes; admins publish them

### Meal Planning
- **Weekly member submissions** — every family member logs busy days, meal requests, and notes
- **AI-generated weekly plan** — the admin triggers generation; the AI produces a tailored 7-day plan from submissions, dietary preferences, and cookbook history
- **Day-level reactions** — members like or dislike individual days after the plan is finalized
- **Ingredient export** — finalized plan days push suggested ingredients directly into the shopping list
- **Personalized recipe descriptions** — each recipe blurb is tailored to the viewing member's dietary profile

### Household Management
- **Admin / family role model** — admins create and manage household members; family members manage their own profiles
- **Dietary & health preferences** — per-member toggles (high-protein, low-calories, low-carbs, …) and free-text lists (allergies, dislikes, dietary types)
- **Preferred stores** — admin maintains a list of stores used for price comparisons
- **Price comparison reports** — generate a shopping report comparing prices across your household's preferred stores
- **Weekly email reports** — automated summary of household shopping activity, store spend breakdown, and upcoming meal plan preview sent to a configured email address

---

## Tech Stack

### Mobile (this repo)

| Layer | Technology |
|---|---|
| Framework | React Native 0.81 + Expo 54 |
| Language | TypeScript 5 |
| Routing | Expo Router (file-based) |
| State management | Zustand |
| Styling | NativeWind (Tailwind CSS for React Native) |
| Forms & validation | React Hook Form + Zod |
| HTTP client | Axios (JWT bearer, auto-refresh on 401) |
| Camera / scanning | expo-camera (barcode + photo capture) |
| Image picker | expo-image-picker (gallery selection) |
| Secure storage | expo-secure-store |
| Notifications | expo-notifications |

### Backend

| Layer | Technology |
|---|---|
| Framework | Python 3.12 / FastAPI |
| Database & Auth | Supabase (PostgreSQL + Auth, JWKS/ES256) |
| AI agents | Claude (Anthropic API) |
| Image processing | EasyOCR + Claude vision |
| Token validation | JWKS-only (no HS256 shared secret) |

---

## Project Structure

```
housewise/
├── app/                  # Expo Router screens and layouts
├── components/           # Shared UI components
├── constants/            # Theme colors, shared constants
├── services/             # API client modules (one file per domain)
├── store/                # Zustand state stores
├── ai_agents/            # Image, cookbook, meal-plan, price agents
├── supabase/             # Database migrations (ordered SQL files)
├── backend/              # FastAPI application
│   └── app/              # Route handlers, schemas, auth middleware
└── docs/                 # Flow diagrams, architecture docs, and User Guide
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- Python 3.12 (64-bit — required by PyTorch / EasyOCR)
- Expo CLI (`npm install -g expo-cli`)
- A [Supabase](https://supabase.com) project
- An [Anthropic](https://console.anthropic.com) API key

---

### Mobile App

```bash
# Install dependencies
npm install

# Start the development server
npx expo start
```

Open the Expo Go app on your device and scan the QR code, or press `a` for Android emulator / `i` for iOS simulator.

#### Environment

Create a `.env` file at the project root (or configure via `app.config.js`):

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_API_URL` | Base URL of the running FastAPI backend |

---

### Backend

```powershell
cd backend

# Create and activate the virtual environment
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1

# Install dependencies (add [dev] for tests / linting)
pip install -e ".[dev]"

# Copy and fill in the environment file
copy .env.example .env

# Run the development server
uvicorn app.main:app --reload
```

See [backend/README.md](backend/README.md) for the full environment-variable reference and API endpoint documentation.

#### Required Environment Variables

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side admin key (never exposed to the client) |
| `SUPABASE_ANON_KEY` | Used on public auth paths |
| `SUPABASE_JWKS_URL` | `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` |
| `SUPABASE_JWT_ISSUER` | `https://<ref>.supabase.co/auth/v1` |
| `SUPABASE_JWT_AUDIENCE` | `authenticated` |
| `ANTHROPIC_API_KEY` | Powers all AI agents (image scan, cookbook, meal plan, price) |
| `APP_DEEP_LINK` | Deep-link URI for admin password-reset emails |

---

### Database Migrations

Run the migration files in order inside the Supabase SQL Editor:

```
supabase/migrations/
  0001_init_auth.sql
  0002_fix_rls_recursion.sql
  0003_reset_and_simplify_auth.sql   ← destructive, wipes users/households
  0004_init_items.sql
  0005_user_profile_and_health_prefs.sql
  0006_init_low_stock.sql
  0007_init_stores.sql
  0008_init_cookbook.sql
  0009_init_meal_plan.sql
  0010_dietary_prefs_and_week_notes.sql
  0011_meal_plan_day_reactions.sql
  0012_recipe_personalized_descriptions.sql
  0013_household_report_settings.sql
  0014_recipe_story.sql
  0015_to_buy_list.sql
```

---

## Running Tests

Backend integration tests hit a real Supabase project (no mocking):

```powershell
cd backend
# Set TEST_SUPABASE_URL, TEST_SUPABASE_SERVICE_ROLE_KEY,
# TEST_SUPABASE_JWKS_URL, TEST_SUPABASE_JWT_ISSUER in .env
pytest
```

Tests clean up after themselves. Use a **dedicated test project** — they create and delete rows in `auth.users`.

---

## Scripts

| Command | Description |
|---|---|
| `npm start` | Start the Expo dev server |
| `npm run android` | Open on Android device/emulator |
| `npm run ios` | Open on iOS simulator |
| `npm run web` | Open in the browser |
| `npm run lint` | Run ESLint |
| `npm run type-check` | Run TypeScript type checking |
