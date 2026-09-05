# Project-skill stage mode contract

Use the source and team fingerprints to decide whether a candidate is affected.
In incremental mode, an unchanged candidate remains ready and its package is
not rewritten. In reconciliation mode, match an existing package by candidate name before
creating a new package. A missing or invalid package is affected; an unaffected
package must remain unchanged.

Record `full`, `headless`, `incremental`, or `reconciliation` in the stage
outcome. A valid `no-skills-required` handoff is complete without a package.
