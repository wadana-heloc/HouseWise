from functools import lru_cache

from supabase import Client, create_client

from .settings import settings


@lru_cache(maxsize=1)
def get_supabase() -> Client:
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)


def get_anon_supabase() -> Client:
    # NOT cached. The login flow calls sign_in_with_password on this client,
    # which attaches a user session to it. A cached/shared client would then
    # leak that session into other requests, causing PostgREST calls to go
    # through RLS as the logged-in user instead of as service_role.
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)
