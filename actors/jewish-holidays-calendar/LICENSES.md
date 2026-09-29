# Third-party licences

This Actor depends on **`@hebcal/core`** (npm, GPL-2.0-only) for Hebrew-calendar holiday, Rosh
Chodesh, Omer and parasha data (`src/lib/hebrew-calendar.ts` is the only file that imports it).

Per `CONVENTIONS.md` ("Dependency licences"), a GPL-2.0 dependency is allowed in this repository only
because these Actors run as a **private hosted service**: the source code and the Docker image are
never distributed to end users (Apify runs the container; users only receive JSON/CSV/iCal output over
the API). Under that model, using a GPL library does not require this Actor's own code to be
distributed under GPL. Consequences, kept in force for as long as this Actor depends on `@hebcal/core`:

- This repository must stay **private** (not published as an open-source Actor or public repo).
- The Docker image / source of this Actor must not be redistributed.
- This notice must stay in the Actor folder.

All other runtime and dev dependencies of this Actor (`apify`, `typescript`, `vitest`, `@types/node`)
are MIT/Apache-2.0.
