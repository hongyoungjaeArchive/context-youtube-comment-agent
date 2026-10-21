import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  AnalysisDTO,
  ExecutionDTO,
  HealthDTO,
  JobStatus,
  SettingsDTO,
  UsageSummaryDTO,
} from '@context/shared';
import { TERMINAL_EXECUTION_STATUSES } from '@context/shared';
import { api } from './client.ts';
import type {
  ActivityResponse,
  EvalDataset,
  EvalReport,
  EvalRun,
  EvalRunDetail,
  ExecutionsResponse,
  JobsResponse,
  ProfilesResponse,
  TargetsResponse,
  VideoSort,
  VideosResponse,
} from './types.ts';

/** 폴링 간격 (ms). 진행 중 작업만 빠르게, 그 외는 느리게. */
export const POLL = {
  executing: 700,
  working: 1000,
  idleFast: 5000,
  idleSlow: 10000,
} as const;

export const qk = {
  health: ['health'] as const,
  settings: ['settings'] as const,
  videos: (sort: VideoSort) => ['videos', sort] as const,
  analysis: (id: string) => ['analysis', id] as const,
  jobs: ['jobs'] as const,
  usage: ['usage'] as const,
  executions: ['executions'] as const,
  execution: (id: string) => ['execution', id] as const,
  activity: ['activity'] as const,
  targets: ['targets'] as const,
  profiles: ['profiles'] as const,
  evalDataset: ['eval', 'dataset'] as const,
  evalRuns: ['eval', 'runs'] as const,
  evalRun: (id: string) => ['eval', 'run', id] as const,
  evalReport: ['eval', 'report'] as const,
};

const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ['QUEUED', 'WAITING_DEPENDENCY', 'RUNNING', 'RATE_LIMITED', 'RETRY_SCHEDULED'];

export function isActiveJobStatus(status: JobStatus): boolean {
  return ACTIVE_JOB_STATUSES.includes(status);
}

export function isTerminalExecution(status: ExecutionDTO['status']): boolean {
  return TERMINAL_EXECUTION_STATUSES.includes(status);
}

export function useHealth(): UseQueryResult<HealthDTO> {
  return useQuery({ queryKey: qk.health, queryFn: () => api.get<HealthDTO>('/api/health'), refetchInterval: POLL.idleFast });
}

export function useSettings(): UseQueryResult<SettingsDTO> {
  return useQuery({ queryKey: qk.settings, queryFn: () => api.get<SettingsDTO>('/api/settings') });
}

export function useVideos(sort: VideoSort, fastPoll: boolean): UseQueryResult<VideosResponse> {
  return useQuery({
    queryKey: qk.videos(sort),
    queryFn: () => api.get<VideosResponse>(`/api/videos?sort=${sort}`),
    refetchInterval: fastPoll ? POLL.working : POLL.idleSlow,
  });
}

export function useAnalysis(id: string | null, forceFast: boolean): UseQueryResult<AnalysisDTO> {
  return useQuery({
    queryKey: qk.analysis(id ?? 'none'),
    queryFn: () => api.get<AnalysisDTO>(`/api/analyses/${encodeURIComponent(id ?? '')}`),
    enabled: id !== null,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (forceFast || (status && isActiveJobStatus(status))) return POLL.working;
      return POLL.idleSlow;
    },
  });
}

export function useJobs(): UseQueryResult<JobsResponse> {
  return useQuery({
    queryKey: qk.jobs,
    queryFn: () => api.get<JobsResponse>('/api/jobs'),
    refetchInterval: (q) => (q.state.data?.jobs.some((j) => isActiveJobStatus(j.status)) ? POLL.working : POLL.idleFast),
  });
}

export function useUsage(enabled: boolean): UseQueryResult<UsageSummaryDTO> {
  return useQuery({ queryKey: qk.usage, queryFn: () => api.get<UsageSummaryDTO>('/api/ai/usage'), enabled, refetchInterval: POLL.idleSlow });
}

export function useExecutions(): UseQueryResult<ExecutionsResponse> {
  return useQuery({
    queryKey: qk.executions,
    queryFn: () => api.get<ExecutionsResponse>('/api/executions'),
    refetchInterval: (q) => (q.state.data?.executions.some((e) => !isTerminalExecution(e.status)) ? POLL.executing : POLL.idleSlow),
  });
}

export function useExecution(id: string | null): UseQueryResult<ExecutionDTO> {
  return useQuery({
    queryKey: qk.execution(id ?? 'none'),
    queryFn: () => api.get<ExecutionDTO>(`/api/executions/${encodeURIComponent(id ?? '')}`),
    enabled: id !== null,
    refetchInterval: (q) => (q.state.data && isTerminalExecution(q.state.data.status) ? POLL.idleSlow : POLL.executing),
  });
}

export function useActivity(enabled: boolean): UseQueryResult<ActivityResponse> {
  return useQuery({ queryKey: qk.activity, queryFn: () => api.get<ActivityResponse>('/api/activity?limit=200'), enabled, refetchInterval: POLL.idleSlow });
}

export function useTargets(): UseQueryResult<TargetsResponse> {
  return useQuery({ queryKey: qk.targets, queryFn: () => api.get<TargetsResponse>('/api/targets'), refetchInterval: POLL.idleSlow });
}

export function useProfiles(): UseQueryResult<ProfilesResponse> {
  return useQuery({ queryKey: qk.profiles, queryFn: () => api.get<ProfilesResponse>('/api/profiles'), refetchInterval: POLL.idleSlow });
}

export function useEvalDataset(enabled: boolean): UseQueryResult<EvalDataset> {
  return useQuery({ queryKey: qk.evalDataset, queryFn: () => api.get<EvalDataset>('/api/eval/dataset'), enabled });
}

export function useEvalRuns(enabled: boolean): UseQueryResult<{ runs: readonly EvalRun[] }> {
  return useQuery({
    queryKey: qk.evalRuns,
    queryFn: () => api.get<{ runs: readonly EvalRun[] }>('/api/eval/runs'),
    enabled,
    refetchInterval: (q) => (q.state.data?.runs.some((r) => r.status === 'RUNNING') ? POLL.working : POLL.idleSlow),
  });
}

export function useEvalRun(id: string | null): UseQueryResult<EvalRunDetail> {
  return useQuery({
    queryKey: qk.evalRun(id ?? 'none'),
    queryFn: () => api.get<EvalRunDetail>(`/api/eval/runs/${encodeURIComponent(id ?? '')}`),
    enabled: id !== null,
  });
}

export function useEvalReport(enabled: boolean): UseQueryResult<EvalReport> {
  return useQuery({ queryKey: qk.evalReport, queryFn: () => api.get<EvalReport>('/api/eval/report'), enabled, refetchInterval: POLL.idleSlow });
}
