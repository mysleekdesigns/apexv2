export interface AuthRequest {
  token: string;
  userId: string;
}

export type AuthResult = {
  ok: boolean;
  reason?: string;
};

export async function authHandler(req: AuthRequest): Promise<AuthResult> {
  if (!req.token) return { ok: false, reason: "missing-token" };
  return { ok: true };
}

export class AuthService {
  private readonly secret: string;
  constructor(secret: string) {
    this.secret = secret;
  }
  verify(token: string): boolean {
    return token.startsWith(this.secret);
  }
}

const internalCounter = 0;
export const PUBLIC_PREFIX = "auth:";
