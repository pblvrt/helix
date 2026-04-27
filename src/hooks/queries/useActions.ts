import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchActionsStatus, submitAction, stopAction, stopActions,
  fetchActionHistory, fetchSchedules,
  createSchedule, updateSchedule, deleteSchedule,
  type Schedule,
} from '../../api/client';

export function useActionsStatus() {
  return useQuery({
    queryKey: ['actions-status'],
    queryFn: fetchActionsStatus,
    refetchInterval: 10_000,
    structuralSharing: true,
  });
}

export function useActionHistory(limit = 20) {
  return useQuery({
    queryKey: ['action-history'],
    queryFn: () => fetchActionHistory(limit),
  });
}

export function useSchedules() {
  return useQuery({
    queryKey: ['schedules'],
    queryFn: fetchSchedules,
  });
}

export function useSubmitAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: string | { command: string; args?: string }) =>
      typeof input === 'string'
        ? submitAction(input)
        : submitAction(input.command, input.args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actions-status'] });
      queryClient.invalidateQueries({ queryKey: ['action-history'] });
    },
  });
}

export function useStopAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => stopAction(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actions-status'] });
      queryClient.invalidateQueries({ queryKey: ['action-history'] });
    },
  });
}

export function useStopActions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => stopActions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actions-status'] });
      queryClient.invalidateQueries({ queryKey: ['action-history'] });
    },
  });
}

export function useCreateSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Schedule>) => createSchedule(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
    },
  });
}

export function useUpdateSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Schedule> }) => updateSchedule(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
    },
  });
}

export function useDeleteSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteSchedule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
    },
  });
}
