"use client"

import type { RefreshJobRecord, RefreshRunRecord } from "@/lib/intelligence-contracts"

export function JobHistory({ jobs, runs, loading }: { jobs: RefreshJobRecord[]; runs: RefreshRunRecord[]; loading: boolean }) {
  return <section className="panel intelligence-history">
    <div className="panel-heading"><div><p className="eyebrow">Run and schedule history</p><h2>Refresh operations</h2><span>Application limits are safety ceilings, not provider-account balances.</span></div></div>
    {loading ? <p className="intelligence-history-loading">Loading schedules and runs…</p> : <div className="intelligence-history-grid">
      <section><h3>Saved policies</h3>{jobs.length ? jobs.map(job => <article key={job.id}><strong>{job.name}</strong><span>{job.mode} · {job.cohortType}</span><small>{job.enabled ? `${job.status} · Next ${new Date(job.nextRunAt).toLocaleString()}` : `Inactive · intended ${new Date(job.nextRunAt).toLocaleString()}`}</small></article>) : <p className="intelligence-history-empty">No refresh policies have been saved.</p>}</section>
      <section><h3>Recent runs</h3>{runs.length ? runs.map(run => <article key={run.id}><strong>{run.mode} · {run.status}</strong><span>{run.profilesSelected} selected · {run.socaiCalls} Socai · {run.targetedBrightCalls} targeted Bright</span><small>{run.failures} failures · Canonical mutations: {run.canonicalMutations}</small></article>) : <p className="intelligence-history-empty">No scheduled runs have executed.</p>}</section>
    </div>}
  </section>
}
