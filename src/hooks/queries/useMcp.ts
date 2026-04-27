import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchMcpConnections, createMcpConnection, updateMcpConnection, deleteMcpConnection,
  type McpConnection,
} from '../../api/client';

export function useMcpConnections() {
  return useQuery({
    queryKey: ['mcp-connections'],
    queryFn: fetchMcpConnections,
  });
}

export function useCreateMcpConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; url?: string; config?: Record<string, unknown> }) =>
      createMcpConnection(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-connections'] }),
  });
}

export function useUpdateMcpConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Omit<McpConnection, 'id' | 'createdAt' | 'updatedAt'>> }) =>
      updateMcpConnection(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-connections'] }),
  });
}

export function useDeleteMcpConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteMcpConnection(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-connections'] }),
  });
}
