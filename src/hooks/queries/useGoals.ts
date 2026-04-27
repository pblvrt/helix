import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchGoals, fetchGoal, createGoal, updateGoal, deleteGoal, startGoal, type CreateGoalInput } from '../../api/client';

export function useGoals() {
  return useQuery({
    queryKey: ['goals'],
    queryFn: fetchGoals,
    refetchInterval: 30_000,
    structuralSharing: true,
  });
}

export function useGoalDetail(id: string) {
  return useQuery({
    queryKey: ['goals', id],
    queryFn: () => fetchGoal(id),
    enabled: !!id,
    refetchInterval: 30_000,
    structuralSharing: true,
  });
}

export function useCreateGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateGoalInput) => createGoal(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
    },
  });
}

export function useUpdateGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<any> }) => updateGoal(id, data),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      queryClient.invalidateQueries({ queryKey: ['goals', id] });
    },
  });
}

export function useDeleteGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteGoal(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
    },
  });
}

export function useStartGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => startGoal(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['goals'] });
      queryClient.invalidateQueries({ queryKey: ['goals', id] });
    },
  });
}
