# Static documents with runtime data

Publish generated HTML documents on GitHub Pages and use ordinary links between views, rather than a client-side router. Each document starts in a loading state and fetches its data at runtime, so database updates do not require a deploy; query parameters capture shareable selections, filters, and sort order.

A Live War Capture remains outside the database while the event ID can change. Only the completed War Archive is imported into Supabase. Unfinished views can be omitted from navigation but are not access-restricted.