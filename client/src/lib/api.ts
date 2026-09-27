export class ApiError extends Error {
  status: number;
  details?: Record<string, string[]>;
  constructor(status: number, message: string, details?: Record<string, string[]>) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      'X-Requested-With': 'evoto',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Erro ${res.status}`, data.details);
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T>(p: string, b: unknown) => request<T>('PUT', p, b),
  patch: <T>(p: string, b: unknown) => request<T>('PATCH', p, b),
  del: <T>(p: string) => request<T>('DELETE', p),
};

// ---------- Tipos partilhados ----------
export type Role = 'voter' | 'admin';
export type UserStatus = 'pending' | 'approved' | 'suspended';
export type Phase = 'draft' | 'scheduled' | 'open' | 'ended' | 'closed';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
}

export interface Election {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  status: 'draft' | 'published' | 'closed';
  phase: Phase;
  allowBlank: boolean;
  closedAt: string | null;
  resultsHash: string | null;
  turnout: number;
  hasVoted: boolean;
  candidateCount?: number;
}

export interface Candidate {
  id: string;
  name: string;
  party: string;
  description: string;
}

export interface Results {
  electionId: string;
  totalBallots: number;
  eligibleVoters: number;
  participations: number;
  blank: number;
  candidates: { id: string; name: string; party: string; votes: number }[];
  bulletinDigest: string;
  talliedAt: string;
}

export interface AdminUser extends User {
  documentHint: string;
  createdAt: string;
}

export interface AuditEntry {
  seq: number;
  at: string;
  action: string;
  target: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  hash: string;
  actorName: string | null;
}

export interface ChainStatus {
  valid: boolean;
  entries: number;
  brokenAt?: number;
}
