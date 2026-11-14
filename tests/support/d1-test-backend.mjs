// Preloaded by `npm test` (node --import). PostgreSQL is the application
// default, but the existing regression suite exercises the D1 implementation
// through in-process modules. Keep that explicit unless a test or the caller
// chose a backend; the PostgreSQL suites set CN_DB_BACKEND=postgres themselves.
process.env.CN_DB_BACKEND ??= "d1"
