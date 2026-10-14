-- Indexes for the foreign keys the library tables are looked up by (the
-- linter listed them as uncovered): the tree walks parent_id, a word or rule
-- is looked up by id from the library and from every view it is in, and the
-- sharing and catalog tables by player and by view.
create index if not exists collections_parent_idx on public.collections (parent_id) where parent_id is not null;
create index if not exists collection_rules_rule_idx on public.collection_rules (rule_id);
create index if not exists library_entries_sense_idx on public.library_entries (sense_id);
create index if not exists library_rules_rule_idx on public.library_rules (rule_id);
create index if not exists collection_shares_from_idx on public.collection_shares (from_user);
create index if not exists view_links_collection_idx on public.view_links (collection_id);
create index if not exists view_link_takes_user_idx on public.view_link_takes (user_id);
create index if not exists catalog_takes_user_idx on public.catalog_takes (user_id);
create index if not exists catalog_entries_collection_idx on public.catalog_entries (collection_id);
