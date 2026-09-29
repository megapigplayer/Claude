# Third-party licences

This Actor depends on **`@hebcal/core`** (npm, GPL-2.0-only) for location lookup, Shabbat/holiday
candle-lighting and havdalah event generation, and the `Zmanim` halachic-times class (`src/lib/
locations.ts`, `src/lib/week.ts` and `src/lib/zmanim.ts` are the files that import it). `@hebcal/core`
itself depends on **`@hebcal/noaa`** (LGPL-2.1-or-later; the NOAA solar-position algorithm the
`Zmanim` class is built on) and **`@hebcal/hdate`** (MIT); this Actor's own `package.json` does not
list either as a direct dependency, since `@hebcal/core` re-exports what is needed (`Zmanim`,
`Location`, `NOAACalculator`).

Per `CONVENTIONS.md` ("Dependency licences"), a GPL-2.0 (and LGPL-2.1) dependency is allowed in this
repository only because these Actors run as a **private hosted service**: the source code and the
Docker image are never distributed to end users (Apify runs the container; users only receive JSON
output over the API). Under that model, using a GPL/LGPL library does not require this Actor's own
code to be distributed under GPL. Consequences, kept in force for as long as this Actor depends on
`@hebcal/core`:

- This repository must stay **private** (not published as an open-source Actor or public repo).
- The Docker image / source of this Actor must not be redistributed.
- This notice must stay in the Actor folder.

All other runtime and dev dependencies of this Actor (`apify`, `typescript`, `vitest`, `@types/node`)
are MIT/Apache-2.0.
