# Which Insights pieces are live

**The rule (Brandhon, 19 Nov 2026): Insights only shows pieces that have a study behind them.** A
piece without a `study_id` does not go live. Each piece points to the study it comes from, and
the study is where the reader signs up.

The database is the record. This file keeps the history of the decisions that changed it.

## How to check

```bash
pnpm content:publish --list       # every piece: position, state, format, study, id
```

In SQL (`content_admin`):

```sql
select status, count(*) filter (where study_id is null) as no_study, count(*) filter (where study_id is not null) as with_study
from content.stories group by status;
```

`publicado` with `no_study` above 0 breaks the rule.

## Live on 19 Nov 2026: 27 pieces, all from a study

| Study | Pieces |
|---|---|
| `triggers-barriers-telecom-mexico-2026` | 10 |
| `triggers-barriers-banca-mexico-2026` | 6 |
| `triggers-barriers-farma-mexico-2026` | 6 |
| `triggers-barriers-seguros-mexico-2026` | 5 |

## Retired on 19 Nov 2026: 13 pieces without a study

These were made for the 2026 redesign to fill the feed. None has a study, so they came down with
`pnpm content:publish <id ...> --retire`.

They stay in the database as `retirado`, with a note in `notes`. Their pages answer 404, and they
can go back live with `pnpm content:publish <id>`.

| Piece | Report it pointed to |
|---|---|
| `descansar-sin-culpa` | `/insights/reportes/cultural-foresight-mexico-2026` |
| `no-todo-se-comparte` | `/insights/reportes/cultural-foresight-mexico-2026` |
| `lo-perfecto-se-siente-falso` | `/insights/reportes/cultural-foresight-mexico-2026` |
| `presumir-de-mas-da-cringe` | `/insights/reportes/cultural-foresight-mexico-2026` |
| `quiero-hablar-con-una-persona` | `/insights/reportes/future-is-human` |
| `publicidad-enganosa` | `/insights/reportes/future-is-human` |
| `lo-humano-se-mide-cuando-algo-falla` | `/insights/reportes/future-is-human` |
| `respuesta-generica` | `/insights/reportes/future-is-human` |
| `mi-casita-es-identidad` | `/insights/reportes/the-mexican-home` |
| `casa-propia-es-futuro` | `/insights/reportes/the-mexican-home` |
| `el-credito-no-alcanza` | `/insights/reportes/the-mexican-home` |
| `prefiero-estar-en-mi-casa` | `/insights/reportes/the-mexican-home` |
| `buscar-depa-empieza-con-sospecha` | `/insights/reportes/the-mexican-home` |

The three report pages (`/insights/reportes/...`) are still online. They are not in the content
database: they are built from the code.

## Before publishing a piece

1. The piece has a `study_id`. `content:load --study <id>` sets it.
2. The study is published, or goes live in the same step with `content:publish --study <id>`.
3. Add a row here when a decision changes what is live: a study comes down, or pieces are retired
   for a reason other than their study.
