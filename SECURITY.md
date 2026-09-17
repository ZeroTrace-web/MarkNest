# Security Policy

## Scope

MarkNest is a client-side, local-first application. Security concerns include cross-site scripting, unsafe URL handling, unexpected network requests, data exposure, unsafe imports, and accidental inclusion of credentials or third-party code.

## Reporting

Please report suspected vulnerabilities privately through the repository's GitHub security-reporting mechanism when it is enabled. Do not publicly post working exploit details before the issue has been reviewed.

If private reporting is unavailable, contact the project maintainer through the least-public channel provided by the repository.

## Important limitation

MarkNest does not encrypt `localStorage`. Do not store passwords, private keys, API tokens, recovery codes, or other secrets in the application.
