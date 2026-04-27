import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchSkills, fetchSkill, deleteSkill } from '../../api/client';

const QUERY_KEY = ['skills'] as const;

export function useSkills() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchSkills,
  });
}

export function useSkill(slug: string | null) {
  return useQuery({
    queryKey: [...QUERY_KEY, 'entry', slug],
    queryFn: () => fetchSkill(slug as string),
    enabled: !!slug,
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => deleteSkill(slug),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
