-- A JPEG of the study's image for the access email: webp does not show in classic Outlook.
-- `email.jpg` is public like the cover and the hero.
alter table content.study_files drop constraint if exists study_files_path_check;
alter table content.study_files add constraint study_files_path_check
  check (path ~ '^(deck/|slides/|pdf/|cover\.webp$|hero\.webp$|email\.jpg$)' and path !~ '\.\.' and path !~ '//');
