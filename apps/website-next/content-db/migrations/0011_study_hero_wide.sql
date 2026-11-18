-- A study's image now comes in two shapes: the vertical one for its page (hero.webp) and a
-- horizontal one (hero-wide.webp) for its card in the index and the banner of its access email
-- (content-db/STUDY_IMAGES.md). Only widens the allowed paths.
alter table content.study_files drop constraint if exists study_files_path_check;
alter table content.study_files add constraint study_files_path_check
  check (path ~ '^(deck/|slides/|pdf/|deck-en/|slides-en/|pdf-en/|cover\.webp$|hero\.webp$|hero-wide\.webp$|email\.jpg$|email-banner\.jpg$)'
         and path !~ '\.\.' and path !~ '//');
