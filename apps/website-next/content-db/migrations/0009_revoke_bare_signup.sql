-- Applied after the site that asks for a code is live: the sign-up without a code is gone, so the
-- site can no longer create a link from a bare form.
revoke execute on function content.register_for_study(text, text, text, text, text, boolean, text) from website_runtime, website_review;
