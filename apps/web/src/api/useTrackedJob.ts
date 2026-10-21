import { useEffect, useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { JobDTO } from '@context/shared';
import { isActiveJobStatus, qk, useJobs } from './queries.ts';

/**
 * 반환된 jobId를 /api/jobs에서 추적하고, 끝나면 관련 쿼리를 다시 불러온다.
 * 새로고침하면 추적은 사라지지만 작업은 서버 큐에서 계속되며 재시작하지 않는다.
 */
export function useTrackedJob(refreshKey: QueryKey): {
  readonly job: JobDTO | null;
  readonly finished: JobDTO | null;
  readonly active: boolean;
  readonly track: (jobId: string) => void;
} {
  const [jobId, setJobId] = useState<string | null>(null);
  const [finished, setFinished] = useState<JobDTO | null>(null);
  const jobs = useJobs();
  const qc = useQueryClient();
  const job = jobId ? (jobs.data?.jobs.find((j) => j.id === jobId) ?? null) : null;
  const active = jobId !== null && (job === null || isActiveJobStatus(job.status));

  useEffect(() => {
    if (!jobId || !job || isActiveJobStatus(job.status)) return;
    void qc.invalidateQueries({ queryKey: refreshKey });
    void qc.invalidateQueries({ queryKey: qk.health });
    setFinished(job);
    setJobId(null);
  }, [jobId, job, qc, refreshKey]);

  const track = (id: string) => {
    setFinished(null);
    setJobId(id);
  };
  return { job, finished, active, track };
}
