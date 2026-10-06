"use client"

import type { RefreshJobRecord, RefreshRunRecord } from "@/lib/intelligence-contracts"

export function JobHistory({ jobs, runs, loading }: { jobs: RefreshJobRecord[]; runs: RefreshRunRecord[]; loading: boolean }) {
  return <section className="panel intelligence-history">
    <div className="panel-heading"><div><p className="eyebrow">Run and schedule history</p><h2>Refresh operations</h2><span>Application limits are safety ceilings, not provider-account balances.</span></div></div>
    {loading ? <p>Loading schedules and runs…</p> : <div className="intelligence-history-grid">
      <div><h3>Schedules</h3>{jobs.length ? jobs.map(job => <article key={job.id}><strong>{job.name}</strong><span>{job.mode} · {job.cohortType}</span><small>{job.status} · Next {new Date(job.nextRunAt).toLocaleString()}</small></article>) : <p>No refresh jobs have been created.</p>}</div>
      <div><h3>Recent runs</h3>{runs.length ? runs.map(run => <article key={run.id}><strong>{run.mode} · {run.status}</strong><span>{run.profilesSelected} selected · {run.socaiCalls} Socai · {run.targetedBrightCalls} targeted Bright</span><small>{run.failures} failures · Canonical mutations: {run.canonicalMutations}</small></article>) : <p>No scheduled runs have executed.</p>}</div>
    </div>}
  </section>
}
