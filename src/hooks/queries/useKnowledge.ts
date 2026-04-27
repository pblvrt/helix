import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchKnowledge, fetchKnowledgeCollections, fetchKnowledgeEntry,
  createKnowledge, updateKnowledge, deleteKnowledge,
  type ListKnowledgeParams, type CreateKnowledgeBody, type UpdateKnowledgeBody,
} from '../../api/client';

const QUERY_KEY = ['knowledge'] as const;

export function useKnowledge(params: ListKnowledgeParams = {}) {
  return useQuery({
    queryKey: [...QUERY_KEY, params],
    queryFn: () => fetchKnowledge(params),
  });
}

export function useKnowledgeCollections() {
  return useQuery({
    queryKey: [...QUERY_KEY, 'collections'],
    queryFn: fetchKnowledgeCollections,
  });
}

export function useKnowledgeEntry(slug: string | null) {
  return useQuery({
    queryKey: [...QUERY_KEY, 'entry', slug],
    queryFn: () => fetchKnowledgeEntry(slug as string),
    enabled: !!slug,
  });
}

export function useCreateKnowledge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateKnowledgeBody) => createKnowledge(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useUpdateKnowledge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, patch }: { slug: string; patch: UpdateKnowledgeBody }) =>
      updateKnowledge(slug, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useDeleteKnowledge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => deleteKnowledge(slug),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
