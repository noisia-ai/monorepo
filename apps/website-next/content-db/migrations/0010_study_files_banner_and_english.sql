-- A study's files can now include the access email's banner (email-banner.jpg, content-db/STUDY_EMAIL.md)
-- and a second deck in English beside the Spanish one: deck-en/, its slide images (slides-en/) and
-- its PDF (pdf-en/). Only widens the allowed paths.
alter table content.study_files drop constraint if exists study_files_path_check;
alter table content.study_files add constraint study_files_path_check
  check (path ~ '^(deck/|slides/|pdf/|deck-en/|slides-en/|pdf-en/|cover\.webp$|hero\.webp$|email\.jpg$|email-banner\.jpg$)'
         and path !~ '\.\.' and path !~ '//');
