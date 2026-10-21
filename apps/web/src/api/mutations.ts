import { useMutation, useQueryClient, type QueryKey, type UseMutationResult } from '@tanstack/react-query';
import type { SageAnswerDTO, SageAskRequest } from '@context/shared';
import { api, toApiError, type ApiError } from './client.ts';

interface Options<TData, TVars> {
  readonly invalidate?: readonly QueryKey[];
  readonly onSuccess?: (data: TData, vars: TVars) => void;
}

/** 모든 변경 요청 공통: 오류를 ApiError로 정규화하고 성공 시 관련 쿼리를 다시 불러온다. */
export function useApiMutation<TData, TVars = void>(
  fn: (vars: TVars) => Promise<TData>,
  { invalidate = [], onSuccess }: Options<TData, TVars> = {},
): UseMutationResult<TData, ApiError, TVars> {
  const qc = useQueryClient();
  return useMutation<TData, ApiError, TVars>({
    mutationFn: async (vars) => {
      try {
        return await fn(vars);
      } catch (e) {
        throw toApiError(e);
      }
    },
    onSuccess: (data, vars) => {
      for (const key of invalidate) void qc.invalidateQueries({ queryKey: key });
      onSuccess?.(data, vars);
    },
  });
}

/** Sage 질문 — 읽기 전용이라 무효화할 쿼리가 없다. */
export function useAskSage(): UseMutationResult<SageAnswerDTO, ApiError, SageAskRequest> {
  return useApiMutation<SageAnswerDTO, SageAskRequest>((body) => api.post<SageAnswerDTO>('/api/sage/ask', body));
}
